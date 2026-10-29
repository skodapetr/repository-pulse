import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Component } from './index.js';

export const jsonComponent: Component = {
  name: 'json',
  description: 'Structured report as pulse.json (schema in documentation/json-output.md).',
  async run(report, { outputDirectory }) {
    const file = join(outputDirectory, 'pulse.json');
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    return [file];
  },
};
