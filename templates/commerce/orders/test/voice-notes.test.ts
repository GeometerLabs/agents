// Voice notes for Orders (plan B29): the shared cases in modules/voice/test/helpers/shared-cases.ts, run against Orders' own harness and words.
import { createWorld, AMIT } from "../src/harness.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { voiceCases } from "../../../../modules/voice/test/helpers/shared-cases.ts";

voiceCases({
  name: "orders", create: (o) => createWorld(o as never), customer: AMIT, greeting: "hello",
  offLine: (w) => TEMPLATES[w.store.customers.get(AMIT)?.language ?? w.settings.languages[0]].voice_note({} as never),
});
