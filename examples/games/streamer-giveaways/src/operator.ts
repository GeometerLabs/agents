// The operator's console: the same host, plus the export tool. Chat never goes through here.
// npm run operator -- "export the codes of camp-spring"
import { generateText, stepCountIs } from "ai";
import { defaultModel, export_codes, give_code, lookup_campaign, system } from "./agent.ts";

const { text } = await generateText({
  model: defaultModel(),
  system,
  prompt: process.argv.slice(2).join(" "),
  tools: { lookup_campaign, give_code, export_codes },
  stopWhen: stepCountIs(6),
});
console.log(text);
