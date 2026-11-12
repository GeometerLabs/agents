// The per-shop switch for voice notes (plan B29): what the panel keeps in a shop's runtime.json `speech` block, and nothing else. OFF by default: a shop with no block listens
// to nothing. The block holds who things are (the provider, the builder's own price per minute listened, the host the audio is downloaded from); where the Guards are
// (their addresses and tokens) is the deployer's, as for every other service. The deployer refuses the block unless the server holds the speech key and the Guards are placed
// (generate/speech.ts speechProblem), so turning the switch on here can never start a call by itself.
// Used by server.ts's /shops/<shop>/voice routes and views-voice.ts.

export interface VoiceForm { on: boolean; provider: "geometer" | "sarvam"; sttInrPerMinute: string; downloadHost: string }

export interface VoiceState { on: boolean; provider: "geometer" | "sarvam"; sttInrPerMinute?: number; downloadHost?: string }

/** What the shop's runtime.json says about voice. No block: off. */
export function voiceOf(runtime: Record<string, any> | undefined): VoiceState {
  const s = runtime?.speech;
  if (!s || typeof s !== "object") return { on: false, provider: "geometer" };
  return {
    on: true, provider: s.provider === "sarvam" ? "sarvam" : "geometer",
    ...(typeof s.rate?.sttInrPerMinute === "number" ? { sttInrPerMinute: s.rate.sttInrPerMinute } : {}),
    ...(Array.isArray(s.media?.downloadHosts) && typeof s.media.downloadHosts[0] === "string" ? { downloadHost: s.media.downloadHosts[0] } : {}),
  };
}

const price = (v: string): number | undefined => (/^\d{1,4}(\.\d{1,4})?$/u.test(v.trim()) ? Number(v.trim()) : undefined);
const HOST = /^[a-z0-9]([a-z0-9.-]{0,120}[a-z0-9])?$/iu;

/** The form from a posted body. A checkbox is on when present. */
export function voiceFormOf(body: Record<string, string>): VoiceForm {
  return { on: body.on === "1", provider: body.provider === "sarvam" ? "sarvam" : "geometer", sttInrPerMinute: body.stt ?? "", downloadHost: (body.host ?? "").trim().toLowerCase() };
}

/**
 * The runtime.json with the switch applied. Off removes the block. On needs, for a paid provider, the builder's two prices (voice does not run on a call whose cost nobody can see); Geometer's own service needs none and the host the audio
 * is downloaded from (Meta's pages do not name it; the first sandbox voice note shows it). Every other key of runtime.json is kept as it was.
 */
export function applyVoice(runtime: Record<string, unknown>, form: VoiceForm): { ok: true; runtime: Record<string, unknown> } | { ok: false; fields: ("stt" | "host")[] } {
  if (!form.on) { const { speech: _off, ...rest } = runtime; return { ok: true, runtime: rest }; }
  // Geometer's own service charges the shop nothing, so its prices are optional (blank means zero); a paid provider's prices are needed, so its cost can always be counted
  const paid = form.provider === "sarvam";
  const stt = form.sttInrPerMinute.trim() === "" && !paid ? 0 : price(form.sttInrPerMinute);
  const fields: ("stt" | "host")[] = [];
  if (stt === undefined) fields.push("stt");
  if (!HOST.test(form.downloadHost)) fields.push("host");
  if (fields.length > 0) return { ok: false, fields };
  const before = (runtime.speech ?? {}) as Record<string, unknown>; // keep what the builder added by hand (an Opus encoder, limits)
  return { ok: true, runtime: { ...runtime, speech: { ...before, provider: form.provider, rate: { sttInrPerMinute: stt }, media: { ...((before.media ?? {}) as object), downloadHosts: [form.downloadHost] } } } };
}

/** A runtime.json the panel writes again (an edit of the shop's setup) keeps the voice block the builder or partner turned on. */
export function keepSpeech(runtime: Record<string, unknown>, before: unknown): Record<string, unknown> {
  const s = (before as { speech?: unknown } | undefined)?.speech;
  return s === undefined ? runtime : { ...runtime, speech: s };
}
