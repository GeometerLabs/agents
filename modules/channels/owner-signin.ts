// The owner's sign-in on the shop's page, the runtime's side (plan item 11f, decision 44). Used by the runtime core (runtime/core.ts), which hands it three events
// before the agent sees anything, and by the runtime's HTTP layer (runtime/http.ts), which uses up links and checks sessions through `http`:
//
//   owner_signin        the page's "send me a sign-in link" (from the public front, with the channel token). It names no number: the link goes to the owner's
//                       number in the shop's settings, and only there.
//   a message           the owner writes "open my app" (OPEN_MY_APP, four languages) to the shop's own WhatsApp number. A fixed phrase read here, before the agent
//                       and the assistant: it is never passed on, and the link goes back in the window the owner's own message just opened.
//   owner_access        the HTTP layer says a session started or ended (it cannot write the record itself: only a step may), so the record shows every sign-in.
//
// Sending (why not the claim-save-send of the licence notice): a link is worth nothing once a newer one exists (owner-access.ts replaces older links), so a link
// sent twice after a crash costs the owner one stale message and nothing else. The request is counted before anything else (LINK_LIMITS), so neither the owner's
// phone nor the record can be flooded. No token or link is written in the record: its lines name the link's short id.
//
// A link cannot go as free text outside the owner's 24-hour WhatsApp window, and no approved sign-in template exists yet (Meta's authentication templates carry
// codes, not links: bundle/Deferred.md). Then nothing is sent, the record says so, and the page has already told the owner to send "open my app" instead.
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import type { InboundMessage, Messaging, OutboundMessage } from "../messaging/messaging.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import { nothingWasSent } from "../report/monthly-job.ts";
import type { OwnerAccess, OwnerNow } from "./owner-access.ts";
import type { PagesFile } from "./pages-file.ts";

/** The runtime's own record events for a session (never from the front: the front's channel token can send only the channel events). */
export interface OwnerAccessEvent { kind: "owner_access"; id: string; what: "signed_in" | "signed_out"; session: string }
/** The page asks for a sign-in link. No number, no address: the runtime knows both. */
export interface OwnerSigninEvent { kind: "owner_signin"; id: string }

/**
 * "Open my app" in the owner's words, as fixed phrases (compared after `phraseOf`): English, Hindi, Malayalam, Kannada, and the common Latin spellings. The Hindi,
 * Malayalam and Kannada are machine-written and wait for native review (plan item 12), like the rest of the new words.
 */
export const OPEN_MY_APP: readonly string[] = [
  "open my app", "open app", "my app", "sign in", "signin", "login", "log in",
  "मेरा ऐप खोलो", "ऐप खोलो", "मेरा ऐप", "app kholo", "mera app kholo",
  "എന്റെ ആപ്പ് തുറക്കൂ", "ആപ്പ് തുറക്കൂ", "എന്റെ ആപ്പ്", "app thurakku",
  "ನನ್ನ ಆಪ್ ತೆರೆಯಿರಿ", "ಆಪ್ ತೆರೆಯಿರಿ", "ನನ್ನ ಆಪ್", "app tere",
];
/** Lower case, one space between words, without the full stop, question or exclamation mark (or the Devanagari danda) a person may add. */
export const phraseOf = (text: string): string => text.normalize("NFC").toLowerCase().replace(/[.!?।,]+\s*$/u, "").replace(/\s+/gu, " ").trim();

/** The message that carries the link, in the owner's language. It says it works once and for how long, and what to do if the owner did not ask. */
export const SIGNIN_MESSAGE: Record<Language, (shop: string, link: string) => string> = {
  en: (shop, link) => `Your sign-in link for ${shop}'s page. It works once, for 10 minutes:\n${link}\nIf you did not ask for it, ignore this message.`,
  hi: (shop, link) => `${shop} के पेज में साइन-इन का आपका लिंक। यह एक बार, 10 मिनट तक चलेगा:\n${link}\nअगर आपने यह नहीं माँगा, तो इसे छोड़ दीजिए।`,
  ml: (shop, link) => `${shop} പേജിലേക്ക് സൈൻ ഇൻ ചെയ്യാനുള്ള നിങ്ങളുടെ ലിങ്ക്. ഇത് ഒരിക്കൽ മാത്രം, 10 മിനിറ്റ് പ്രവർത്തിക്കും:\n${link}\nനിങ്ങൾ ചോദിച്ചതല്ലെങ്കിൽ ഈ സന്ദേശം അവഗണിക്കൂ.`,
  kn: (shop, link) => `${shop} ಪುಟಕ್ಕೆ ನಿಮ್ಮ ಸೈನ್ ಇನ್ ಲಿಂಕ್. ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 10 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ:\n${link}\nನೀವು ಕೇಳದಿದ್ದರೆ ಈ ಸಂದೇಶವನ್ನು ಬಿಟ್ಟುಬಿಡಿ.`,
};

export interface OwnerSigninSetup {
  access: OwnerAccess;
  /** The shop's addresses, read fresh (the deployer may change them at any time). Without them the shop has no owner sign-in, and the phrase goes to the agent. */
  pages: () => PagesFile | undefined;
  /** The panel's "sign out every device" moment, read fresh. */
  endBefore: () => number | undefined;
  owner: { whatsapp: string; language: Language };
  shopName: string;
  clock: Clock;
  log?: (line: string) => void;
}

const sameNumber = (a: string, b: string) => a.replace(/\D/gu, "") === b.replace(/\D/gu, "");

export function createOwnerSignin(setup: OwnerSigninSetup) {
  const { access, owner, clock } = setup;
  const log = setup.log ?? (() => undefined);
  /** The owner as the settings and the deployer say now; undefined while the shop has no pages file (no owner sign-in at all). */
  const who = (): OwnerNow | undefined => { const p = setup.pages(); return p ? { owner: owner.whatsapp, base: p.ownerBase } : undefined; };

  /** Is this the owner's "open my app"? Only from the owner's own number, only the fixed phrases, and only when the shop has an owner view to open. */
  const isOpenMyApp = (m: InboundMessage): boolean => sameNumber(m.from, owner.whatsapp) && !m.reply && m.text !== "" && OPEN_MY_APP.includes(phraseOf(m.text)) && who() !== undefined;

  /** One link, if the shop's limits allow it: issued, sent in the owner's open window, and the outcome recorded under the link's short id. */
  async function sendLink(via: "page" | "whatsapp", ctx: { messaging: Messaging; record: ActionRecord }): Promise<void> {
    const now = clock.now();
    const w = who();
    if (!w) { log("A sign-in link was asked for, but this shop has no pages file yet (its next deploy writes one): none was sent."); return; }
    if (!access.tryAttempt(now)) { log("A sign-in link was asked for more often than the shop's limit (3 a quarter of an hour, 10 a day): none was sent."); return; }
    const language = owner.language;
    const base = { conversation: owner.whatsapp, action: "owner_signin" as const, language };
    // the window first: a link cannot go as free text when it is closed, and nothing is issued that could not be sent
    const open = await ctx.messaging.isWindowOpen(owner.whatsapp).catch(() => false);
    if (!open) {
      ctx.record.append({ ...base, outcome: "blocked", inputs: { via }, notes: "The owner's WhatsApp window is closed, so a sign-in link cannot go as a message. The page tells the owner to send \"open my app\" to the shop's number.", refs: { to: "owner", via } });
      return;
    }
    const link = access.issue({ ...w, via, now });
    let sent: OutboundMessage | undefined;
    let outcome: Outcome;
    let note: string | undefined;
    try {
      // previews are off in the live adapter (whatsapp.ts), so WhatsApp itself does not fetch the link
      sent = await ctx.messaging.sendText(owner.whatsapp, SIGNIN_MESSAGE[language](setup.shopName, `${w.base}/in/${link.token}`));
      outcome = (await ctx.messaging.getMessage(sent.id)) ? "confirmed" : "unconfirmed";
    } catch (e) {
      outcome = !sent && nothingWasSent(e) ? "failed" : "unconfirmed";
      if (outcome === "failed") access.unsent(link.id); // nobody has it: it can never be used
      note = (e as Error).message;
    }
    ctx.record.append({ ...base, outcome, inputs: { via, link: link.id }, ...(note ? { notes: note } : {}), refs: { to: "owner", via, link: link.id, ...(sent ? { messageId: sent.id } : {}) } });
  }

  return {
    /** Does the core hand this event here instead of to the agent? */
    takes(event: { kind: string; message?: InboundMessage }): boolean {
      if (event.kind === "owner_signin" || event.kind === "owner_access") return true;
      return event.kind === "message" && event.message !== undefined && isOpenMyApp(event.message);
    },

    /** Handle one event the core gave here (`takes` said yes). */
    async run(event: OwnerSigninEvent | OwnerAccessEvent | { kind: "message"; message: InboundMessage }, ctx: { messaging: Messaging; record: ActionRecord }): Promise<void> {
      if (event.kind === "owner_access") {
        ctx.record.append({ conversation: owner.whatsapp, action: "owner_session", outcome: "confirmed", inputs: { what: event.what, session: event.session }, language: owner.language, refs: { what: event.what, session: event.session } });
        return;
      }
      await sendLink(event.kind === "message" ? "whatsapp" : "page", ctx);
    },

    /** On the clock's beat: the panel's "sign out every device", said once in the record when the runtime first sees it. */
    tick(ctx: { record: ActionRecord }): void {
      const endBefore = setup.endBefore();
      if (endBefore === undefined) return;
      const ended = access.endAllBefore(endBefore, clock.now());
      if (ended === undefined) return;
      ctx.record.append({ conversation: owner.whatsapp, action: "owner_session", outcome: "confirmed", inputs: { what: "all_ended", endBefore }, language: owner.language, refs: { what: "all_ended", count: String(ended) } });
    },

    /** What the runtime's HTTP layer uses: each reads the owner and the address as they are now. */
    http: {
      linkState: (token: string) => { const w = who(); return w ? access.linkState(token, w, clock.now()) : "unknown" as const; },
      consume: (token: string) => { const w = who(); return w ? access.consume(token, w, clock.now()) : { ok: false as const, state: "unknown" as const }; },
      check: (session: string) => { const w = who(); return w ? access.check(session, w, clock.now(), setup.endBefore()) : undefined; },
      end: (session: string) => access.end(session, clock.now()),
    },
  };
}
export type OwnerSignin = ReturnType<typeof createOwnerSignin>;
