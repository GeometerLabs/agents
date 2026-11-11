// What the approvals relay says to the owner about a call held on an agent's OWN API (B71 part 2; the call is read by approvals/held-call.ts). A template's
// voice talks about a refund for a booking or a fee; this one cannot, because the API is the builder's and the call may be anything their reviewed spec holds
// (a refund, a payout, a transfer). So it says only what Guard holds: the operation by its name in the spec, the amount in the API's own unit, and a few of the
// call's other plain fields. Nothing in these messages comes from the agent's say-so (B74: what the owner reads is the held call, field for field).
//
// After the owner's yes nothing is sent by the relay or by Geometer: the relay gives Guard the owner's signed answer, and Guard lets the call through when the
// agent sends the identical call again (the same as a template's held refund). The words say so.
//
// One wording per message, written once as a body with {slots}: the free text is the body filled from the facts, and the out-of-window template (the ask; the
// other messages answer the owner's own reply, inside the window) is the same body turned into Meta's numbered form, so what goes out is always what the check read.
// Hindi, Malayalam and Kannada are machine-written: a native speaker must read them before a real owner sees them (Deferred.md, B71 part 2). The ask's template
// is not yet in any submission file (whatsapp-templates.json): until it is approved on the shop's number, an ask outside the owner's window is refused by the
// provider, the relay tries again and then tells the builder (it never asks some other way).
import type { RelayVoice } from "./relay.ts";
import type { Ask } from "./store.ts";
import type { RefundContext } from "./clients.ts";
import { createMetaCatalogue } from "../language/meta-templates.ts";
import type { MetaTemplate } from "../language/meta-templates.ts";
import { formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { CheckResult } from "../language/check.ts";

export type OwnApiMessage = "owner_call_needs_approval" | "owner_call_approval_done" | "owner_call_approval_denied" | "owner_call_approval_expired" | "owner_call_approval_failed";

/** What these messages are written from: Guard's held call, and the ask's code and hours. */
export interface OwnApiFacts { language: Language; operation: string; /** The amount with its unit, formatted once (₹ only when the unit is paise). */ amount: string; details: string; approvalCode?: string; approvalHours?: number }

type Slot = "operation" | "amount" | "details" | "code" | "hours";

/** "approve CODE" stays English in every language: the relay reads those words, and the message tells the owner exactly what to type. */
const BODIES: Record<OwnApiMessage, Record<Language, string>> = {
  owner_call_needs_approval: {
    en: `Approval needed: your agent wants to make a {operation} call for {amount} ({details}). Reply "approve {code}" or "deny {code}" within {hours} hours.`,
    hi: `मंज़ूरी चाहिए: आपका एजेंट {amount} के लिए {operation} कॉल करना चाहता है ({details})। {hours} घंटे के अंदर "approve {code}" या "deny {code}" लिखकर जवाब दें।`,
    ml: `അംഗീകാരം വേണം: നിങ്ങളുടെ ഏജന്റ് {amount}-ന് ഒരു {operation} കോൾ ചെയ്യാൻ ആഗ്രഹിക്കുന്നു ({details}). {hours} മണിക്കൂറിനുള്ളിൽ "approve {code}" അല്ലെങ്കിൽ "deny {code}" എന്ന് മറുപടി നൽകുക.`,
    kn: `ಅನುಮೋದನೆ ಬೇಕು: ನಿಮ್ಮ ಏಜೆಂಟ್ {amount} ಗೆ {operation} ಕರೆ ಮಾಡಲು ಬಯಸುತ್ತದೆ ({details}). {hours} ಗಂಟೆಗಳ ಒಳಗೆ "approve {code}" ಅಥವಾ "deny {code}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  },
  owner_call_approval_done: {
    en: `Thank you. The {operation} call for {amount} is approved. It goes through when your agent sends it again, exactly as it was.`,
    hi: `धन्यवाद। {amount} वाली {operation} कॉल को मंज़ूरी मिल गई है। जब आपका एजेंट इसे बिल्कुल वैसे ही दोबारा भेजेगा, तब यह पूरी होगी।`,
    ml: `നന്ദി. {amount}-ന്റെ {operation} കോൾ അംഗീകരിച്ചു. നിങ്ങളുടെ ഏജന്റ് അത് അതേപടി വീണ്ടും അയയ്ക്കുമ്പോൾ അത് നടക്കും.`,
    kn: `ಧನ್ಯವಾದ. {amount} ನ {operation} ಕರೆಗೆ ಅನುಮೋದನೆ ಸಿಕ್ಕಿದೆ. ನಿಮ್ಮ ಏಜೆಂಟ್ ಅದನ್ನು ಅದೇ ರೀತಿ ಮತ್ತೆ ಕಳುಹಿಸಿದಾಗ ಅದು ನಡೆಯುತ್ತದೆ.`,
  },
  owner_call_approval_denied: {
    en: `Understood. The {operation} call for {amount} will not go through.`,
    hi: `समझ गए। {amount} वाली {operation} कॉल नहीं होगी।`,
    ml: `മനസ്സിലായി. {amount}-ന്റെ {operation} കോൾ നടക്കില്ല.`,
    kn: `ಅರ್ಥವಾಯಿತು. {amount} ನ {operation} ಕರೆ ನಡೆಯುವುದಿಲ್ಲ.`,
  },
  owner_call_approval_expired: {
    en: `That request ran out before you answered, so the {operation} call for {amount} did not go through.`,
    hi: `आपके जवाब से पहले यह अनुरोध समाप्त हो गया, इसलिए {amount} वाली {operation} कॉल नहीं हुई।`,
    ml: `നിങ്ങൾ മറുപടി നൽകുന്നതിന് മുമ്പ് ഈ അഭ്യർത്ഥനയുടെ സമയം കഴിഞ്ഞു, അതിനാൽ {amount}-ന്റെ {operation} കോൾ നടന്നില്ല.`,
    kn: `ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಈ ವಿನಂತಿಯ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ {amount} ನ {operation} ಕರೆ ನಡೆಯಲಿಲ್ಲ.`,
  },
  owner_call_approval_failed: {
    en: `I could not record your answer just now. Please send it again in a few minutes.`,
    hi: `मैं अभी आपका जवाब दर्ज नहीं कर पाया। कृपया कुछ मिनट बाद फिर भेजें।`,
    ml: `നിങ്ങളുടെ മറുപടി ഇപ്പോൾ രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും അയയ്ക്കൂ.`,
    kn: `ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಈಗ ದಾಖಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕಳುಹಿಸಿ.`,
  },
};

/** When the held call has no other plain field to show, the ask says so rather than leaving its brackets empty (a template parameter is never empty). */
const NO_DETAILS: Record<Language, string> = { en: "no other fields", hi: "कोई और जानकारी नहीं", ml: "മറ്റ് വിവരങ്ങളില്ല", kn: "ಬೇರೆ ವಿವರಗಳಿಲ್ಲ" };

const VALUES: Record<Slot, (f: OwnApiFacts) => string> = {
  operation: (f) => f.operation,
  amount: (f) => f.amount,
  details: (f) => f.details,
  code: (f) => { if (!f.approvalCode) throw new Error("the ask has no code"); return f.approvalCode; },
  hours: (f) => { if (f.approvalHours === undefined) throw new Error("the ask has no hours"); return String(f.approvalHours); },
};

/** The one template the ask needs (the other messages answer the owner's own reply, inside the window). */
export const OWN_API_META_TEMPLATES: readonly MetaTemplate<OwnApiMessage>[] = [
  { name: "owner_agent_call_approval_request", usedFor: "owner_call_needs_approval", audience: "owner", bodies: BODIES.owner_call_needs_approval },
];
const catalogue = createMetaCatalogue<OwnApiFacts, OwnApiMessage, Slot>({ templates: OWN_API_META_TEMPLATES, values: VALUES });

/** A message's text: its body with the facts in its slots. */
export function renderOwnApi(id: OwnApiMessage, f: OwnApiFacts): string {
  return BODIES[id][f.language].replace(/\{([A-Za-z]+)\}/gu, (_m, slot: string) => VALUES[slot as Slot](f));
}

/** The amount as the owner reads it: rupees when the API counts in paise; otherwise the number Guard holds and the unit the builder named, never converted. */
export function formatCallAmount(amount: number, unit: string | undefined): string {
  if (unit !== undefined && /^paise$/iu.test(unit)) return formatInr(amount / 100);
  return unit ? `${amount} ${unit}` : String(amount);
}

/**
 * The outgoing check: no number is in the text that the facts do not hold (the amount, the code, the hours, the operation's name and the fields shown), and an ask
 * (the message with "approve <code>" in it) states the held amount and its own code. A message that fails is not sent; the relay tells the builder instead.
 */
export function checkOwnApi(text: string, f: OwnApiFacts): CheckResult {
  const problems: string[] = [];
  if (text.includes('"approve ')) {
    if (!text.includes(f.amount)) problems.push(`it does not state the held amount (${f.amount}).`);
    if (!f.approvalCode || !text.includes(`"approve ${f.approvalCode}"`)) problems.push("it does not carry its own code.");
  }
  let rest = text;
  for (const known of [f.amount, f.details, f.operation, f.approvalCode, f.approvalHours === undefined ? undefined : String(f.approvalHours)]) if (known) rest = rest.split(known).join(" ");
  if (/\d/u.test(rest)) problems.push("it has a number the held call does not have.");
  return { ok: problems.length === 0, problems };
}

/** The voice the relay of an agent's own API speaks in. B37's group messages never apply: readHeldCall leaves a request that names several approvers to the builder. */
export const ownApiVoice: RelayVoice<OwnApiFacts> = {
  render: (ids, facts) => ids.map((id) => renderOwnApi(id as OwnApiMessage, facts)).join(" "),
  check: checkOwnApi,
  templateMessage: (a) => catalogue.templateMessage({ ...a, ids: a.ids as OwnApiMessage[] }),
  ownerTemplate: "owner_notice",
  factsFor(ask: Ask, c: RefundContext): OwnApiFacts {
    if (!c.call) throw new Error("the held call's operation is not known, so the request cannot be worded");
    const language = c.ownerLanguage;
    return {
      language, operation: c.call.operation, amount: formatCallAmount(ask.amountPaise, c.call.unit), details: c.call.details.length > 0 ? c.call.details.join(", ") : NO_DETAILS[language],
      approvalHours: ask.approvalHours, ...(ask.code ? { approvalCode: ask.code } : {}),
    };
  },
  // waiting, closed and refused are B37's: never sent for an own API (see above), so they fall back to the one message that is true whenever it is read
  ids: { ask: "owner_call_needs_approval", expired: "owner_call_approval_expired", failed: "owner_call_approval_failed", done: "owner_call_approval_done", denied: "owner_call_approval_denied", waiting: "owner_call_approval_failed", closed: "owner_call_approval_failed", refused: "owner_call_approval_failed" },
};

/** The ask's template in Meta's submission form, with an example (for whoever submits the shop's templates: item 12 of the plan). */
export const ownApiSubmissions = () => catalogue.submissions((language) => ({ language, operation: "create_refund", amount: "15000 cents", details: "charge_id ch_1", approvalCode: "K7M2QX", approvalHours: 24 }));
