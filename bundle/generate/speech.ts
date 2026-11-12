// The Guards and the gate for a shop's voice notes (plan B29, decision 42), defined once like every Guard in guards.ts. Two Guards, both reached only by the shop's
// runtime and never carrying a key outside Guard:
//  - the SPEECH Guard (one per server, like the model Guard): in front of api.sarvam.ai, adds Sarvam's `api-subscription-key` from its own file, lists exactly the two
//    routes the voice adapter calls (modules/voice/sarvam.ts SARVAM_ROUTES), pins the text-to-speech model and caps calls a day for the whole server;
//  - the MEDIA Guard (one per shop, since a shop's WhatsApp token is its own): lists ONE route, GET /{version}/{media_id}, with the shop's own WhatsApp token. A Guard rule
//    can only allow exact values, and a media id is not known ahead, so this Guard CANNOT tell a media id from any other id in that position: the same route also reads the
//    shop's own phone number record, for example. It cannot send, upload or delete (no other route is listed), and a daily count bounds it. That is a looser fence than
//    the WhatsApp Guard's, and a decision for the owner (Deferred.md), not a thing to be called tight. The download of the audio itself is a second host (Meta's page does not name it) and its route shape is not yet known, so its Guard spec waits for the
//    first sandbox call (Deferred.md); until then nothing here can fetch audio.
// WHAT A GUARD CANNOT BIND, said plainly: the speech-to-text model is a field of a multipart body, and an `argument_allowlist` reads a JSON field, so the Guard cannot pin it.
// The adapter names the model it asks for and the record writes it down; the daily call cap and the route list are what the Guard enforces for listening. The text-to-speech
// body is JSON, so its model IS pinned.
//
// NOT PLACED YET: neither Guard is in compose.ts (the per-shop address slots are full, bundle/generate/compose.ts slotOf), so no server runs these. `speechProblem` below is
// what refuses a shop's `speech` block until that is done.
import { SARVAM_ROUTES, SARVAM_UPSTREAM } from "../../modules/voice/sarvam.ts";
import type { LimitsSpec } from "../../modules/payments/guard-limits.ts";
import { SPEECH_SECRET } from "../lib/secrets.ts";
import { base, count } from "./guards.ts";
import type { GuardDef, SpecIdentity } from "./guards.ts";

export const SPEECH_TOOL = "speech";
export const MEDIA_TOOL = "whatsapp-media";

/** The speech Guard's definition: Sarvam's upstream and the one header it adds, from a file only this Guard reads. */
export function speechGuardDef(): GuardDef {
  return { kind: "speech", tool: SPEECH_TOOL, upstream: SARVAM_UPSTREAM, secretFile: SPEECH_SECRET, headers: { "api-subscription-key": `\${file:/run/secrets/${SPEECH_SECRET}}` } };
}

export interface SpeechLimits { ttsModel: string; listensPerDay: number; speaksPerDay: number }

/** The speech Guard's spec: two routes, the text-to-speech model pinned, a daily count for each. */
export function speechSpec(id: SpecIdentity, o: SpeechLimits): LimitsSpec {
  return {
    ...base(speechGuardDef(), id),
    routes: [{ method: "POST", path: SARVAM_ROUTES.listen, operation: "transcribe" }, { method: "POST", path: SARVAM_ROUTES.speak, operation: "synthesize" }],
    rules: [{ id: "speak-model-pin", kind: "argument_allowlist", operation: "synthesize", field: "model", match: "exact", allowed_values: [o.ttsModel] }],
    limits: [count("listens-per-day", "transcribe", o.listensPerDay, 86_400), count("speaks-per-day", "synthesize", o.speaksPerDay, 86_400)],
    intents: [], fail_policy: [],
  };
}

/** The media Guard's definition: Meta's Graph API with the shop's own WhatsApp token (the same file the WhatsApp Guard reads, mounted read-only). */
export function mediaGuardDef(): GuardDef {
  return { kind: "media", tool: MEDIA_TOOL, upstream: "graph.facebook.com:443", secretFile: "whatsapp_authorization", headers: { Authorization: "${file:/run/secrets/whatsapp_authorization}" } };
}

/** The media Guard's spec: one GET route and a count a day. No send, no upload, no other route. It cannot tell a media id from another id in that place (see the head of this file). */
export function mediaSpec(id: SpecIdentity, o: { readsPerDay: number }): LimitsSpec {
  return {
    ...base(mediaGuardDef(), id),
    routes: [{ method: "GET", path: "/{version}/{media_id}", operation: "read_media" }],
    rules: [], limits: [count("media-reads-per-day", "read_media", o.readsPerDay, 86_400)], intents: [], fail_policy: [],
  };
}

/**
 * Why a shop's `speech` block cannot be turned on yet, in plain words, or null. Voice is OFF unless the block is there, and the block is refused unless:
 *  - the speech provider's key has been handed in on this server through the write-only intake (`geometer speech-key`);
 *  - the Guards that carry it are placed on this server: today they are not (see the head of this file), so a block is always refused with that reason.
 * `placed` is a parameter so the day compose places the Guards the one line that says so changes, and a test shows the key check works on its own.
 */
export function speechProblem(o: { keyHandedIn: boolean; placed: boolean }): string | null {
  if (!o.keyHandedIn) return "voice notes need the speech provider's key on this server first: hand it in with `geometer speech-key <file>` (it goes to the speech Guard only and is never shown again).";
  if (!o.placed) return "voice notes cannot run on this server yet: the speech and media Guards are defined (bundle/generate/speech.ts) but this release does not place them in the server's Compose file. Leave \"speech\" out of runtime.json until it does.";
  return null;
}

/** True while the bundle places the speech and media Guards. Flipped, with its tests, in the change that adds them to compose.ts. */
export const SPEECH_GUARDS_PLACED = false;
