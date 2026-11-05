// npm start -- "Run the incubate step on sample s-1."
import { mastra } from './mastra/index.ts';

const result = await mastra.getAgent('lab').generate(process.argv.slice(2).join(' '));
console.log(result.text);
