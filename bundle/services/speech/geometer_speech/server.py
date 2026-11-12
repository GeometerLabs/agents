"""The HTTP side of the speech service, on the standard library only (no web framework to pin and patch).

Why http.server and not FastAPI: the service has two real routes, one model run at a time and a 5 MB body cap. A framework would add
about fifteen pinned packages (pydantic, starlette, anyio and friends) to the image of a service that handles customers' voice
notes, for no feature it needs; the multipart part is 60 lines (multipart.py). The price is that we write the limits ourselves, which
the tests cover.

Routes (the contract is written in modules/voice/geometer.ts of the voice-notes branch; the speech Guard lists exactly these):
  POST /v1/transcribe   multipart/form-data, part `file` = the voice note, optional part `language`  -> JSON {text, language, seconds, model, confidence?}
  POST /stt             the same, and also accepts the raw audio as the body (Content-Type audio/*) with ?language=hi
  POST /v1/speak        answered 501: this service listens only; replies go out as text (owner's decision, 12 Nov 2026)
  GET  /healthz         200 when at least one model is loaded, else 503; says which are
"""
from __future__ import annotations

import hmac
import json
import logging
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import multipart
from .config import Settings
from .errors import SpeechError
from .service import SpeechService

log = logging.getLogger("geometer-speech")

TRANSCRIBE_PATHS = ("/v1/transcribe", "/stt")
# the multipart envelope around a 5 MB note is a few hundred bytes; this is generous without letting a body run on
ENVELOPE_ALLOWANCE = 64 * 1024


def token_ok(header: str | None, token: str) -> bool:
    """True when no token is set, or the Authorization header IS the token or 'Bearer <token>'.

    The speech Guard sends the file's contents as the Authorization header (bundle/generate/speech.ts), so both spellings are accepted.
    Compared in constant time so response timing does not leak the token.
    """
    if not token:
        return True
    if not header:
        return False
    candidate = header.strip()
    if candidate.lower().startswith("bearer "):
        candidate = candidate[7:].strip()
    return hmac.compare_digest(candidate.encode(), token.encode())


def make_handler(service: SpeechService):
    settings: Settings = service.settings

    class Handler(BaseHTTPRequestHandler):
        server_version = "geometer-speech"
        sys_version = ""
        timeout = 30  # a connection that stalls mid-upload is dropped, not kept for ever
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # one short line per request, never a body or a header
            log.info("%s %s", self.address_string(), fmt % args)

        def _send(self, status: int, body: dict, retry_after: int | None = None) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if retry_after:
                self.send_header("Retry-After", str(retry_after))
            self.end_headers()
            self.wfile.write(data)

        def _fail(self, e: SpeechError) -> None:
            self.close_connection = True  # an unread body may still be on the wire
            self._send(e.status, {"error": e.message}, e.retry_after)

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if path == "/healthz":
                ok = service.is_ready()
                self._send(200 if ok else 503, {"status": "ok" if ok else "no model installed", "models": service.ready()})
            elif path in TRANSCRIBE_PATHS or path == "/v1/speak":
                self._fail(SpeechError(405, "Send the voice note with POST."))
            else:
                self._fail(SpeechError(404, "No such route."))

        def do_POST(self) -> None:
            try:
                self._post()
            except SpeechError as e:
                self._fail(e)
            except Exception:  # never show a stack trace to a caller; the operator reads the log
                log.exception("unexpected error")
                self._fail(SpeechError(500, "The speech service hit a problem with this note."))

        def _post(self) -> None:
            url = urlsplit(self.path)
            if url.path not in TRANSCRIBE_PATHS and url.path != "/v1/speak":
                raise SpeechError(404, "No such route.")
            if not token_ok(self.headers.get("Authorization"), settings.token):
                raise SpeechError(401, "The speech service needs its shared token and did not get the right one.")
            if url.path == "/v1/speak":
                raise SpeechError(501, "This service only listens. Replies to customers go out as text.")
            length_header = self.headers.get("Content-Length")
            if length_header is None:
                raise SpeechError(411, "Send the audio with a Content-Length.")
            try:
                length = int(length_header)
            except ValueError:
                raise SpeechError(400, "The Content-Length is not a number.")
            if length <= 0:
                raise SpeechError(400, "No audio came with the request.")
            # refuse on the header, before reading a byte of the body
            if length > settings.max_bytes + ENVELOPE_ALLOWANCE:
                raise SpeechError(413, f"This audio is larger than {settings.max_bytes // (1024 * 1024)} MB. Please send a shorter voice note.")
            body = self.rfile.read(length)
            if len(body) != length:
                raise SpeechError(400, "The upload stopped before the audio was complete.")
            ctype = self.headers.get("Content-Type", "")
            query = parse_qs(url.query)
            hint = (query.get("language") or [None])[0] or self.headers.get("X-Language")
            if ctype.lower().startswith("multipart/form-data"):
                parts = {p.name: p for p in multipart.parse(body, multipart.boundary_of(ctype))}
                if "file" not in parts:
                    raise SpeechError(400, "The form needs a part named 'file' holding the voice note.")
                audio = parts["file"].data
                if "language" in parts:
                    hint = parts["language"].data.decode("utf-8", "replace").strip() or hint
            elif ctype.lower().startswith(("audio/", "application/octet-stream", "video/")):
                audio = body
            else:
                raise SpeechError(415, "Send the voice note as a form part named 'file', or as the raw audio.")
            result = service.transcribe(audio, hint)
            self._send(200, result.as_json())

    return Handler


def serve(service: SpeechService) -> None:
    s = service.settings
    httpd = ThreadingHTTPServer((s.host, s.port), make_handler(service))
    httpd.daemon_threads = True
    log.info("listening on %s:%s (models: %s)", s.host, s.port, service.ready())
    httpd.serve_forever()


def main() -> None:
    from .loader import build_service

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    settings = Settings.from_env()
    if settings.require_token and not settings.token:
        # a server that is not on a private network must not start without its token
        sys.exit("SPEECH_REQUIRE_TOKEN is set but no token was given (SPEECH_TOKEN_FILE). Refusing to start open.")
    if not settings.token:
        log.warning("no token set: the service answers anyone who can reach it. That is right only on a private network.")
    serve(build_service(settings))


if __name__ == "__main__":
    main()
