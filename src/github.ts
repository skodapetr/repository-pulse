/**
 * Minimal GitHub REST client built on fetch: retries, rate-limit back-off,
 * bounded concurrency and page-number pagination (Link headers are not used,
 * which keeps it working behind proxies that rewrite them).
 */

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

export interface GitHubClientOptions {
  token?: string;
  apiUrl?: string;
  concurrency?: number;
  log?: (message: string) => void;
}

type Params = Record<string, string | number | boolean | undefined>;

export class GitHubClient {
  private readonly base: string;
  private readonly token?: string;
  private readonly concurrency: number;
  private readonly log: (message: string) => void;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  requestCount = 0;

  constructor(options: GitHubClientOptions = {}) {
    this.base = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.token = options.token || undefined;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.log = options.log ?? (() => {});
  }

  async get<T>(path: string, params: Params = {}): Promise<T> {
    return this.limited(() => this.fetchWithRetry<T>(path, params));
  }

  /** Fetch pages of 100 until a short page, `maxPages`, or `stop` returns true for a page. */
  async paginate<T>(
    path: string,
    params: Params = {},
    options: { maxPages?: number; stop?: (page: T[]) => boolean } = {},
  ): Promise<T[]> {
    const maxPages = options.maxPages ?? 30;
    const all: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const items = await this.get<T[]>(path, { ...params, per_page: 100, page });
      all.push(...items);
      if (items.length < 100) break;
      if (options.stop?.(items)) break;
      if (page === maxPages) this.log(`Stopped paging ${path} after ${maxPages} pages.`);
    }
    return all;
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async fetchWithRetry<T>(path: string, params: Params): Promise<T> {
    const url = new URL(`${this.base}/${path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'repository-pulse',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      this.requestCount++;
      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch (error) {
        if (attempt >= maxAttempts) throw error;
        await sleep(backoff(attempt));
        continue;
      }
      if (response.ok) return (await response.json()) as T;

      const body = await response.text();
      const remaining = response.headers.get('x-ratelimit-remaining');
      const retryAfter = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 && (remaining === '0' || !Number.isNaN(retryAfter) && retryAfter > 0 || /rate limit/i.test(body)));
      const retryable = rateLimited || response.status >= 500;

      if (!retryable || attempt >= maxAttempts) {
        throw new GitHubError(
          `GitHub API ${response.status} for ${path}: ${body.slice(0, 300)}`,
          response.status,
          path,
        );
      }
      let wait = backoff(attempt);
      if (retryAfter > 0) wait = retryAfter * 1000;
      else if (remaining === '0' && reset > 0) wait = Math.max(1000, reset * 1000 - Date.now() + 1000);
      if (wait > 15 * 60 * 1000) {
        throw new GitHubError(`Rate limit exceeded for ${path}; resets in ${Math.round(wait / 60000)} min.`, response.status, path);
      }
      this.log(`GitHub API ${response.status} for ${path}, retrying in ${Math.round(wait / 1000)} s.`);
      await sleep(wait);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
