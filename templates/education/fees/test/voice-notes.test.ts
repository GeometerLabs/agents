// Voice notes for Fees (plan B29): the shared cases in modules/voice/test/helpers/shared-cases.ts, run against Fees' own harness and words.
import { createWorld, ROHAN_PARENT } from "../src/harness.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { summarizeUsage } from "../../../../bundle/lib/usage.ts";
import { voiceCases } from "../../../../modules/voice/test/helpers/shared-cases.ts";

voiceCases({
  name: "fees", create: (o) => createWorld(o as never), customer: ROHAN_PARENT, greeting: "hello",
  offLine: (w) => TEMPLATES[w.store.customers.get(ROHAN_PARENT)?.language ?? w.settings.languages[0]].voice_note({} as never),
  meterSpend: (entries) => summarizeUsage(entries, {}).modelMicroInr,
});
