// The owner's side of the shop terms on WhatsApp (B72): "terms" sends the terms in the owner's language with an "I agree" button; "I agree" (typed, or the button) records the
// agreement in the shop's record. Called by the Bookings, Orders and Fees agents from their owner handling, the way the handover reply is (modules/approvals/handover.ts).
//
// Why it is safe to add: with no terms file (the default) `setup` is undefined and this returns false at once, so nothing changes for any shop. It never touches a limit, an
// approval or a customer. Only the owner's number reaches an agent's owner handling, so a customer or an approver writing "I agree" is not an agreement.
//
// What is recorded: `terms_sent` (digest, version, language) when the terms went out, and `terms_agreed` (the same three, plus the reply's WhatsApp message id and the owner's
// number as the record's conversation) when the owner agreed. An agreement counts only if a `terms_sent` with the SAME digest is in the record: terms changed since (a new
// price, a new version) need to be sent and agreed again. The terms go out as plain text in the owner's open window, so no Meta template is needed.
import type { ActionRecord } from "../record/record.ts";
import type { Language } from "../language/languages.ts";
import type { InboundMessage, Messaging } from "../messaging/messaging.ts";
import { AGREE_PREFIX, LATER_ID, TERMS_AGREED_ACTION, TERMS_SENT_ACTION, TERMS_VERSION, TERMS_WORDS, isAgreeWords, isTermsRequest, termsDigest, termsText } from "./terms.ts";
import type { TermsFile } from "./terms.ts";

export interface OwnerTermsDeps {
  /** The shop's terms file now; undefined means the feature is off for this shop. */
  setup: TermsFile | undefined;
  shopName: string;
  ownerNumber: string;
  ownerLanguage: Language;
  messaging: Messaging;
  record: ActionRecord;
  /** The agent's own log (so the entry gets the agent's key and language handling). */
  log(action: string, outcome: "confirmed" | "failed" | "blocked", inputs: unknown, more: { notes?: string; refs?: Record<string, string> }): void;
}

/** Did this handler take the owner's message? True means the agent should do nothing more with it. */
export async function handleOwnerTerms(msg: InboundMessage, d: OwnerTermsDeps): Promise<boolean> {
  if (!d.setup) return false;
  const tapped = msg.reply?.id;
  const asked = tapped === undefined && isTermsRequest(msg.text);
  const agreed = tapped !== undefined ? tapped.startsWith(AGREE_PREFIX) : isAgreeWords(msg.text);
  const later = tapped === LATER_ID;
  if (!asked && !agreed && !later) return false;

  const lang = d.ownerLanguage;
  const words = TERMS_WORDS[lang];
  const text = termsText(lang, d.shopName, d.setup);
  const digest = termsDigest(text);
  const reply = async (body: string) => { try { await d.messaging.sendText(d.ownerNumber, body); } catch { /* the window or the provider failed: the record below says what happened */ } };

  if (later) { await reply(words.ok); return true; }

  if (asked) {
    try {
      await d.messaging.sendText(d.ownerNumber, text);
      const buttons = [{ id: `${AGREE_PREFIX}${digest.slice(0, 12)}`, title: words.agree }, { id: LATER_ID, title: words.later }];
      if (d.messaging.sendInteractive) await d.messaging.sendInteractive(d.ownerNumber, { body: words.ask(TERMS_VERSION), buttons });
      else await d.messaging.sendText(d.ownerNumber, `${words.ask(TERMS_VERSION)} ${words.agree}`);
      d.log(TERMS_SENT_ACTION, "confirmed", { digest }, { notes: "the shop terms were sent to the owner on WhatsApp, in the owner's language", refs: { termsDigest: digest, termsVersion: TERMS_VERSION, termsLanguage: lang } });
    } catch (e) {
      d.log(TERMS_SENT_ACTION, "failed", { digest }, { notes: `the shop terms could not be sent to the owner (${(e as Error).message})`, refs: { termsVersion: TERMS_VERSION, termsLanguage: lang } });
    }
    return true;
  }

  // agreed: only for the terms that were last sent, unchanged
  const entries = d.record.entries();
  const sent = [...entries].reverse().find((e) => e.action === TERMS_SENT_ACTION && e.outcome === "confirmed");
  const buttonDigest = tapped !== undefined ? tapped.slice(AGREE_PREFIX.length) : undefined;
  if (!sent || sent.refs.termsDigest !== digest || (buttonDigest !== undefined && buttonDigest !== digest.slice(0, 12))) {
    d.log(TERMS_AGREED_ACTION, "blocked", { digest }, { notes: !sent ? "the owner said they agree, but these terms were never sent to them, so nothing is recorded" : "the owner said they agree, but the terms have changed since they were sent, so nothing is recorded; they must be sent again", refs: { termsVersion: TERMS_VERSION } });
    await reply(words.askFirst);
    return true;
  }
  if (entries.some((e) => e.action === TERMS_AGREED_ACTION && e.outcome === "confirmed" && e.refs.termsDigest === digest)) { await reply(words.already(TERMS_VERSION)); return true; }
  d.log(TERMS_AGREED_ACTION, "confirmed", { digest }, { notes: "the owner agreed to the shop terms on WhatsApp, from the owner's own number", refs: { termsDigest: digest, termsVersion: TERMS_VERSION, termsLanguage: lang, messageId: msg.id } });
  await reply(words.done(TERMS_VERSION));
  return true;
}
