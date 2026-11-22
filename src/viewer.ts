import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ViewerSetting } from './config.js';
import { MANIFEST_FILE } from './history.js';
import { htmlEscape as e } from './util.js';

/** The viewer that ships with the action. It sits one level above both src/ and dist/. */
export const BUNDLED_VIEWER = new URL('../viewer/pulse-viewer.js', import.meta.url);

/** An inline script must not contain a closing script tag. */
function inlineSafe(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** The page that hosts a viewer: a title, the manifest location and the viewer script, inline or linked. */
export function renderViewerPage(title: string, script: { inline: string } | { url: string }): string {
  const tag =
    'inline' in script
      ? `<script type="module">\n${inlineSafe(script.inline)}\n</script>`
      : `<script type="module" src="${e(script.url)}"></script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="pulse-manifest" content="${MANIFEST_FILE}">
<title>${e(title)}</title>
</head>
<body>
${tag}
</body>
</html>
`;
}

/** Writes index.html for the chosen viewer, or nothing. Returns the file written. */
export async function writeViewer(directory: string, title: string, viewer: ViewerSetting): Promise<string | null> {
  if (viewer.kind === 'none') return null;
  let page: string;
  if (viewer.kind === 'url') page = renderViewerPage(title, { url: viewer.url });
  else {
    const source = await readFile(viewer.kind === 'file' ? viewer.path : BUNDLED_VIEWER, 'utf8').catch((error: Error) => {
      throw new Error(`Cannot read the viewer ${viewer.kind === 'file' ? viewer.path : 'bundled with the action'}: ${error.message}`);
    });
    page = renderViewerPage(title, { inline: source });
  }
  const file = join(directory, 'index.html');
  await writeFile(file, page);
  return file;
}
