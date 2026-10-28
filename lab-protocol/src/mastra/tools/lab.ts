import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as lab from '../../lab.ts';

export const getSample = createTool({
  id: 'get_sample',
  description: 'Look up a sample: its label, volume and status.',
  inputSchema: z.object({ sample_id: z.string() }),
  execute: async ({ sample_id }) => lab.getSample(sample_id),
});

export const runStep = createTool({
  id: 'run_step',
  description: 'Run one protocol step (for example incubate or centrifuge) on a sample, once.',
  inputSchema: z.object({ sample_id: z.string(), step: z.string() }),
  execute: async ({ sample_id, step }) => lab.runStep(sample_id, step),
});

export const discardSample = createTool({
  id: 'discard_sample',
  description: "Discard a sample. approval is a scientist's approval id; without it nothing is discarded.",
  inputSchema: z.object({ sample_id: z.string(), approval: z.string().default('') }),
  execute: async ({ sample_id, approval }) => lab.discardSample(sample_id, approval),
});

export const listSteps = createTool({
  id: 'list_steps',
  description: 'List the protocol steps already run on a sample.',
  inputSchema: z.object({ sample_id: z.string() }),
  execute: async ({ sample_id }) => lab.listSteps(sample_id),
});
