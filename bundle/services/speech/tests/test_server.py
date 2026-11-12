"""The HTTP layer end to end on a real local socket, with fake engines: contract, auth, limits."""
import json
import shutil
import threading
import unittest
import urllib.error
import urllib.request
from dataclasses import replace
from http.server import ThreadingHTTPServer

from geometer_speech.config import Settings
from geometer_speech.server import make_handler, token_ok
from geometer_speech.service import SpeechService

from .fakes import FakeEngine, FakeGuesser, multipart_body, tone_wav

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


class Running:
    def __init__(self, token="", **settings):
        s = replace(Settings(), ffmpeg=FFMPEG, token=token, **settings)
        self.indic = FakeEngine("fake-indic", ("hi", "ml", "kn"), "नमस्ते")
        self.service = SpeechService(s, self.indic, FakeEngine("fake-whisper", ("en",), "book it"), FakeGuesser("hi", 0.9))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def call(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=body, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read().decode("utf-8")), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8")), e.headers


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class ServerTests(unittest.TestCase):
    def setUp(self):
        self.srv = Running()
        self.addCleanup(self.srv.close)

    def post_note(self, path="/v1/transcribe", language=None, audio=None, headers=None, srv=None):
        body, ctype = multipart_body(audio if audio is not None else tone_wav(2), language)
        return (srv or self.srv).call("POST", path, body, {"Content-Type": ctype, **(headers or {})})

    def test_the_adapters_call_gets_the_contract_shape(self):
        status, body, _ = self.post_note()  # no hint, as the voice-notes adapter sends it
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {"text", "language", "seconds", "model", "confidence"})
        self.assertEqual(body["text"], "नमस्ते")  # non-ASCII text survives as UTF-8
        self.assertIn(body["language"], ("hi", "ml", "kn"))

    def test_stt_alias_and_language_part(self):
        status, body, _ = self.post_note("/stt", language="en")
        self.assertEqual((status, body["language"], body["model"]), (200, "en", "fake-whisper"))

    def test_raw_audio_body_with_query_hint(self):
        status, body, _ = self.srv.call("POST", "/stt?language=kn", tone_wav(2), {"Content-Type": "audio/wav"})
        self.assertEqual((status, body["language"]), (200, "kn"))

    def test_unknown_language_400(self):
        status, body, _ = self.post_note(language="fr")
        self.assertEqual(status, 400)
        self.assertIn("not supported", body["error"])

    def test_form_without_file_part(self):
        body = b'--B\r\nContent-Disposition: form-data; name="other"\r\n\r\nx\r\n--B--\r\n'
        status, out, _ = self.srv.call("POST", "/v1/transcribe", body, {"Content-Type": "multipart/form-data; boundary=B"})
        self.assertEqual(status, 400)
        self.assertIn("'file'", out["error"])

    def test_wrong_content_type_415(self):
        status, _, _ = self.srv.call("POST", "/stt", b"{}", {"Content-Type": "application/json"})
        self.assertEqual(status, 415)

    def test_over_5mb_is_refused_before_it_is_read(self):
        status, body, _ = self.srv.call("POST", "/stt", b"\0" * (5 * 1024 * 1024 + 70_000), {"Content-Type": "audio/ogg"})
        self.assertEqual(status, 413)
        self.assertIn("5 MB", body["error"])

    def test_over_30_seconds_413_in_words(self):
        status, body, _ = self.post_note(audio=tone_wav(32))
        self.assertEqual(status, 413)
        self.assertIn("30 seconds", body["error"])
        self.assertEqual(self.srv.indic.calls, [])

    def test_garbage_audio_422(self):
        status, _, _ = self.post_note(audio=b"not audio at all" * 50)
        self.assertEqual(status, 422)

    def test_healthz_routes_and_methods(self):
        status, body, _ = self.srv.call("GET", "/healthz")
        self.assertEqual((status, body["status"]), (200, "ok"))
        self.assertEqual(self.srv.call("GET", "/v1/transcribe")[0], 405)
        self.assertEqual(self.srv.call("GET", "/nope")[0], 404)
        self.assertEqual(self.srv.call("POST", "/nope", b"x", {"Content-Type": "audio/ogg"})[0], 404)

    def test_speak_says_this_service_only_listens(self):
        status, body, _ = self.srv.call("POST", "/v1/speak", b'{"text":"hi"}', {"Content-Type": "application/json"})
        self.assertEqual(status, 501)
        self.assertIn("text", body["error"])

    def test_chunked_upload_without_a_length_is_accepted(self):
        import http.client
        host, port = self.srv.httpd.server_address
        body, ctype = multipart_body(tone_wav(1), "hi")
        c = http.client.HTTPConnection(host, port, timeout=10)
        c.request("POST", "/v1/transcribe", body=iter([body[:100], body[100:]]), headers={"Content-Type": ctype, "Transfer-Encoding": "chunked"}, encode_chunked=True)
        r = c.getresponse()
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(r.read())["language"], "hi")

    def test_a_refusal_after_a_big_upload_still_reaches_the_client_as_words(self):
        # the body is sent in full; the 404 must come back as readable JSON, not a reset connection
        status, body, _ = self.srv.call("POST", "/nope", b"\0" * (3 * 1024 * 1024), {"Content-Type": "audio/ogg"})
        self.assertEqual((status, body["error"]), (404, "No such route."))

    def test_no_length_header_411(self):
        import http.client
        host, port = self.srv.httpd.server_address
        c = http.client.HTTPConnection(host, port, timeout=10)
        c.putrequest("POST", "/stt")
        c.putheader("Content-Type", "audio/wav")
        c.endheaders()
        self.assertEqual(c.getresponse().status, 411)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class AuthTests(unittest.TestCase):
    def setUp(self):
        self.srv = Running(token="s3cret-token")
        self.addCleanup(self.srv.close)

    def post(self, headers):
        body, ctype = multipart_body(tone_wav(1), "hi")
        return self.srv.call("POST", "/v1/transcribe", body, {"Content-Type": ctype, **headers})

    def test_unauthorised_big_upload_gets_the_sentence_not_a_reset(self):
        status, body, _ = self.srv.call("POST", "/v1/transcribe", b"\0" * (2 * 1024 * 1024), {"Content-Type": "audio/ogg", "Authorization": "no"})
        self.assertEqual(status, 401)
        self.assertIn("token", body["error"])

    def test_token_required_when_set(self):
        self.assertEqual(self.post({})[0], 401)
        self.assertEqual(self.post({"Authorization": "wrong"})[0], 401)
        self.assertEqual(self.post({"Authorization": "Bearer wrong"})[0], 401)

    def test_guard_style_and_bearer_style_both_work(self):
        self.assertEqual(self.post({"Authorization": "s3cret-token"})[0], 200)
        self.assertEqual(self.post({"Authorization": "Bearer s3cret-token"})[0], 200)

    def test_401_even_for_speak_and_health_stays_open(self):
        self.assertEqual(self.srv.call("POST", "/v1/speak", b"{}", {"Content-Type": "application/json"})[0], 401)
        self.assertEqual(self.srv.call("GET", "/healthz")[0], 200)

    def test_token_ok_without_token_allows_everyone(self):
        self.assertTrue(token_ok(None, ""))
        self.assertFalse(token_ok(None, "x"))


if __name__ == "__main__":
    unittest.main()
