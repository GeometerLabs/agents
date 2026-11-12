// The Guards and the gate for a shop's voice notes (plan B29, decision 42), defined once like every Guard in guards.ts. Two Guards, both reached only by the shop's
// runtime and never carrying a key outside Guard:
//  - the SPEECH Guard (one per server, like the model Guard): by default in front of the speech service Geometer runs on the server's private network (no key; a shared token
//    only if it is elsewhere), or, as an optional paid adapter, in front of api.sarvam.ai with its key from a file. It lists exactly the one route the adapter calls
//    (modules/voice/geometer.ts `POST /stt`, or sarvam.ts), and caps calls a day for the whole server. Listening only: there is no route for speaking (owner, 12 Nov 2026);
//  - the MEDIA Guard (one per shop, since a shop's WhatsApp token is its own): lists ONE route, GET /{version}/{media_id}, with the shop's own WhatsApp token. A Guard rule
//    can only allow exact values, and a media id is not known ahead, so this Guard CANNOT tell a media id from any other id in that position: the same route also reads the
//    shop's own phone number record, for example. It cannot send, upload or delete (no other route is listed), and a daily count bounds it. That is a looser fence than
//    the WhatsApp Guard's, and a decision for the owner (Deferred.md), not a thing to be called tight. The download of the audio itself is a second host (Meta's page does not name it) and its route shape is not yet known, so its Guard spec waits for the
//    first sandbox call (Deferred.md); until then nothing here can fetch audio.
// WHAT A GUARD CANNOT BIND, said plainly: the speech-to-text model is a field of a multipart body, and an `argument_allowlist` reads a JSON field, so the Guard cannot pin it.
// The adapter names the model it asks for and the record writes it down; the daily call cap and the route list are what the Guard enforces for listening.
//
// NOT PLACED YET: neither Guard is in compose.ts (the per-shop address slots are full, bundle/generate/compose.ts slotOf), so no server runs these. `speechProblem` below is
// what refuses a shop's `speech` block until that is done.
import { SARVAM_ROUTES, SARVAM_UPSTREAM } from "../../modules/voice/sarvam.ts";
import type { LimitsSpec } from "../../modules/payments/guard-limits.ts";
import { GEOMETER_SPEECH_ROUTES, GEOMETER_SPEECH_UPSTREAM } from "../../modules/voice/geometer.ts";
import { SPEECH_SECRET } from "../lib/secrets.ts";
import { base, count } from "./guards.ts";
import type { GuardDef, SpecIdentity } from "./guards.ts";

export const SPEECH_TOOL = "speech";
export const MEDIA_TOOL = "whatsapp-media";
/** The file a shared token for Geometer's speech service would be in (only when the service is not on the same private network). */
export const SPEECH_TOKEN_SECRET = "speech_token";

export type SpeechProviderKind = "geometer" | "sarvam";

/**
 * The speech Guard's definition (one per server, like the model Guard).
 *  - "geometer" (the default, owner's direction 12 Nov): in front of the speech service Geometer runs in a container on the server's own private network. No provider key; when the
 *    service wants a shared token (it is not on the same private network) Guard adds it from a file (`withToken`). Plain HTTP on the private network (`plain`), as the desk's Guard.
 *  - "sarvam" (optional, paid): in front of api.sarvam.ai, adds Sarvam's `api-subscription-key` from a file only this Guard reads.
 */
export function speechGuardDef(provider: SpeechProviderKind = "geometer", o: { upstream?: string; withToken?: boolean } = {}): GuardDef {
  if (provider === "sarvam") return { kind: "speech", tool: SPEECH_TOOL, upstream: SARVAM_UPSTREAM, secretFile: SPEECH_SECRET, headers: { "api-subscription-key": `\${file:/run/secrets/${SPEECH_SECRET}}` } };
  return {
    kind: "speech", tool: SPEECH_TOOL, upstream: o.upstream ?? GEOMETER_SPEECH_UPSTREAM, plain: true,
    ...(o.withToken ? { secretFile: SPEECH_TOKEN_SECRET, headers: { Authorization: `\${file:/run/secrets/${SPEECH_TOKEN_SECRET}}` } } : { headers: {} }),
  };
}

export interface SpeechLimits { provider?: SpeechProviderKind; listensPerDay: number }

/**
 * The speech Guard's spec: the provider's one listening route and a daily count. Neither provider's request has a JSON model field Guard could pin (Sarvam's is multipart,
 * Geometer's service chooses its own), so the route and the count are what Guard holds.
 */
export function speechSpec(id: SpecIdentity, o: SpeechLimits): LimitsSpec {
  const provider = o.provider ?? "geometer";
  const routes = provider === "sarvam"
    ? [{ method: "POST", path: SARVAM_ROUTES.listen, operation: "transcribe" }]
    : [{ method: "POST", path: GEOMETER_SPEECH_ROUTES.listen, operation: "transcribe" }];
  return {
    ...base(speechGuardDef(provider), id),
    routes,
    rules: [],
    limits: [count("listens-per-day", "transcribe", o.listensPerDay, 86_400)],
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
 *  - for a paid provider (Sarvam), its key has been handed in on this server through the write-only intake (`geometer speech-key`); Geometer's own speech service needs no key
 *    from the builder, so the default provider asks for none;
 *  - the Guards that carry it are placed on this server: today they are not (see the head of this file), so a block is always refused with that reason.
 * `placed` is a parameter so the day compose places the Guards the one line that says so changes, and a test shows the key check works on its own.
 */
export function speechProblem(o: { provider?: SpeechProviderKind; keyHandedIn: boolean; placed: boolean }): string | null {
  if ((o.provider ?? "geometer") === "sarvam" && !o.keyHandedIn) return "this shop uses Sarvam for voice notes, and a Sarvam key must be on this server first: hand it in with `geometer speech-key <file>` (it goes to the speech Guard only and is never shown again). The default, Geometer's own speech service, needs no key.";
  if (!o.placed) return "voice notes cannot run on this server yet: the speech and media Guards are defined (bundle/generate/speech.ts) but this release does not place them in the server's Compose file. Leave \"speech\" out of runtime.json until it does.";
  return null;
}

/** True while the bundle places the speech and media Guards. Flipped, with its tests, in the change that adds them to compose.ts. */
export const SPEECH_GUARDS_PLACED = false;
