import type { Report } from '../model.js';
import { agentComponent } from './agent.js';
import { jsonComponent } from './json.js';
import { stepSummaryComponent } from './step-summary.js';

export interface ComponentContext {
  outputDirectory: string;
  title: string;
  log: (message: string) => void;
}

/**
 * A component turns the collected report into some output. Components run in
 * the order given in the `components` input and must not modify the report.
 */
export interface Component {
  name: string;
  description: string;
  /** Returns the paths of the files written. */
  run(report: Report, context: ComponentContext): Promise<string[]>;
}

export const COMPONENTS: Component[] = [jsonComponent, agentComponent, stepSummaryComponent];

export const COMPONENT_NAMES = COMPONENTS.map((c) => c.name);
