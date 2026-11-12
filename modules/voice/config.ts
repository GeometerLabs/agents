// The `speech` block of runtime.json (plan B29): voice notes for one shop, OFF unless the block is there. This file reads and checks it in plain words, and `buildVoice`
// turns it into the service the agent is handed (voice.ts). The bundle refuses to write the block unless the server has the speech provider's key handed in through the
// write-only intake (bundle/generate/guards.ts speechProblem); this file is the runtime's half: no key goes in the block (the Guards hold them), the builder's price is
// required (so every call has a known cost), and the spoken replies need the folder the report pages are served from.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Clock } from "../core/clock.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { GRAPH_VERSION } from "../messaging/whatsapp.ts";
import { createSarvam } from "./sarvam.ts";
import { createWire } from "./wire.ts";
import type { Wire } from "./wire.ts";
import { folderAudioHost } from "./links.ts";
import { createVoice } from "./voice.ts";
import type { VoiceService } from "./voice.ts";
import type { SpeechRate } from "./speech.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export const SPEECH_PROVIDERS = ["sarvam"] as const;

export interface SpeechConfig {
  provider: (typeof SPEECH_PROVIDERS)[number];
  /** A Guard in front of the speech provider (never a key). */
  baseUrl: string;
  agentTokenFile?: string;
  /** Where a voice note's audio is read from. `lookupBaseUrl` (Meta: a media id is looked up first) may be left out for a provider whose callback carries the address (Gupshup). */
  media: { lookupBaseUrl?: string; downloadBaseUrl: string; downloadHosts: string[]; agentTokenFile?: string; downloadTokenFile?: string };
  sttModel?: string;
  ttsModel?: string;
  speaker?: string;
  /** The builder's price from their provider invoice or price page, in rupees. Required: voice does not run on a call whose cost nobody can see. */
  rate: SpeechRate;
  /** Spoken replies. Default true; false keeps listening and answers in text only. */
  replies?: boolean;
  maxSeconds?: number;
  notesPerDay?: number;
  replyCharacters?: number;
  timeoutMs?: number;
}

const KEYS = ["provider", "baseUrl", "agentTokenFile", "media", "sttModel", "ttsModel", "speaker", "rate", "replies", "maxSeconds", "notesPerDay", "replyCharacters", "timeoutMs"];
const NO_KEY = "No key goes in runtime.json: the base URL is a Guard in front of the provider, and the Guard holds the key.";

function httpUrl(v: unknown, what: string, errors: string[]): boolean {
  let u: URL | undefined;
  try { u = isText(v) ? new URL(v) : undefined; } catch { u = undefined; }
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) { errors.push(`${what} must be the address of a Guard, starting with http:// or https://.`); return false; }
  if (u.username || u.password || u.search || u.hash) { errors.push(`${what} must not hold a user name, a password, a query or a #fragment. ${NO_KEY}`); return false; }
  return true;
}

/** `speech` as runtime.json gives it, checked. Every refusal is in plain words and none repeats what was written, in case it was a key. */
export function readSpeech(raw: unknown, folder: string, errors: string[]): SpeechConfig | undefined {
  if (!isObj(raw)) { errors.push('"speech" must be an object like {"provider": "sarvam", "baseUrl": "http://g-speech:8080", "media": {...}, "rate": {...}}. Leave it out and voice is off for this shop.'); return undefined; }
  const before = errors.length;
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) errors.push(`I don't know what "${k}" means in speech. Allowed: ${KEYS.join(", ")}.${/key|secret|token(?!file)/iu.test(k) ? ` ${NO_KEY}` : ""}`);
  if (!(SPEECH_PROVIDERS as readonly unknown[]).includes(raw.provider)) errors.push(`speech.provider must be one of ${SPEECH_PROVIDERS.map((p) => `"${p}"`).join(", ")}.`);
  httpUrl(raw.baseUrl, "speech.baseUrl", errors);
  for (const k of ["agentTokenFile"]) if (raw[k] !== undefined && !isText(raw[k])) errors.push(`speech.${k} must be the path of a file that holds this agent's credential for that Guard.`);
  const m = raw.media;
  if (!isObj(m)) errors.push('speech.media must be an object like {"downloadBaseUrl": "http://g-media:8080", "downloadHosts": ["<the host the audio is on>"]}.');
  else {
    for (const k of Object.keys(m)) if (!["lookupBaseUrl", "downloadBaseUrl", "downloadHosts", "agentTokenFile", "downloadTokenFile"].includes(k)) errors.push(`I don't know what "${k}" means in speech.media.`);
    if (m.lookupBaseUrl !== undefined) httpUrl(m.lookupBaseUrl, "speech.media.lookupBaseUrl", errors);
    httpUrl(m.downloadBaseUrl, "speech.media.downloadBaseUrl", errors);
    if (!Array.isArray(m.downloadHosts) || m.downloadHosts.length === 0 || !m.downloadHosts.every((h) => isText(h) && /^[a-z0-9.-]+$/iu.test(h))) errors.push("speech.media.downloadHosts must list the host names the audio may be downloaded from (names only, no address). Meta's page does not name the host, so it is a setting.");
    for (const k of ["agentTokenFile", "downloadTokenFile"]) if (m[k] !== undefined && !isText(m[k])) errors.push(`speech.media.${k} must be the path of a file that holds this agent's credential for that Guard.`);
  }
  const r = raw.rate;
  const price = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isObj(r) || Object.keys(r).some((k) => k !== "sttInrPerMinute" && k !== "ttsInrPer1000Characters") || !price(r.sttInrPerMinute) || !price(r.ttsInrPer1000Characters)) {
    errors.push('speech.rate is needed: {"sttInrPerMinute": <rupees>, "ttsInrPer1000Characters": <rupees>}, the provider\'s price as the builder reads it on their invoice or the provider\'s price page. Voice does not run without a price, because then its cost could not be counted.');
  }
  if (raw.replies !== undefined && typeof raw.replies !== "boolean") errors.push("speech.replies must be true or false (default true).");
  for (const [k, max] of [["maxSeconds", 120], ["notesPerDay", 100_000], ["replyCharacters", 2500], ["timeoutMs", 60_000]] as const) {
    if (raw[k] !== undefined && (!Number.isInteger(raw[k]) || (raw[k] as number) < 1 || (raw[k] as number) > max)) errors.push(`speech.${k} must be a whole number from 1 to ${max}.`);
  }
  for (const k of ["sttModel", "ttsModel", "speaker"]) if (raw[k] !== undefined && !(isText(raw[k]) && /^[a-z0-9:._-]{1,60}$/iu.test(raw[k] as string))) errors.push(`speech.${k} must be a short name as the provider writes it.`);
  if (errors.length > before) return undefined;
  const at = (p: string) => (isAbsolute(p) ? p : resolve(folder, p));
  const mm = m as Obj;
  const rr = r as SpeechRate;
  return {
    provider: raw.provider as SpeechConfig["provider"], baseUrl: raw.baseUrl as string, ...(raw.agentTokenFile !== undefined ? { agentTokenFile: at(raw.agentTokenFile as string) } : {}),
    media: {
      ...(mm.lookupBaseUrl !== undefined ? { lookupBaseUrl: mm.lookupBaseUrl as string } : {}), downloadBaseUrl: mm.downloadBaseUrl as string, downloadHosts: mm.downloadHosts as string[],
      ...(mm.agentTokenFile !== undefined ? { agentTokenFile: at(mm.agentTokenFile as string) } : {}), ...(mm.downloadTokenFile !== undefined ? { downloadTokenFile: at(mm.downloadTokenFile as string) } : {}),
    },
    ...(raw.sttModel !== undefined ? { sttModel: raw.sttModel as string } : {}), ...(raw.ttsModel !== undefined ? { ttsModel: raw.ttsModel as string } : {}), ...(raw.speaker !== undefined ? { speaker: raw.speaker as string } : {}),
    rate: { sttInrPerMinute: rr.sttInrPerMinute, ttsInrPer1000Characters: rr.ttsInrPer1000Characters },
    ...(raw.replies !== undefined ? { replies: raw.replies as boolean } : {}),
    ...(raw.maxSeconds !== undefined ? { maxSeconds: raw.maxSeconds as number } : {}), ...(raw.notesPerDay !== undefined ? { notesPerDay: raw.notesPerDay as number } : {}),
    ...(raw.replyCharacters !== undefined ? { replyCharacters: raw.replyCharacters as number } : {}), ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number } : {}),
  };
}

/** The wire for lookups when a provider's callback carries the address itself: asking it is a mistake, said plainly. */
const NO_LOOKUP: Wire = { async request() { throw new Error("This shop's voice settings have no media lookup address, and the voice note carried only an id."); } };

const tokenOf = (file: string | undefined): string | undefined => (file ? readFileSync(file, "utf8").trim() : undefined);

/** The voice service for a shop whose runtime.json has a `speech` block. `languages` are the shop's; `report` is where the spoken replies are served from. */
export function buildVoice(c: SpeechConfig, deps: { clock: Clock; languages: readonly Language[]; report: { dir: string; baseUrl: string }; log: (line: string) => void }): VoiceService {
  const timeout = c.timeoutMs ?? 8_000;
  const provider = createSarvam({ baseUrl: c.baseUrl, agentToken: tokenOf(c.agentTokenFile), sttModel: c.sttModel, ttsModel: c.ttsModel, speaker: c.speaker, timeoutMs: timeout });
  return createVoice({
    provider, rate: c.rate, languages: deps.languages.filter((l) => LANGUAGES.includes(l)), clock: deps.clock, repliesOn: c.replies !== false,
    host: folderAudioHost({ dir: deps.report.dir, baseUrl: deps.report.baseUrl, log: deps.log }),
    media: {
      lookup: c.media.lookupBaseUrl ? createWire(c.media.lookupBaseUrl, "WhatsApp", timeout, tokenOf(c.media.agentTokenFile)) : NO_LOOKUP,
      download: createWire(c.media.downloadBaseUrl, "WhatsApp media", timeout, tokenOf(c.media.downloadTokenFile)),
      version: GRAPH_VERSION, downloadHosts: c.media.downloadHosts,
    },
    ...(c.maxSeconds !== undefined ? { maxSeconds: c.maxSeconds } : {}), ...(c.notesPerDay !== undefined ? { notesPerDay: c.notesPerDay } : {}), ...(c.replyCharacters !== undefined ? { replyCharacters: c.replyCharacters } : {}),
    log: deps.log,
  });
}
