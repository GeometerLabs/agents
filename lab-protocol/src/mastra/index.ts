import { Mastra } from '@mastra/core/mastra';
import { labAgent } from './agents/lab.ts';

export const mastra = new Mastra({
  agents: { lab: labAgent },
});
