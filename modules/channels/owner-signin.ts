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
//
// Item 11h (decisions 45 and 46): passkeys. The `http` object also carries the passkey ceremonies (owner-access.ts holds the state, webauthn.ts the checks): the
// Operator's setup QR or a recovery code (owner-grants.ts, the panel's file, read fresh on every call) to register one, and the passkey to sign in. The RP ID and
// the origin come from the pages file's ownerBase, the one address the owner's view has. A shop with no WhatsApp has no link to send, and the passkey is its way in.
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import type { InboundMessage, Messaging, OutboundMessage } from "../messaging/messaging.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import { nothingWasSent } from "../report/monthly-job.ts";
import { FILE_TAKEN } from "../approvals/leave.ts";
import { whatsappOf } from "../push/push.ts";
import type { AssertionResponse, OwnerAccess, OwnerNow, RegistrationResponse } from "./owner-access.ts";
import type { Grant, OwnerGrants } from "./owner-grants.ts";
import type { PagesFile } from "./pages-file.ts";
import { relyingParty } from "./webauthn.ts";

/** The runtime's own record events for a session (never from the front: the front's channel token can send only the channel events). */
export interface OwnerAccessEvent {
  kind: "owner_access"; id: string;
  /**
   * Item 11h: "passkey_added" when the owner registered a passkey (from the Operator's QR or a recovery code); `how` says what signed them in. Owner's item 2 ("no
   * Operator holds a shop hostage"): "phone_removed" (the owner took a phone away), "codes_made" (the owner made their own recovery codes) and "removal_cancelled"
   * (the owner stopped the Operator's request); `session` names the owner's session that did it. The runtime's own findings (the Operator's request seen and applied,
   * Geometer's reset) are written by `tick`, not sent as events.
   */
  what: "signed_in" | "signed_out" | "passkey_added" | "file_taken" | "phone_removed" | "codes_made" | "removal_cancelled"; session: string; how?: "link" | "passkey" | "setup" | "recovery" | "own_phone" | "reset";
  /** "passkey_added": the coarse label of the new phone ("Android, Chrome"), so the record says which phone was added. */
  label?: string;
  /** "file_taken" (leave with your shop): the owner's session took the shop's file made for this ask (modules/approvals/leave.ts), so the server can delete its copy. */
  ask?: string;
}
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

/** The push alert when the Operator asks to remove every phone: it names no code and no link, only that the owner can stop it in their app. */
export const REMOVAL_ALERT = (by: string): Record<Language, string> => ({
  en: `${by || "Your Operator"} asked to remove every phone that opens your shop. It happens in 2 days unless you cancel. Open your app to stop it.`,
  hi: `${by || "आपके ऑपरेटर"} ने आपकी दुकान खोलने वाले हर फ़ोन को हटाने को कहा है। आप रद्द न करें तो यह 2 दिन में हो जाएगा। रोकने के लिए अपना ऐप खोलिए।`,
  ml: `${by || "നിങ്ങളുടെ ഓപ്പറേറ്റർ"} നിങ്ങളുടെ കട തുറക്കുന്ന എല്ലാ ഫോണുകളും നീക്കാൻ ആവശ്യപ്പെട്ടു. നിങ്ങൾ റദ്ദാക്കിയില്ലെങ്കിൽ 2 ദിവസത്തിൽ അത് നടക്കും. തടയാൻ നിങ്ങളുടെ ആപ്പ് തുറക്കൂ.`,
  kn: `${by || "ನಿಮ್ಮ ಆಪರೇಟರ್"} ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 2 ದಿನದಲ್ಲಿ ಆಗುತ್ತದೆ. ನಿಲ್ಲಿಸಲು ನಿಮ್ಮ ಆಪ್ ತೆರೆಯಿರಿ.`,
});

/** The push alert when the owner's number in the settings was changed after the owner's phones were made: it says nothing the Operator typed, only that it is held for 2 days. */
export const OWNER_CHANGE_ALERT: Record<Language, string> = {
  en: "The owner's number for your shop was changed. Every phone that opens your shop stops working in 2 days unless you cancel. Open your app to stop it.",
  hi: "आपकी दुकान के लिए मालिक का नंबर बदला गया है। आप रद्द न करें तो आपकी दुकान खोलने वाले सारे फ़ोन 2 दिन में बंद हो जाएँगे। रोकने के लिए अपना ऐप खोलिए।",
  ml: "നിങ്ങളുടെ കടയുടെ ഉടമയുടെ നമ്പർ മാറ്റി. നിങ്ങൾ റദ്ദാക്കിയില്ലെങ്കിൽ കട തുറക്കുന്ന എല്ലാ ഫോണുകളും 2 ദിവസത്തിൽ പ്രവർത്തിക്കില്ല. തടയാൻ നിങ്ങളുടെ ആപ്പ് തുറക്കൂ.",
  kn: "ನಿಮ್ಮ ಅಂಗಡಿಯ ಮಾಲೀಕರ ನಂಬರ್ ಬದಲಾಯಿಸಲಾಗಿದೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳು 2 ದಿನದಲ್ಲಿ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. ನಿಲ್ಲಿಸಲು ನಿಮ್ಮ ಆಪ್ ತೆರೆಯಿರಿ.",
};

export interface OwnerSigninSetup {
  access: OwnerAccess;
  /** The shop's addresses, read fresh (the deployer may change them at any time). Without them the shop has no owner sign-in, and the phrase goes to the agent. */
  pages: () => PagesFile | undefined;
  /** The panel's "sign out every device" moment, read fresh. */
  endBefore: () => number | undefined;
  /** Item 11h: the panel's setup QR, recovery card and "remove the owner's passkeys" (owner-grants.ts), read fresh. Left out: no passkeys. */
  grants?: () => OwnerGrants | undefined;
  owner: { whatsapp: string; language: Language };
  /** The owner number the SETTINGS name, when `owner.whatsapp` was set to the number the shop was locked with instead (start.ts). Left out: they are the same. */
  settingsOwner?: string;
  /** An alert to the owner's phones with web push on (modules/push), for the Operator's removal request. Left out: no push, and the owner's app shows the request. */
  alert?: (text: Record<Language, string>) => void;
  shopName: string;
  clock: Clock;
  log?: (line: string) => void;
}

const sameNumber = (a: string, b: string) => a.replace(/\D/gu, "") === b.replace(/\D/gu, "");

export function createOwnerSignin(setup: OwnerSigninSetup) {
  const { access, owner, clock } = setup;
  access.noteStart(clock.now()); // a request that fell due while the runtime was down is given a day more, and the owner is told again (owner-access.ts noteStart)
  const log = setup.log ?? (() => undefined);
  /** The owner as the settings and the deployer say now; undefined while the shop has no pages file (no owner sign-in at all). */
  /** The owner number the settings say NOW (the runtime may keep using the locked one in `owner`: start.ts), for noticing a change the Operator made. */
  const settingsWho = (): OwnerNow | undefined => { const p = setup.pages(); return p ? { owner: setup.settingsOwner ?? owner.whatsapp, base: p.ownerBase } : undefined; };
  const who = (): OwnerNow | undefined => { const p = setup.pages(); return p ? { owner: owner.whatsapp, base: p.ownerBase } : undefined; };

  /**
   * The moment before which no passkey works. The runtime's OWN value (owner-access.ts): the Operator's file can no longer set it once the owner holds a passkey, only
   * ask for it to be set after a wait the owner can cancel.
   */
  const passkeysBefore = (): number | undefined => access.passkeysBefore(setup.grants?.(), clock.now());

  /** The panel's "sign out every device" moment, clamped to the runtime's own clock (owner-access.ts clampEndBefore says why). */
  const endBefore = (): number | undefined => access.clampEndBefore(setup.endBefore(), clock.now());

  /** Is this the owner's "open my app"? Only from the owner's own number, only the fixed phrases, and only when the shop has an owner view to open. */
  const isOpenMyApp = (m: InboundMessage): boolean => sameNumber(m.from, owner.whatsapp) && !m.reply && m.text !== "" && OPEN_MY_APP.includes(phraseOf(m.text)) && who() !== undefined;

  /**
   * One link, if the shop's limits allow it: issued, sent in the owner's open window, and the outcome recorded under the link's short id. Item 11h: on WhatsApp only,
   * never as a push (push.ts whatsappOf says why); a shop with no WhatsApp sends none, and its owner signs in with their passkey.
   */
  async function sendLink(via: "page" | "whatsapp", ctx0: { messaging: Messaging; record: ActionRecord }): Promise<void> {
    const now = clock.now();
    const w = who();
    if (!w) { log("A sign-in link was asked for, but this shop has no pages file yet (its next deploy writes one): none was sent."); return; }
    if (!access.tryAttempt(now)) { log("A sign-in link was asked for more often than the shop's limit (3 a quarter of an hour, 10 a day): none was sent."); return; }
    // counted first, as every request is, so a shop with no WhatsApp cannot have its record flooded by asking either
    const wa = whatsappOf(ctx0.messaging);
    if (!wa) {
      ctx0.record.append({ conversation: owner.whatsapp, action: "owner_signin", outcome: "blocked", inputs: { via }, language: owner.language, notes: "This shop has no WhatsApp, so no sign-in link is sent: the owner signs in with their passkey (or the Operator's setup QR or recovery card).", refs: { to: "owner", via } });
      return;
    }
    const ctx = { ...ctx0, messaging: wa };
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
    async run(event: OwnerSigninEvent | OwnerAccessEvent | { kind: "message"; message: InboundMessage }, ctx: { messaging: Messaging; record: ActionRecord; store?: unknown }): Promise<void> {
      if (event.kind === "owner_access" && event.what === "file_taken") {
        ctx.record.append({ conversation: owner.whatsapp, action: FILE_TAKEN, outcome: "confirmed", inputs: { ask: event.ask ?? "" }, language: owner.language, refs: { ask: event.ask ?? "", session: event.session }, notes: "the owner's session took the file of their shop; the server's copy is deleted" });
        return;
      }
      if (event.kind === "owner_access") {
        const how = event.how ? { how: event.how } : {};
        const label = event.label ? { label: event.label } : {};
        ctx.record.append({ conversation: owner.whatsapp, action: "owner_session", outcome: "confirmed", inputs: { what: event.what, session: event.session, ...how, ...label }, language: owner.language, refs: { what: event.what, session: event.session, ...how, ...label } });
        return;
      }
      await sendLink(event.kind === "message" ? "whatsapp" : "page", ctx);
    },

    /** On the clock's beat: the panel's "sign out every device", said once in the record when the runtime first sees it. */
    tick(ctx: { record: ActionRecord; store?: unknown }): void {
      // owner's item 2: read the Operator's request and Geometer's reset into the runtime's own state (so a request starts its wait, and a due one applies, even when no
      // page is open), and say each once in the record. An Operator's request also reaches the owner's phones with alerts on, at once.
      if (setup.grants) {
        access.sync(setup.grants(), clock.now());
        const w = settingsWho();
        if (w) access.watchOwner(w, clock.now()); // a different owner number in the settings after the lock is a request, not a change (owner-access.ts)
        for (const n of access.takeNotes()) {
          const line = (inputs: Record<string, string>) => ctx.record.append({ conversation: owner.whatsapp, action: "owner_session", outcome: "confirmed", inputs, language: owner.language, refs: inputs });
          if (n.what === "reset") line({ what: "owner_reset", at: new Date(n.at).toISOString(), by: n.by, reason: n.reason });
          else if (n.what === "removal_asked") {
            line({ what: "removal_asked", by: n.askedBy, effectiveAt: new Date(n.effectiveAt).toISOString() });
            setup.alert?.(REMOVAL_ALERT(n.askedBy));
          } else if (n.what === "removal_extended") {
            line({ what: "removal_extended", effectiveAt: new Date(n.effectiveAt).toISOString() });
            setup.alert?.(n.kind === "owner_change" ? OWNER_CHANGE_ALERT : REMOVAL_ALERT(n.askedBy));
          } else if (n.what === "owner_change_asked") {
            line({ what: "owner_change_asked", effectiveAt: new Date(n.effectiveAt).toISOString() });
            setup.alert?.(OWNER_CHANGE_ALERT);
          } else line({ what: "removal_applied", at: new Date(n.at).toISOString() });
        }
      }
      const endAt = endBefore();
      if (endAt === undefined) return;
      const ended = access.endAllBefore(endAt, clock.now());
      if (ended === undefined) return;
      ctx.record.append({ conversation: owner.whatsapp, action: "owner_session", outcome: "confirmed", inputs: { what: "all_ended", endBefore: endAt }, language: owner.language, refs: { what: "all_ended", count: String(ended) } });
    },

    /** What the runtime's HTTP layer uses: each reads the owner and the address as they are now. */
    http: {
      linkState: (token: string) => { const w = who(); return w ? access.linkState(token, w, clock.now()) : "unknown" as const; },
      consume: (token: string) => { const w = who(); return w ? access.consume(token, w, clock.now()) : { ok: false as const, state: "unknown" as const }; },
      check: (session: string) => { const w = who(); return w ? access.check(session, w, clock.now(), endBefore()) : undefined; },
      /** The same, and only when the session was made with a passkey (the owner's limits page). */
      checkPasskey: (session: string) => { const w = who(); return w ? access.checkPasskey(session, w, clock.now(), endBefore()) : undefined; },
      end: (session: string) => access.end(session, clock.now()),
      // ---- item 11h: passkeys (each answers "unknown" or nothing for a shop with no pages file or no grants reader) ----
      shopName: setup.shopName,
      /** The owner's language and the shop's clock, for the new-phone alert (modules/runtime/http.ts). */
      ownerLanguage: owner.language,
      now: (): number => clock.now(),
      passkeysOn: (): boolean => setup.grants !== undefined && who() !== undefined,
      grantState: (g: Grant) => { const w = who(); return w && setup.grants ? access.grantState(g, setup.grants(), clock.now()) : "unknown" as const; },
      /** Too many wrong recovery codes today: the front says "wait" and nothing is checked. A wrong one is counted by `noteWrongCode`. */
      codesLocked: () => access.codesLocked(clock.now()),
      noteWrongCode: () => access.noteWrongCode(clock.now()),
      registrationOptions: (g: Grant) => {
        const w = who();
        if (!w || !setup.grants) return { ok: false as const, state: "unknown" as const };
        return access.registrationOptions(g, setup.grants(), w, relyingParty(w.base), setup.shopName || "Shop", clock.now());
      },
      register: (g: Grant, response: RegistrationResponse, label = "") => {
        const w = who();
        if (!w || !setup.grants) return { ok: false as const, state: "unknown" as const };
        return access.register(g, setup.grants(), w, relyingParty(w.base), response, clock.now(), label);
      },
      signinOptions: () => { const w = who(); return w && setup.grants ? access.signinOptions(w, relyingParty(w.base), clock.now(), passkeysBefore()) : { count: 0 }; },
      signin: (response: AssertionResponse) => {
        const w = who();
        if (!w || !setup.grants) return { ok: false as const, why: "Passkeys are not on for this shop." };
        return access.signin(response, w, relyingParty(w.base), clock.now(), passkeysBefore());
      },
      passkeys: () => { const w = who(); return w && setup.grants ? access.passkeys(w, relyingParty(w.base), passkeysBefore()) : []; },
      // ---- owner's item 2: the owner's phones. Each takes the owner's SESSION and checks it here (a link made in the panel opens none of them) ----
      /** The phones page's data, or undefined when the session is not good. */
      phones: (session: string) => {
        const w = who(); const ok = w && setup.grants ? access.check(session, w, clock.now(), endBefore()) : undefined;
        const sw = settingsWho();
        if (sw && ok) access.watchOwner(sw, clock.now());
        const view = w && ok ? access.phonesView(ok.id, w, relyingParty(w.base), setup.grants!(), clock.now()) : undefined;
        return view && sw && access.numberDiffers(sw) ? { ...view, numberDiffers: true } : view;
      },
      dismissPhones: (session: string, through?: number): boolean => { const w = who(); const ok = w ? access.check(session, w, clock.now(), endBefore()) : undefined; if (ok) access.dismiss(ok.id, clock.now(), through); return ok !== undefined; },
      /** Only a PASSKEY session may take a phone away (a WhatsApp link is whoever holds that phone). */
      removePhone: (session: string, phoneId: string, confirmLast: boolean) => {
        const w = who(); const ok = w && setup.grants ? access.checkPasskey(session, w, clock.now(), endBefore()) : undefined;
        if (!w || !ok) return { ok: false as const, why: "session" as const };
        return access.removePhone(ok.id, phoneId, w, relyingParty(w.base), setup.grants!(), clock.now(), confirmLast);
      },
      /** The passkey (phone) a session was made by, if it was made by one: what a push subscription is tied to. */
      passkeyOf: (session: string): string | undefined => { const w = who(); const ok = w ? access.checkPasskey(session, w, clock.now(), endBefore()) : undefined; return ok ? access.passkeyOfSession(ok.id) : undefined; },
      /** The owner's own codes, from a PASSKEY session only. Returned once. */
      makeCodes: (session: string): string[] | undefined => { const w = who(); const ok = w && setup.grants ? access.checkPasskey(session, w, clock.now(), endBefore()) : undefined; return ok ? access.makeOwnCodes(ok.id, setup.grants!(), clock.now()) : undefined; },
      /** "Add a phone": the link's address for the owner's new phone (a PASSKEY session only). Returned once. */
      addPhone: (session: string): { url: string; expiresAt: number } | undefined => {
        const w = who(); const ok = w && setup.grants ? access.checkPasskey(session, w, clock.now(), endBefore()) : undefined;
        const made = ok ? access.addPhone(ok.id, setup.grants!(), clock.now()) : undefined;
        return w && made ? { url: `${w.base}/setup/${made.token}`, expiresAt: made.expiresAt } : undefined;
      },
      cancelRemoval: (session: string): boolean => { const w = who(); const ok = w && setup.grants ? access.check(session, w, clock.now(), endBefore()) : undefined; return ok ? access.cancelRemoval(setup.grants!(), clock.now()) : false; },
      /** For the panel's probe (/status): whether the shop is locked (the owner holds a passkey) and the Operator's pending request. Counts and times only. */
      lockState: () => { const w = settingsWho(); if (w) access.watchOwner(w, clock.now()); const g = setup.grants?.(); return { locked: access.locked(g, clock.now()), removal: access.pendingRemoval(g, clock.now()) }; },
    },
  };
}
export type OwnerSignin = ReturnType<typeof createOwnerSignin>;
