import { Agent } from '@mastra/core/agent';
import { discardSample, getSample, listSteps, runStep } from '../tools/lab.ts';

export const labAgent = new Agent({
  id: 'lab',
  name: 'Lab Protocol',
  instructions:
    'You run protocol steps on samples. Look the sample up, then run the step that was asked for, once. ' +
    'Only a scientist can approve discarding a sample: never discard without an approval id you were given. ' +
    'If a tool says a step already ran, is held, or its outcome is unknown, say so and stop.',
  model: process.env.MODEL ?? 'openai/gpt-4o-mini',
  tools: { get_sample: getSample, run_step: runStep, discard_sample: discardSample, list_steps: listSteps },
});
