// Voice notes for Bookings against the shared cases (plan B29), beside its own fuller tests in voice-notes.test.ts: the same behaviour, the same checks, in every template.
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { voiceCases } from "../../../../modules/voice/test/helpers/shared-cases.ts";

voiceCases({
  name: "bookings", create: (o) => createWorld(o as never), customer: CUSTOMER, greeting: "hello",
  offLine: (w) => TEMPLATES[w.store.customers.get(CUSTOMER)?.language ?? w.settings.languages[0]].voice_note({} as never),
});
