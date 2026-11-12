// Getting the audio of a voice note, for the time of one call and no longer (plan B29). Held in memory: this file has no way to write a file.
//
//  - Meta: the webhook carries a media id. GET /{version}/{media_id} (through the WhatsApp provider's Guard) answers { url, mime_type, file_size }; the url lasts 5 minutes
//    and is downloaded with the shop's token. https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media.md (12 Nov 2026).
//    Meta's page does not say which host the url is on, so the host is a setting (`downloadHosts`) the first sandbox call fills in; a url on any other host is refused,
//    and only its path and query are sent on, to the Guard that fronts that host. That is how "the Guard allows only these reads" is kept: this code cannot ask for
//    anything else, and the Guard's spec (bundle/generate/guards.ts mediaSpec) lists nothing else.
//  - Gupshup: the callback's audio object carries a `url` (https://partner-docs.gupshup.io/docs/events, 12 Nov 2026). Its docs do not say whether that url needs a header
//    or which host it is on; the same two settings cover it. Not run against Gupshup (Deferred.md).
import { ApiError } from "../core/faults.ts";
import { isObject, num, str } from "../core/http.ts";
import type { Audio } from "./speech.ts";
import type { Wire } from "./wire.ts";

/** What travels with a voice note instead of its audio: where to fetch it. Never audio, never kept past the call. */
export interface MediaRef { id?: string; url?: string; mime?: string }

/** Meta documents 16 MB for audio; a voice note is a few hundred kilobytes, so a far smaller line is kept: more is refused rather than read. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export interface MediaSource {
  /** The Guard that fronts the provider's media-read route (Meta: GET /{version}/{media_id}). */
  lookup: Wire;
  /** The Guard that fronts the host the audio is downloaded from. */
  download: Wire;
  /** The Graph version in the lookup path (modules/messaging/whatsapp.ts GRAPH_VERSION). */
  version: string;
  /** Hosts a download url may be on; any other is refused. */
  downloadHosts: readonly string[];
}

/** A media id as Meta writes one: digits (and nothing that could change a path). */
const MEDIA_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/** The audio behind a reference, or throws. The caller turns any throw into "ask the customer to type". */
export async function fetchAudio(source: MediaSource, ref: MediaRef): Promise<Audio> {
  let url = ref.url;
  let mime = ref.mime;
  if (!url) {
    if (!ref.id || !MEDIA_ID.test(ref.id)) throw new ApiError(400, "The voice note carried no usable media reference.");
    const found = await source.lookup.request("GET", `/${source.version}/${encodeURIComponent(ref.id)}`);
    if (found.status < 200 || found.status >= 300 || !isObject(found.json)) throw new ApiError(found.status, `The media lookup answered ${found.status}.`);
    url = str(found.json.url);
    mime = str(found.json.mime_type) ?? mime;
    const size = num(Number(found.json.file_size));
    if (size !== undefined && size > MAX_AUDIO_BYTES) throw new ApiError(413, "The voice note is longer than the limit for voice notes.");
  }
  if (!url) throw new ApiError(502, "The media lookup gave no address for the audio.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(400, "The voice note's address is not a web address."); }
  if (parsed.protocol !== "https:" || !source.downloadHosts.includes(parsed.hostname)) throw new ApiError(400, "The voice note's address is not on a host this shop reads audio from.");
  // Only the path and query go on: the Guard (not this code) holds the credential and the host it speaks to.
  const got = await source.download.request("GET", parsed.pathname, { query: Object.fromEntries(parsed.searchParams), maxBytes: MAX_AUDIO_BYTES });
  if (got.status < 200 || got.status >= 300) throw new ApiError(got.status, `The audio download answered ${got.status}.`);
  if (got.bytes.length === 0) throw new ApiError(502, "The audio download was empty.");
  return { bytes: got.bytes, mime: (mime ?? got.contentType.split(";")[0]) || "audio/ogg" };
}
