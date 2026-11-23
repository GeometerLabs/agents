// The stand-in WhatsApp a "fakes" shop runs on, as the TypeScript runtime had it: the Go programs have their own twin (go/internal/messaging NewStandIn), and the vectors that
// hold the two to the same answers are made from this one (go/scripts/vectors/messaging.ts). The rest of this file (reading each Guard's credential file, loading a
// template's live adapters) went with the TypeScript server runtimes on 24 Nov 2026.
import type { Clock } from "../core/clock.ts";
import { LANGUAGES } from "../language/languages.ts";
import { createFakeMessaging } from "../messaging/messaging.ts";
import type { Messaging } from "../messaging/messaging.ts";

/**
 * The stand-in WhatsApp for a local run: the in-memory fake, with every template of the pathway approved in every language, that shows what it "sends" through `say`.
 * It never hears that a customer wrote (nobody calls its receive), so its window is closed and replies go as templates.
 */
export function standInMessaging(clock: Clock, templateNames: readonly string[], say: (line: string) => void = () => undefined): Messaging {
  const fake = createFakeMessaging(clock);
  for (const name of templateNames) for (const language of LANGUAGES) fake.approve(name, language);
  return {
    async sendText(to, text) { const m = await fake.sendText(to, text); say(`[stand-in WhatsApp] to ${to}: ${text}`); return m; },
    async sendTemplate(to, template) { const m = await fake.sendTemplate(to, template); say(`[stand-in WhatsApp] to ${to}: ${template.text}`); return m; },
    isWindowOpen: (to) => fake.isWindowOpen(to),
    getMessage: (id) => fake.getMessage(id),
  };
}
