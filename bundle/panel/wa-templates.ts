// The panel's side of a shop's WhatsApp message templates (25 Nov 2026): it SUBMITS the shop's template set to the shop's own WhatsApp account and SHOWS their state, in
// plain words, on the shop page, the checks page and the go-live confirmation. Everything it decides about templates is bundle/lib/wa-templates.ts, the same code the
// command line (`geometer whatsapp-templates`) runs; this file only says when, through which address, and what the page says.
//
// How it reaches the provider: through the shop's own WhatsApp Guard, with the panel's own Guard credential (the one its connection checks present). The panel holds no
// WhatsApp key and has no way out to the internet (compose.ts gives it only the Guards' agent ports); the Guard adds the shop's key, and lets the panel's agent (and only
// it) list and submit templates in exactly the shop's own account (bundle/generate/guards.ts agentOperations).
//
// When:
//  - after the panel saves a shop's WhatsApp connection (the setup's save), in the background: submit what the account does not hold. A new shop's Guard is not running
//    until the deployer applies it, so that first try is usually "waiting"; then
//  - after "Run the checks" on the checks page (the shop is applied by then), in the background, the same submission; and
//  - when the Operator presses "Send the N not sent yet" on the shop page (a shop set up before a template update needs just the new ones).
//  - The shop page READS the state (never sends) when what it has is older than STALE_MS, waiting at most a few seconds for the answer.
// One run per shop at a time; each is queued behind the one before. Every run is tolerant: a failure is a state with a plain line, never a crash.
//
// The go-live gate WARNS and does not block (owner's brief, 25 Nov): a shop runs inside the customer's 24-hour window from day one, and Meta takes up to a day. The
// checks page and the confirmation say how many are approved and what that means; "Ready to go live" does not wait for them.
//
// Words: four languages here (machine-written Hindi, Malayalam and Kannada, on the review sheets: WA_TEMPLATE_WORDS in review.ts).
import type { Language } from "../../modules/language/languages.ts";
import { accountOf, guardCall, gupshupProvider, metaProvider, missingFor, run, shopTemplateSet, statusRows, StopError, TemplateSetConflict } from "../lib/wa-templates.ts";
import type { Bucket, Missing, Provider, Refusal, Row, Stop } from "../lib/wa-templates.ts";
import { guardUrlFor, readGuardAgentToken } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { rawSettings } from "./confirmations.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";
import type { Template } from "./templates.ts";
import { html } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Ctx } from "./views.ts";

/** How old a stored state may be before the shop page asks again (it asks only when the page is opened). */
export const STALE_MS = 10 * 60_000;
/** How long the shop page waits for a fresh read before it shows what it has, with "asking now". */
export const PAGE_WAIT_MS = 4_000;
/** At most this many names in a list on a page (rejected, refused): the rest are counted. */
const LIST_MAX = 20;

/** Why nothing could be read or sent: the lib's missing ids, or this server has no Guards' address. */
export type Blocked = Missing | "no-guard" | "conflict";

/** What the panel keeps of a shop's templates (panel data, wa-templates/<shop>.json): counts and names only, nothing secret, nothing about a customer. */
export interface WaState {
  schema: 1;
  /** When the provider was last asked (or the last try that could not ask). */
  at: string;
  provider?: string;
  total: number;
  counts?: Record<Bucket, number>;
  /** Rejected, and paused or turned off, with the provider's reason as it wrote it. */
  rejected?: { name: string; language: string; reason?: string }[];
  stopped?: { name: string; language: string; state: string }[];
  /** The last submission: when, how many went, which were refused, which cannot be sent from here. */
  sent?: { at: string; count: number; refused: Refusal[]; unsendable: Refusal[] };
  /** Why the last run stopped, or could not start. */
  stop?: Stop;
  blocked?: Blocked;
}

export interface WaView { state?: WaState; busy: boolean }

export function createWaTemplates(config: PanelConfig, shops: Shops, store: Store, templates: () => Template[], log: (line: string) => void) {
  const now = () => (config.now ?? Date.now)();
  const iso = () => new Date(now()).toISOString();
  const agentToken = readGuardAgentToken(config);
  const pause = config.templatesPause ?? (() => new Promise<void>((res) => setTimeout(res, 500)));
  const file = (shop: string) => `wa-templates/${shop}.json`;
  const stored = (shop: string) => store.read<WaState>(file(shop));
  const tails = new Map<string, Promise<void>>();

  /** The provider for this shop through its Guard, or why there is none. `undefined`: the shop has no WhatsApp (nothing to show). */
  function providerFor(shop: string, mode: "read" | "submit"): { provider: Provider } | { blocked: Blocked } | undefined {
    const account = accountOf(shops.runtime(shop));
    if (!account) return undefined;
    const missing = missingFor(account, mode);
    if (missing) return { blocked: missing };
    if (!config.guardUrl) return { blocked: "no-guard" };
    const call = guardCall(guardUrlFor(config, shop, "whatsapp") as string, agentToken);
    if (account.provider === "meta") return { provider: metaProvider(call, account.wabaId!) };
    if (account.provider === "gupshup-selfserve") return { provider: gupshupProvider(call, account) };
    return { blocked: "provider" };
  }

  async function once(shop: string, mode: "status" | "submit"): Promise<void> {
    const before = stored(shop);
    const write = (s: Omit<WaState, "schema" | "at">) => store.write(file(shop), { schema: 1, at: iso(), ...s });
    let entries;
    try {
      entries = shopTemplateSet({ templateId: shops.kind(shop), settings: rawSettings(shops, shop), folderOf: (id) => templates().find((t) => t.id === id)?.folder });
    } catch (e) {
      if (e instanceof TemplateSetConflict) { write({ total: 0, blocked: "conflict", stop: { kind: "other", message: e.message } }); return; }
      throw e;
    }
    if (entries.length === 0) return; // a shop whose template sends no WhatsApp message: nothing to keep
    const p = providerFor(shop, mode === "submit" ? "submit" : "read");
    if (!p) { store.remove(file(shop)); return; }
    if ("blocked" in p) {
      // an account without the id the CREATE needs (a Gupshup app with no id) can still be read: the page then shows the state and says what is missing
      const read = mode === "submit" && p.blocked === "app-id" ? providerFor(shop, "read") : undefined;
      if (read && "provider" in read) {
        const r = await run({ entries, provider: read.provider, mode: "status" });
        write({ provider: read.provider.label, total: entries.length, blocked: p.blocked, ...stateOf(entries, r.held), ...(r.stopped ? { stop: r.stopped } : {}) });
        return;
      }
      write({ total: entries.length, blocked: p.blocked });
      return;
    }
    const r = await run({ entries, provider: p.provider, mode, pause });
    const sent = mode === "submit" && (r.sent > 0 || r.refused.length > 0 || r.unsendable.length > 0) ? { at: iso(), count: r.sent, refused: r.refused.slice(0, LIST_MAX), unsendable: r.unsendable.slice(0, LIST_MAX) } : before?.sent;
    write({ provider: p.provider.label, total: entries.length, ...(r.held ? stateOf(entries, r.held) : { counts: before?.counts, rejected: before?.rejected, stopped: before?.stopped }), ...(sent ? { sent } : {}), ...(r.stopped ? { stop: r.stopped } : {}) });
    log(`wa-templates ${shop}: ${mode}${mode === "submit" ? `, ${r.sent} sent, ${r.refused.length} refused` : ""}${r.stopped ? `, stopped (${r.stopped.kind})` : ""}`);
  }

  /** Queue one run for the shop behind any that is going; a failure is kept as a state, never thrown into the page. */
  function sync(shop: string, mode: "status" | "submit"): Promise<void> {
    const next = (tails.get(shop) ?? Promise.resolve()).then(() => once(shop, mode)).catch((e: unknown) => {
      const stop = e instanceof StopError ? e.stop : { kind: "other" as const, message: (e as Error)?.message ?? String(e) };
      try { store.write(file(shop), { ...(stored(shop) ?? { total: 0 }), schema: 1, at: iso(), stop }); } catch { /* the panel's data folder is not writable: the page says nothing new */ }
      log(`wa-templates ${shop}: ${mode} failed (${stop.message})`);
    });
    tails.set(shop, next);
    void next.finally(() => { if (tails.get(shop) === next) tails.delete(shop); });
    return next;
  }

  return {
    stored,
    sync,
    /** After a save, the checks run, or the Operator's button: submit in the background. */
    submit(shop: string): void { void sync(shop, "submit"); },
    /** The shop page: read again only when what is kept is older than STALE_MS, and wait a little for it. Never sends. */
    async fresh(shop: string): Promise<WaView> {
      const s = stored(shop);
      const old = !s || now() - Date.parse(s.at) > STALE_MS;
      if (old && !tails.has(shop)) {
        const going = sync(shop, "status");
        await Promise.race([going, new Promise((res) => setTimeout(res, PAGE_WAIT_MS).unref())]);
      }
      return { ...(stored(shop) ? { state: stored(shop)! } : {}), busy: tails.has(shop) };
    },
    view(shop: string): WaView { return { ...(stored(shop) ? { state: stored(shop)! } : {}), busy: tails.has(shop) }; },
    /** Every run that is going, finished: for a test, and for the panel's close. */
    async settled(): Promise<void> { while (tails.size > 0) await Promise.all([...tails.values()]); },
  };
}
export type WaTemplates = ReturnType<typeof createWaTemplates>;

/** The counts, the rejected ones with their reasons, and the paused ones, from what the account holds. */
function stateOf(entries: Parameters<typeof statusRows>[0], held: Parameters<typeof statusRows>[1] | undefined): Pick<WaState, "counts" | "rejected" | "stopped"> {
  if (!held) return {};
  const { rows, counts } = statusRows(entries, held);
  const pick = (b: Bucket) => rows.filter((r: Row) => r.bucket === b);
  return {
    counts,
    rejected: pick("rejected").slice(0, LIST_MAX).map((r) => ({ name: r.name, language: r.language, ...(r.reason ? { reason: r.reason } : {}) })),
    stopped: pick("stopped").slice(0, LIST_MAX).map((r) => ({ name: r.name, language: r.language, state: r.state ?? "" })),
  };
}

// ---- the words ----------------------------------------------------------------------------------------------------------------------------------------

interface WaWords {
  heading: string; intro: string;
  label: Record<Bucket, string>;
  asOf: (provider: string, at: string) => string;
  asking: string; busy: string; never: string;
  allApproved: string; pendingHelp: string;
  rejectedHead: string; noReason: string; rejectedHelp: string; stoppedHead: string; stoppedHelp: string;
  refusedHead: string; cannotHead: string; more: (n: number) => string;
  send: (n: number) => string; ask: string;
  blocked: Record<Blocked, string>;
  stop: { key: (provider: string) => string; rate: string; unreachable: string; guard: string; other: string };
  checks: { ok: string; warn: (approved: number, total: number) => string; none: string };
  setup: { wabaId: string; wabaIdHelp: string; wabaIdBad: string; appId: string; appIdHelp: string; appIdBad: string };
}

/** Exported so the native reviewer's sheet lists these lines too (review.ts, ids "waTemplates.*"). */
export const WA_TEMPLATE_WORDS: Record<Language, WaWords> = {
  en: {
    heading: "WhatsApp message wordings",
    intro: "Meta approves each wording the shop sends after a customer's 24 hours are over. The panel sends them to the shop's own WhatsApp account and shows what came back.",
    label: { approved: "Approved", pending: "Waiting for approval", rejected: "Rejected", stopped: "Paused or turned off", "not-submitted": "Not sent yet" },
    asOf: (provider, at) => `As ${provider} said at ${at}.`,
    asking: "Asking now. Open this page again in a minute.", busy: "Sending the wordings now. Open this page again in a minute.", never: "Not asked yet.",
    allApproved: "Every wording is approved: the shop can message customers at any time.",
    pendingHelp: "Approval usually comes within a day. Until then the shop still answers every customer within 24 hours of their message.",
    rejectedHead: "Rejected, with the reason given:", noReason: "no reason given",
    rejectedHelp: "What to do: open WhatsApp Manager (or the Gupshup dashboard), read the reason, and ask for a review there if the words are right. If the words need changing, write to hello@geometer.dev with the name.",
    stoppedHead: "Paused or turned off:", stoppedHelp: "What to do: open WhatsApp Manager (or the Gupshup dashboard) to see why, and turn it on again there.",
    refusedHead: "Refused when sent:", cannotHead: "Cannot be sent from here (add these by hand):", more: (n) => `and ${n} more`,
    send: (n) => `Send the ${n} not sent yet`, ask: "Ask again now",
    blocked: {
      "account-id": "Add the shop's WhatsApp Business Account ID in its WhatsApp step (Edit the settings), so the panel can send the wordings. Meta shows it on the API Setup page, next to the phone number ID.",
      "app-id": "Add the Gupshup app ID in the shop's WhatsApp step (Edit the settings), so the panel can send the wordings. Gupshup shows it on the app's page.",
      provider: "This shop's WhatsApp runs through another company's Gupshup account, and that company adds the wordings. Ask them how they stand.",
      "no-guard": "This server has not said where the shops' connections are, so the panel cannot send the wordings. Run geometer whatsapp-templates on the server instead.",
      conflict: "Two parts of this shop give one wording name different words, so nothing was sent. Write to hello@geometer.dev.",
    },
    stop: {
      key: (provider) => `${provider} did not accept the shop's key. Hand it in again in the shop's WhatsApp step, then press the button below.`,
      rate: "Meta takes up to 100 new wordings an hour. Press the button again in an hour for the rest.",
      unreachable: "The shop's WhatsApp connection is not running yet, so nothing was sent. Once the server has applied the shop, press the button below.",
      guard: "The shop's connection did not allow this. If the server was updated just now, wait for it to apply the shop, then press the button again.",
      other: "Something went wrong while asking. Press the button again; if it stays, write to hello@geometer.dev.",
    },
    checks: {
      ok: "WhatsApp wordings: all approved.",
      warn: (approved, total) => `WhatsApp wordings: ${approved} of ${total} approved. You can still go live: until the rest are approved, the shop answers customers within 24 hours of their message, and a message after that waits for its approval.`,
      none: "WhatsApp wordings: not asked yet. The panel sends them once the shop's connection is running.",
    },
    setup: {
      wabaId: "WhatsApp Business Account ID", wabaIdHelp: "Digits. Meta shows it on the API Setup page, next to the phone number ID. The panel sends the shop's message wordings to this account for approval.",
      wabaIdBad: "The WhatsApp Business Account ID is digits only (6 to 20 of them).",
      appId: "Gupshup app ID", appIdHelp: "On the app's page in Gupshup. The panel sends the shop's message wordings to this app for approval.",
      appIdBad: "The Gupshup app ID is letters, digits and hyphens, as Gupshup shows it.",
    },
  },
  hi: {
    heading: "WhatsApp संदेशों के शब्द",
    intro: "ग्राहक के 24 घंटे पूरे होने के बाद दुकान जो भी संदेश भेजती है, उसके शब्द Meta पहले मंज़ूर करता है। पैनल ये शब्द दुकान के अपने WhatsApp खाते में भेजता है और बताता है कि क्या जवाब आया।",
    label: { approved: "मंज़ूर", pending: "मंज़ूरी का इंतज़ार", rejected: "नामंज़ूर", stopped: "रुका हुआ या बंद", "not-submitted": "अभी नहीं भेजा" },
    asOf: (provider, at) => `${at} पर ${provider} ने यही बताया।`,
    asking: "अभी पूछ रहे हैं। एक मिनट बाद यह पेज फिर खोलें।", busy: "शब्द अभी भेजे जा रहे हैं। एक मिनट बाद यह पेज फिर खोलें।", never: "अभी पूछा नहीं गया।",
    allApproved: "सारे शब्द मंज़ूर हैं: दुकान कभी भी ग्राहकों को संदेश भेज सकती है।",
    pendingHelp: "मंज़ूरी आमतौर पर एक दिन में आ जाती है। तब तक भी दुकान हर ग्राहक को उसके संदेश के 24 घंटे के अंदर जवाब देती है।",
    rejectedHead: "नामंज़ूर, बताए गए कारण के साथ:", noReason: "कोई कारण नहीं बताया",
    rejectedHelp: "क्या करें: WhatsApp Manager (या Gupshup डैशबोर्ड) खोलें, कारण पढ़ें, और अगर शब्द ठीक हैं तो वहीं दोबारा जाँच माँगें। अगर शब्द बदलने हैं, तो नाम के साथ hello@geometer.dev पर लिखें।",
    stoppedHead: "रुका हुआ या बंद:", stoppedHelp: "क्या करें: कारण देखने के लिए WhatsApp Manager (या Gupshup डैशबोर्ड) खोलें, और वहीं इसे फिर चालू करें।",
    refusedHead: "भेजते समय मना किया गया:", cannotHead: "यहाँ से नहीं भेजे जा सकते (इन्हें हाथ से जोड़ें):", more: (n) => `और ${n} और`,
    send: (n) => `अभी तक न भेजे गए ${n} भेजें`, ask: "अभी फिर पूछें",
    blocked: {
      "account-id": "दुकान के WhatsApp चरण में (सेटिंग बदलें) उसका WhatsApp Business Account ID जोड़ें, ताकि पैनल शब्द भेज सके। Meta इसे API Setup पेज पर, फ़ोन नंबर ID के पास दिखाता है।",
      "app-id": "दुकान के WhatsApp चरण में (सेटिंग बदलें) Gupshup app ID जोड़ें, ताकि पैनल शब्द भेज सके। Gupshup इसे ऐप के पेज पर दिखाता है।",
      provider: "इस दुकान का WhatsApp किसी दूसरी कंपनी के Gupshup खाते से चलता है, और वही कंपनी शब्द जोड़ती है। उनसे पूछें कि क्या स्थिति है।",
      "no-guard": "इस सर्वर ने नहीं बताया कि दुकानों के कनेक्शन कहाँ हैं, इसलिए पैनल शब्द नहीं भेज सकता। इसके बजाय सर्वर पर geometer whatsapp-templates चलाएँ।",
      conflict: "इस दुकान के दो हिस्से एक ही नाम को अलग-अलग शब्द देते हैं, इसलिए कुछ नहीं भेजा गया। hello@geometer.dev पर लिखें।",
    },
    stop: {
      key: (provider) => `${provider} ने दुकान की key नहीं मानी। दुकान के WhatsApp चरण में इसे फिर से दें, फिर नीचे वाला बटन दबाएँ।`,
      rate: "Meta एक घंटे में ज़्यादा से ज़्यादा 100 नए शब्द लेता है। बाक़ी के लिए एक घंटे बाद बटन फिर दबाएँ।",
      unreachable: "दुकान का WhatsApp कनेक्शन अभी चल नहीं रहा, इसलिए कुछ नहीं भेजा गया। सर्वर दुकान को लागू कर दे, तब नीचे वाला बटन दबाएँ।",
      guard: "दुकान के कनेक्शन ने इसकी इजाज़त नहीं दी। अगर सर्वर अभी अपडेट हुआ है, तो उसके दुकान लागू करने का इंतज़ार करें, फिर बटन दबाएँ।",
      other: "पूछते समय कुछ गड़बड़ हुई। बटन फिर दबाएँ; अगर ऐसा ही रहे, तो hello@geometer.dev पर लिखें।",
    },
    checks: {
      ok: "WhatsApp शब्द: सब मंज़ूर।",
      warn: (approved, total) => `WhatsApp शब्द: ${total} में से ${approved} मंज़ूर। आप फिर भी लाइव जा सकते हैं: बाक़ी मंज़ूर होने तक दुकान ग्राहकों को उनके संदेश के 24 घंटे के अंदर जवाब देती है, और उसके बाद का संदेश अपनी मंज़ूरी का इंतज़ार करता है।`,
      none: "WhatsApp शब्द: अभी पूछा नहीं गया। दुकान का कनेक्शन चलते ही पैनल इन्हें भेज देता है।",
    },
    setup: {
      wabaId: "WhatsApp Business Account ID", wabaIdHelp: "सिर्फ़ अंक। Meta इसे API Setup पेज पर, फ़ोन नंबर ID के पास दिखाता है। पैनल दुकान के संदेशों के शब्द मंज़ूरी के लिए इसी खाते में भेजता है।",
      wabaIdBad: "WhatsApp Business Account ID में सिर्फ़ अंक होते हैं (6 से 20)।",
      appId: "Gupshup app ID", appIdHelp: "Gupshup में ऐप के पेज पर। पैनल दुकान के संदेशों के शब्द मंज़ूरी के लिए इसी ऐप में भेजता है।",
      appIdBad: "Gupshup app ID में अक्षर, अंक और हाइफ़न होते हैं, जैसा Gupshup दिखाता है।",
    },
  },
  ml: {
    heading: "WhatsApp സന്ദേശങ്ങളുടെ വാക്കുകൾ",
    intro: "ഒരു ഉപഭോക്താവിന്റെ 24 മണിക്കൂർ കഴിഞ്ഞ് കട അയയ്ക്കുന്ന ഓരോ സന്ദേശത്തിന്റെയും വാക്കുകൾ Meta ആദ്യം അംഗീകരിക്കണം. പാനൽ അവ കടയുടെ സ്വന്തം WhatsApp അക്കൗണ്ടിലേക്ക് അയച്ച്, കിട്ടിയ മറുപടി കാണിക്കുന്നു.",
    label: { approved: "അംഗീകരിച്ചു", pending: "അംഗീകാരത്തിനായി കാത്തിരിക്കുന്നു", rejected: "നിരസിച്ചു", stopped: "നിർത്തിവെച്ചു അല്ലെങ്കിൽ ഓഫാക്കി", "not-submitted": "ഇതുവരെ അയച്ചിട്ടില്ല" },
    asOf: (provider, at) => `${at}-ന് ${provider} പറഞ്ഞത് ഇതാണ്.`,
    asking: "ഇപ്പോൾ ചോദിക്കുന്നു. ഒരു മിനിറ്റ് കഴിഞ്ഞ് ഈ പേജ് വീണ്ടും തുറക്കുക.", busy: "വാക്കുകൾ ഇപ്പോൾ അയയ്ക്കുന്നു. ഒരു മിനിറ്റ് കഴിഞ്ഞ് ഈ പേജ് വീണ്ടും തുറക്കുക.", never: "ഇതുവരെ ചോദിച്ചിട്ടില്ല.",
    allApproved: "എല്ലാ വാക്കുകളും അംഗീകരിച്ചു: കടയ്ക്ക് ഏതു സമയത്തും ഉപഭോക്താക്കൾക്ക് സന്ദേശം അയയ്ക്കാം.",
    pendingHelp: "അംഗീകാരം സാധാരണ ഒരു ദിവസത്തിനകം വരും. അതുവരെയും കട ഓരോ ഉപഭോക്താവിനും അവരുടെ സന്ദേശം കഴിഞ്ഞ് 24 മണിക്കൂറിനകം മറുപടി നൽകുന്നു.",
    rejectedHead: "നിരസിച്ചവ, പറഞ്ഞ കാരണത്തോടെ:", noReason: "കാരണം പറഞ്ഞിട്ടില്ല",
    rejectedHelp: "എന്തു ചെയ്യണം: WhatsApp Manager (അല്ലെങ്കിൽ Gupshup ഡാഷ്ബോർഡ്) തുറന്ന് കാരണം വായിക്കുക; വാക്കുകൾ ശരിയാണെങ്കിൽ അവിടെത്തന്നെ വീണ്ടും പരിശോധന ആവശ്യപ്പെടുക. വാക്കുകൾ മാറ്റണമെങ്കിൽ പേരോടെ hello@geometer.dev-ലേക്ക് എഴുതുക.",
    stoppedHead: "നിർത്തിവെച്ചവ അല്ലെങ്കിൽ ഓഫാക്കിയവ:", stoppedHelp: "എന്തു ചെയ്യണം: കാരണം അറിയാൻ WhatsApp Manager (അല്ലെങ്കിൽ Gupshup ഡാഷ്ബോർഡ്) തുറക്കുക, അവിടെത്തന്നെ വീണ്ടും ഓണാക്കുക.",
    refusedHead: "അയച്ചപ്പോൾ നിരസിച്ചവ:", cannotHead: "ഇവിടെ നിന്ന് അയയ്ക്കാൻ കഴിയാത്തവ (ഇവ കൈകൊണ്ട് ചേർക്കുക):", more: (n) => `കൂടാതെ ${n} എണ്ണം കൂടി`,
    send: (n) => `ഇതുവരെ അയയ്ക്കാത്ത ${n} എണ്ണം അയയ്ക്കുക`, ask: "ഇപ്പോൾ വീണ്ടും ചോദിക്കുക",
    blocked: {
      "account-id": "പാനലിന് വാക്കുകൾ അയയ്ക്കാൻ, കടയുടെ WhatsApp ഘട്ടത്തിൽ (ക്രമീകരണങ്ങൾ മാറ്റുക) അതിന്റെ WhatsApp Business Account ID ചേർക്കുക. Meta ഇത് API Setup പേജിൽ, ഫോൺ നമ്പർ ID-യുടെ അടുത്ത് കാണിക്കുന്നു.",
      "app-id": "പാനലിന് വാക്കുകൾ അയയ്ക്കാൻ, കടയുടെ WhatsApp ഘട്ടത്തിൽ (ക്രമീകരണങ്ങൾ മാറ്റുക) Gupshup app ID ചേർക്കുക. Gupshup ഇത് ആപ്പിന്റെ പേജിൽ കാണിക്കുന്നു.",
      provider: "ഈ കടയുടെ WhatsApp മറ്റൊരു കമ്പനിയുടെ Gupshup അക്കൗണ്ട് വഴിയാണ്; വാക്കുകൾ ആ കമ്പനിയാണ് ചേർക്കുന്നത്. സ്ഥിതി എന്താണെന്ന് അവരോട് ചോദിക്കുക.",
      "no-guard": "കടകളുടെ കണക്ഷനുകൾ എവിടെയാണെന്ന് ഈ സെർവർ പറഞ്ഞിട്ടില്ല, അതിനാൽ പാനലിന് വാക്കുകൾ അയയ്ക്കാൻ കഴിയില്ല. പകരം സെർവറിൽ geometer whatsapp-templates പ്രവർത്തിപ്പിക്കുക.",
      conflict: "ഈ കടയുടെ രണ്ട് ഭാഗങ്ങൾ ഒരേ പേരിന് വ്യത്യസ്ത വാക്കുകൾ നൽകുന്നു, അതിനാൽ ഒന്നും അയച്ചില്ല. hello@geometer.dev-ലേക്ക് എഴുതുക.",
    },
    stop: {
      key: (provider) => `${provider} കടയുടെ key സ്വീകരിച്ചില്ല. കടയുടെ WhatsApp ഘട്ടത്തിൽ അത് വീണ്ടും നൽകി, താഴെയുള്ള ബട്ടൺ അമർത്തുക.`,
      rate: "Meta ഒരു മണിക്കൂറിൽ പരമാവധി 100 പുതിയ വാക്കുകൾ എടുക്കും. ബാക്കിയുള്ളവയ്ക്ക് ഒരു മണിക്കൂർ കഴിഞ്ഞ് ബട്ടൺ വീണ്ടും അമർത്തുക.",
      unreachable: "കടയുടെ WhatsApp കണക്ഷൻ ഇതുവരെ പ്രവർത്തിക്കുന്നില്ല, അതിനാൽ ഒന്നും അയച്ചില്ല. സെർവർ കട പ്രയോഗിച്ചു കഴിഞ്ഞാൽ താഴെയുള്ള ബട്ടൺ അമർത്തുക.",
      guard: "കടയുടെ കണക്ഷൻ ഇത് അനുവദിച്ചില്ല. സെർവർ ഇപ്പോൾ അപ്ഡേറ്റ് ചെയ്തതാണെങ്കിൽ, അത് കട പ്രയോഗിക്കുന്നതുവരെ കാത്തിരുന്ന് ബട്ടൺ വീണ്ടും അമർത്തുക.",
      other: "ചോദിക്കുമ്പോൾ എന്തോ പിശക് പറ്റി. ബട്ടൺ വീണ്ടും അമർത്തുക; അങ്ങനെത്തന്നെ തുടർന്നാൽ hello@geometer.dev-ലേക്ക് എഴുതുക.",
    },
    checks: {
      ok: "WhatsApp വാക്കുകൾ: എല്ലാം അംഗീകരിച്ചു.",
      warn: (approved, total) => `WhatsApp വാക്കുകൾ: ${total}-ൽ ${approved} എണ്ണം അംഗീകരിച്ചു. എന്നിട്ടും ലൈവ് ആകാം: ബാക്കിയുള്ളവ അംഗീകരിക്കുന്നതുവരെ കട ഉപഭോക്താക്കൾക്ക് അവരുടെ സന്ദേശം കഴിഞ്ഞ് 24 മണിക്കൂറിനകം മറുപടി നൽകും; അതിനു ശേഷമുള്ള സന്ദേശം അതിന്റെ അംഗീകാരത്തിനായി കാത്തിരിക്കും.`,
      none: "WhatsApp വാക്കുകൾ: ഇതുവരെ ചോദിച്ചിട്ടില്ല. കടയുടെ കണക്ഷൻ പ്രവർത്തിച്ചു തുടങ്ങിയാൽ പാനൽ അവ അയയ്ക്കും.",
    },
    setup: {
      wabaId: "WhatsApp Business Account ID", wabaIdHelp: "അക്കങ്ങൾ മാത്രം. Meta ഇത് API Setup പേജിൽ, ഫോൺ നമ്പർ ID-യുടെ അടുത്ത് കാണിക്കുന്നു. പാനൽ കടയുടെ സന്ദേശ വാക്കുകൾ അംഗീകാരത്തിനായി ഈ അക്കൗണ്ടിലേക്ക് അയയ്ക്കുന്നു.",
      wabaIdBad: "WhatsApp Business Account ID-യിൽ അക്കങ്ങൾ മാത്രം (6 മുതൽ 20 വരെ).",
      appId: "Gupshup app ID", appIdHelp: "Gupshup-ൽ ആപ്പിന്റെ പേജിൽ. പാനൽ കടയുടെ സന്ദേശ വാക്കുകൾ അംഗീകാരത്തിനായി ഈ ആപ്പിലേക്ക് അയയ്ക്കുന്നു.",
      appIdBad: "Gupshup app ID-യിൽ Gupshup കാണിക്കുന്നതുപോലെ അക്ഷരങ്ങളും അക്കങ്ങളും ഹൈഫനുകളും.",
    },
  },
  kn: {
    heading: "WhatsApp ಸಂದೇಶಗಳ ಪದಗಳು",
    intro: "ಗ್ರಾಹಕರ 24 ಗಂಟೆಗಳು ಮುಗಿದ ನಂತರ ಅಂಗಡಿ ಕಳುಹಿಸುವ ಪ್ರತಿ ಸಂದೇಶದ ಪದಗಳನ್ನು Meta ಮೊದಲು ಒಪ್ಪಬೇಕು. ಪ್ಯಾನೆಲ್ ಅವನ್ನು ಅಂಗಡಿಯ ಸ್ವಂತ WhatsApp ಖಾತೆಗೆ ಕಳುಹಿಸಿ, ಬಂದ ಉತ್ತರವನ್ನು ತೋರಿಸುತ್ತದೆ.",
    label: { approved: "ಒಪ್ಪಲಾಗಿದೆ", pending: "ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ", rejected: "ತಿರಸ್ಕರಿಸಲಾಗಿದೆ", stopped: "ನಿಲ್ಲಿಸಲಾಗಿದೆ ಅಥವಾ ಆಫ್ ಮಾಡಲಾಗಿದೆ", "not-submitted": "ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ" },
    asOf: (provider, at) => `${at} ಕ್ಕೆ ${provider} ಹೇಳಿದ್ದು ಇದು.`,
    asking: "ಈಗ ಕೇಳುತ್ತಿದ್ದೇವೆ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಈ ಪುಟವನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ.", busy: "ಪದಗಳನ್ನು ಈಗ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ. ಒಂದು ನಿಮಿಷದ ನಂತರ ಈ ಪುಟವನ್ನು ಮತ್ತೆ ತೆರೆಯಿರಿ.", never: "ಇನ್ನೂ ಕೇಳಿಲ್ಲ.",
    allApproved: "ಎಲ್ಲಾ ಪದಗಳನ್ನು ಒಪ್ಪಲಾಗಿದೆ: ಅಂಗಡಿ ಯಾವಾಗ ಬೇಕಾದರೂ ಗ್ರಾಹಕರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಬಹುದು.",
    pendingHelp: "ಒಪ್ಪಿಗೆ ಸಾಮಾನ್ಯವಾಗಿ ಒಂದು ದಿನದೊಳಗೆ ಬರುತ್ತದೆ. ಅಲ್ಲಿಯವರೆಗೂ ಅಂಗಡಿ ಪ್ರತಿ ಗ್ರಾಹಕರಿಗೆ ಅವರ ಸಂದೇಶದ 24 ಗಂಟೆಗಳೊಳಗೆ ಉತ್ತರಿಸುತ್ತದೆ.",
    rejectedHead: "ತಿರಸ್ಕರಿಸಿದವು, ಹೇಳಿದ ಕಾರಣದೊಂದಿಗೆ:", noReason: "ಕಾರಣ ಹೇಳಿಲ್ಲ",
    rejectedHelp: "ಏನು ಮಾಡಬೇಕು: WhatsApp Manager (ಅಥವಾ Gupshup ಡ್ಯಾಶ್‌ಬೋರ್ಡ್) ತೆರೆದು ಕಾರಣ ಓದಿ; ಪದಗಳು ಸರಿಯಾಗಿದ್ದರೆ ಅಲ್ಲೇ ಮರುಪರಿಶೀಲನೆ ಕೇಳಿ. ಪದಗಳನ್ನು ಬದಲಿಸಬೇಕಾದರೆ ಹೆಸರಿನೊಂದಿಗೆ hello@geometer.dev ಗೆ ಬರೆಯಿರಿ.",
    stoppedHead: "ನಿಲ್ಲಿಸಿದವು ಅಥವಾ ಆಫ್ ಮಾಡಿದವು:", stoppedHelp: "ಏನು ಮಾಡಬೇಕು: ಕಾರಣ ನೋಡಲು WhatsApp Manager (ಅಥವಾ Gupshup ಡ್ಯಾಶ್‌ಬೋರ್ಡ್) ತೆರೆಯಿರಿ, ಅಲ್ಲೇ ಮತ್ತೆ ಆನ್ ಮಾಡಿ.",
    refusedHead: "ಕಳುಹಿಸಿದಾಗ ನಿರಾಕರಿಸಿದವು:", cannotHead: "ಇಲ್ಲಿಂದ ಕಳುಹಿಸಲಾಗದವು (ಇವನ್ನು ಕೈಯಾರೆ ಸೇರಿಸಿ):", more: (n) => `ಮತ್ತು ಇನ್ನೂ ${n}`,
    send: (n) => `ಇನ್ನೂ ಕಳುಹಿಸದ ${n} ಕಳುಹಿಸಿ`, ask: "ಈಗ ಮತ್ತೆ ಕೇಳಿ",
    blocked: {
      "account-id": "ಪ್ಯಾನೆಲ್ ಪದಗಳನ್ನು ಕಳುಹಿಸಲು, ಅಂಗಡಿಯ WhatsApp ಹಂತದಲ್ಲಿ (ಸೆಟ್ಟಿಂಗ್ ಬದಲಿಸಿ) ಅದರ WhatsApp Business Account ID ಸೇರಿಸಿ. Meta ಇದನ್ನು API Setup ಪುಟದಲ್ಲಿ, ಫೋನ್ ನಂಬರ್ ID ಪಕ್ಕದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ.",
      "app-id": "ಪ್ಯಾನೆಲ್ ಪದಗಳನ್ನು ಕಳುಹಿಸಲು, ಅಂಗಡಿಯ WhatsApp ಹಂತದಲ್ಲಿ (ಸೆಟ್ಟಿಂಗ್ ಬದಲಿಸಿ) Gupshup app ID ಸೇರಿಸಿ. Gupshup ಇದನ್ನು ಆ್ಯಪ್‌ನ ಪುಟದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ.",
      provider: "ಈ ಅಂಗಡಿಯ WhatsApp ಬೇರೊಂದು ಕಂಪನಿಯ Gupshup ಖಾತೆಯ ಮೂಲಕ ನಡೆಯುತ್ತದೆ; ಪದಗಳನ್ನು ಆ ಕಂಪನಿಯೇ ಸೇರಿಸುತ್ತದೆ. ಸ್ಥಿತಿ ಏನು ಎಂದು ಅವರನ್ನು ಕೇಳಿ.",
      "no-guard": "ಅಂಗಡಿಗಳ ಸಂಪರ್ಕಗಳು ಎಲ್ಲಿವೆ ಎಂದು ಈ ಸರ್ವರ್ ಹೇಳಿಲ್ಲ, ಆದ್ದರಿಂದ ಪ್ಯಾನೆಲ್ ಪದಗಳನ್ನು ಕಳುಹಿಸಲಾಗದು. ಬದಲಿಗೆ ಸರ್ವರ್‌ನಲ್ಲಿ geometer whatsapp-templates ನಡೆಸಿ.",
      conflict: "ಈ ಅಂಗಡಿಯ ಎರಡು ಭಾಗಗಳು ಒಂದೇ ಹೆಸರಿಗೆ ಬೇರೆ ಬೇರೆ ಪದಗಳನ್ನು ಕೊಡುತ್ತವೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. hello@geometer.dev ಗೆ ಬರೆಯಿರಿ.",
    },
    stop: {
      key: (provider) => `${provider} ಅಂಗಡಿಯ key ಅನ್ನು ಒಪ್ಪಲಿಲ್ಲ. ಅಂಗಡಿಯ WhatsApp ಹಂತದಲ್ಲಿ ಅದನ್ನು ಮತ್ತೆ ಕೊಡಿ, ನಂತರ ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ.`,
      rate: "Meta ಒಂದು ಗಂಟೆಗೆ ಹೆಚ್ಚೆಂದರೆ 100 ಹೊಸ ಪದಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳುತ್ತದೆ. ಉಳಿದವಕ್ಕೆ ಒಂದು ಗಂಟೆಯ ನಂತರ ಬಟನ್ ಮತ್ತೆ ಒತ್ತಿ.",
      unreachable: "ಅಂಗಡಿಯ WhatsApp ಸಂಪರ್ಕ ಇನ್ನೂ ನಡೆಯುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ಸರ್ವರ್ ಅಂಗಡಿಯನ್ನು ಅನ್ವಯಿಸಿದ ನಂತರ ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ.",
      guard: "ಅಂಗಡಿಯ ಸಂಪರ್ಕ ಇದನ್ನು ಅನುಮತಿಸಲಿಲ್ಲ. ಸರ್ವರ್ ಈಗಷ್ಟೇ ಅಪ್‌ಡೇಟ್ ಆಗಿದ್ದರೆ, ಅದು ಅಂಗಡಿಯನ್ನು ಅನ್ವಯಿಸುವವರೆಗೆ ಕಾದು, ನಂತರ ಬಟನ್ ಮತ್ತೆ ಒತ್ತಿ.",
      other: "ಕೇಳುವಾಗ ಏನೋ ತಪ್ಪಾಯಿತು. ಬಟನ್ ಮತ್ತೆ ಒತ್ತಿ; ಹಾಗೆಯೇ ಉಳಿದರೆ hello@geometer.dev ಗೆ ಬರೆಯಿರಿ.",
    },
    checks: {
      ok: "WhatsApp ಪದಗಳು: ಎಲ್ಲವನ್ನೂ ಒಪ್ಪಲಾಗಿದೆ.",
      warn: (approved, total) => `WhatsApp ಪದಗಳು: ${total} ರಲ್ಲಿ ${approved} ಒಪ್ಪಲಾಗಿದೆ. ಆದರೂ ನೀವು ಲೈವ್ ಆಗಬಹುದು: ಉಳಿದವು ಒಪ್ಪಿಗೆ ಪಡೆಯುವವರೆಗೆ ಅಂಗಡಿ ಗ್ರಾಹಕರಿಗೆ ಅವರ ಸಂದೇಶದ 24 ಗಂಟೆಗಳೊಳಗೆ ಉತ್ತರಿಸುತ್ತದೆ; ಅದರ ನಂತರದ ಸಂದೇಶ ತನ್ನ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತದೆ.`,
      none: "WhatsApp ಪದಗಳು: ಇನ್ನೂ ಕೇಳಿಲ್ಲ. ಅಂಗಡಿಯ ಸಂಪರ್ಕ ನಡೆಯಲು ಶುರುವಾದ ಕೂಡಲೇ ಪ್ಯಾನೆಲ್ ಅವನ್ನು ಕಳುಹಿಸುತ್ತದೆ.",
    },
    setup: {
      wabaId: "WhatsApp Business Account ID", wabaIdHelp: "ಅಂಕೆಗಳು ಮಾತ್ರ. Meta ಇದನ್ನು API Setup ಪುಟದಲ್ಲಿ, ಫೋನ್ ನಂಬರ್ ID ಪಕ್ಕದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ. ಪ್ಯಾನೆಲ್ ಅಂಗಡಿಯ ಸಂದೇಶ ಪದಗಳನ್ನು ಒಪ್ಪಿಗೆಗಾಗಿ ಈ ಖಾತೆಗೆ ಕಳುಹಿಸುತ್ತದೆ.",
      wabaIdBad: "WhatsApp Business Account ID ಯಲ್ಲಿ ಅಂಕೆಗಳು ಮಾತ್ರ (6 ರಿಂದ 20).",
      appId: "Gupshup app ID", appIdHelp: "Gupshup ನಲ್ಲಿ ಆ್ಯಪ್‌ನ ಪುಟದಲ್ಲಿ. ಪ್ಯಾನೆಲ್ ಅಂಗಡಿಯ ಸಂದೇಶ ಪದಗಳನ್ನು ಒಪ್ಪಿಗೆಗಾಗಿ ಈ ಆ್ಯಪ್‌ಗೆ ಕಳುಹಿಸುತ್ತದೆ.",
      appIdBad: "Gupshup app ID ಯಲ್ಲಿ Gupshup ತೋರಿಸುವಂತೆ ಅಕ್ಷರಗಳು, ಅಂಕೆಗಳು ಮತ್ತು ಹೈಫನ್‌ಗಳು.",
    },
  },
};

/** The sample values the review sheet fills each sentence with (review.ts). */
export const WA_TEMPLATE_SAMPLES: Record<string, unknown[]> = {
  "waTemplates.asOf": ["Meta", "25 Nov 2026, 10:30"], "waTemplates.more": [4], "waTemplates.send": [6], "waTemplates.stop.key": ["Meta"], "waTemplates.checks.warn": [38, 44],
};

export const waWords = (lang: Language): WaWords => WA_TEMPLATE_WORDS[lang] ?? WA_TEMPLATE_WORDS.en;

// ---- the views ----------------------------------------------------------------------------------------------------------------------------------------

const BUCKETS: Bucket[] = ["approved", "pending", "rejected", "stopped", "not-submitted"];

/** The shop page's block: the counts, what they mean, the rejected ones with their reasons, and the one button. Nothing for a shop with no WhatsApp templates. */
export function waTemplatesBlock(c: Ctx, shopId: string, v: WaView, when: (iso: string) => string): Raw | "" {
  const s = v.state;
  if (!s && !v.busy) return "";
  const w = waWords(c.lang);
  const csrf = html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
  const counts = s?.counts;
  const notSent = counts?.["not-submitted"] ?? 0;
  const list = (head: string, items: Raw[], total: number) => items.length === 0 ? "" : html`<p><b>${head}</b></p><ul>${items}${total > items.length ? html`<li>${w.more(total - items.length)}</li>` : ""}</ul>`;
  const stopLine = s?.stop ? (s.stop.kind === "key" ? w.stop.key(s.provider ?? "Meta") : w.stop[s.stop.kind]) : "";
  const button = s && !s.blocked && (notSent > 0 || s.stop) ? html`<form method="post" action="/shops/${shopId}/wa-templates">${csrf}<button class="btn" type="submit">${notSent > 0 ? w.send(notSent) : w.ask}</button></form>` : "";
  return html`<h2>${w.heading}</h2>
<p class="note">${w.intro}</p>
${v.busy ? html`<p>${s?.sent || !counts ? w.busy : w.asking}</p>` : ""}
${counts ? html`<ul class="plain">${BUCKETS.filter((b) => counts[b] > 0 || b === "approved").map((b) => html`<li class="${b === "approved" ? "" : b === "rejected" || b === "stopped" ? "warn" : "info"}"><span class="mark">${counts[b]}</span><span>${w.label[b]}</span></li>`)}</ul>
<p class="note">${s?.provider ? w.asOf(s.provider, when(s.at)) : ""}</p>
<p>${counts.approved === s!.total ? w.allApproved : counts.pending > 0 || notSent > 0 ? w.pendingHelp : ""}</p>` : !v.busy && !s?.blocked && !s?.stop ? html`<p>${w.never}</p>` : ""}
${s?.blocked ? html`<p class="warn">${w.blocked[s.blocked]}</p>` : ""}
${stopLine ? html`<p class="warn">${stopLine}</p>` : ""}
${list(w.rejectedHead, (s?.rejected ?? []).map((r) => html`<li><code>${r.name}</code> (${r.language}): ${r.reason ?? w.noReason}</li>`), counts?.rejected ?? 0)}
${(s?.rejected ?? []).length > 0 ? html`<p class="note">${w.rejectedHelp}</p>` : ""}
${list(w.stoppedHead, (s?.stopped ?? []).map((r) => html`<li><code>${r.name}</code> (${r.language}): ${r.state.toLowerCase()}</li>`), counts?.stopped ?? 0)}
${(s?.stopped ?? []).length > 0 ? html`<p class="note">${w.stoppedHelp}</p>` : ""}
${list(w.refusedHead, (s?.sent?.refused ?? []).map((r) => html`<li><code>${r.name}</code> (${r.language}): ${r.reason}</li>`), s?.sent?.refused.length ?? 0)}
${list(w.cannotHead, (s?.sent?.unsendable ?? []).map((r) => html`<li><code>${r.name}</code> (${r.language}): ${r.reason}</li>`), s?.sent?.unsendable.length ?? 0)}
${button}`;
}

/** The checks page's line: it warns, it does not block (the top of this file says why). `undefined`: the shop has no WhatsApp templates. */
export function waChecksLine(lang: Language, v: WaView): { state: "ok" | "wait"; text: string } | undefined {
  const s = v.state;
  if (!s && !v.busy) return undefined;
  const w = waWords(lang);
  if (!s?.counts) return { state: "wait", text: s?.blocked ? w.blocked[s.blocked] : w.checks.none };
  return s.counts.approved === s.total ? { state: "ok", text: w.checks.ok } : { state: "wait", text: w.checks.warn(s.counts.approved, s.total) };
}

/** The go-live confirmation (English only, like the rest of that page): what the provider said, in a line, and the ones not approved. */
export function waConfirmLines(v: WaView): { said: string; notApproved: string[] } {
  const s = v.state;
  if (!s?.counts) return { said: s?.blocked ? WA_TEMPLATE_WORDS.en.blocked[s.blocked] : "The panel has not asked yet whether the shop's WhatsApp templates are approved. Open the shop's page to ask.", notApproved: [] };
  const c = s.counts;
  return {
    said: `${s.provider ?? "The provider"} says, as of ${s.at}: ${c.approved} of ${s.total} approved, ${c.pending} waiting, ${c.rejected} rejected, ${c.stopped} paused or turned off, ${c["not-submitted"]} not sent yet. Go-live does not wait for them: until they are approved the shop answers customers within 24 hours of their message.`,
    notApproved: [...(s.rejected ?? []).map((r) => `${r.name} (${r.language}): rejected${r.reason ? `, ${r.reason}` : ""}`), ...(s.stopped ?? []).map((r) => `${r.name} (${r.language}): ${r.state.toLowerCase()}`)],
  };
}
