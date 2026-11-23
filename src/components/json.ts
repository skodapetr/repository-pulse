import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reportDate, reportPath } from '../history.js';
import type { Component } from './index.js';

export const jsonComponent: Component = {
  name: 'json',
  description: 'Structured report as pulse/DATE.json (schema in documentation/json-output.md).',
  async run(report, { outputDirectory }) {
    const file = join(outputDirectory, reportPath('json', reportDate(report.window)));
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    return [file];
  },
};
