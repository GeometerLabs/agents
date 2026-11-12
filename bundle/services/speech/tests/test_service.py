"""Routing and limits of SpeechService with fake engines: which engine hears which note, and what is refused."""
import shutil
import unittest
from dataclasses import replace

from geometer_speech.config import Settings
from geometer_speech.errors import SpeechError
from geometer_speech.service import SpeechService, normalise_hint

from .fakes import FakeEngine, FakeGuesser, tone_wav

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


def make(guess=("hi", 0.9), indic=True, english=True, guesser=True, **settings):
    s = replace(Settings(), ffmpeg=FFMPEG, **settings)
    ic = FakeEngine("fake-indic", ("hi", "ml", "kn"), "नमस्ते", chosen="ml") if indic else None
    en = FakeEngine("fake-whisper", ("en",), "book a haircut") if english else None
    g = FakeGuesser(*guess) if guesser else None
    return SpeechService(s, ic, en, g), ic, en, g


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class RoutingTests(unittest.TestCase):
    def test_hint_goes_straight_to_the_language_engine_without_a_guess(self):
        svc, ic, en, g = make()
        r = svc.transcribe(tone_wav(2), "kn")
        self.assertEqual((r.language, r.model, ic.calls[0][1]), ("kn", "fake-indic", "kn"))
        self.assertEqual(g.calls, 0)
        r = svc.transcribe(tone_wav(2), "en")
        self.assertEqual((r.language, r.model), ("en", "fake-whisper"))
        self.assertEqual(g.calls, 0)

    def test_hint_spellings(self):
        for raw, want in [("hi", "hi"), ("HI", "hi"), ("ml-IN", "ml"), ("kn_IN", "kn"), (" en ", "en"), ("", None), ("auto", None), (None, None)]:
            self.assertEqual(normalise_hint(raw), want, raw)

    def test_unknown_language_is_refused_in_words(self):
        svc, *_ = make()
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(tone_wav(1), "ta")
        self.assertEqual(c.exception.status, 400)
        self.assertIn("hi, ml, kn or en", c.exception.message)

    def test_no_hint_confident_english_goes_to_whisper(self):
        svc, ic, en, g = make(guess=("en", 0.95))
        r = svc.transcribe(tone_wav(2), None)
        self.assertEqual((r.language, r.model), ("en", "fake-whisper"))
        self.assertEqual(len(en.calls), 1)
        self.assertEqual(ic.calls, [])

    def test_no_hint_whisper_naming_an_indic_language_is_believed(self):
        svc, ic, en, g = make(guess=("kn", 0.8))
        r = svc.transcribe(tone_wav(2), None)
        self.assertEqual((r.language, ic.calls[0][1]), ("kn", "kn"))

    def test_no_hint_whisper_unsure_about_an_indic_language_lets_the_indic_model_score(self):
        svc, ic, en, g = make(guess=("kn", 0.3))
        self.assertEqual(svc.transcribe(tone_wav(2), None).language, "ml")  # the fake model's own pick
        self.assertIsNone(ic.calls[0][1])

    def test_ctc_pick_mode_ignores_whisper_among_indic_languages(self):
        svc, ic, en, g = make(guess=("kn", 0.99), language_pick="ctc")
        svc.transcribe(tone_wav(2), None)
        self.assertIsNone(ic.calls[0][1])

    def test_no_hint_unsure_english_goes_to_the_indic_model_which_picks(self):
        svc, ic, en, g = make(guess=("en", 0.40))
        r = svc.transcribe(tone_wav(2), None)
        self.assertEqual((r.language, r.model), ("ml", "fake-indic"))  # the fake "chose" ml
        self.assertEqual(ic.calls[0][1], None)

    def test_no_hint_other_language_names_go_to_the_indic_model(self):
        for said in ("hi", "ur", "mr", "ta"):  # (hi is believed; the others are scored by the Indic model)
            svc, ic, en, g = make(guess=(said, 0.99))
            svc.transcribe(tone_wav(1), None)
            self.assertEqual(len(ic.calls), 1, said)

    def test_no_guesser_installed_uses_the_indic_model_else_english(self):
        svc, ic, en, g = make(guesser=False)
        self.assertEqual(svc.transcribe(tone_wav(1), None).model, "fake-indic")
        svc, ic, en, g = make(guesser=False, indic=False)
        self.assertEqual(svc.transcribe(tone_wav(1), None).model, "fake-whisper")

    def test_missing_model_is_a_503_that_tells_the_operator_what_to_do(self):
        svc, *_ = make(indic=False)
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(tone_wav(1), "hi")
        self.assertEqual(c.exception.status, 503)
        self.assertIn("fetch-models", c.exception.message)

    def test_result_shape(self):
        svc, *_ = make()
        body = svc.transcribe(tone_wav(2), "hi").as_json()
        self.assertEqual(set(body), {"text", "language", "seconds", "model", "confidence"})
        self.assertAlmostEqual(body["seconds"], 2.0, delta=0.05)

    def test_confidence_is_left_out_when_the_engine_cannot_say(self):
        svc, ic, *_ = make()
        ic.confidence = None
        self.assertNotIn("confidence", svc.transcribe(tone_wav(1), "hi").as_json())


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class LimitTests(unittest.TestCase):
    def test_over_size_and_empty(self):
        svc, *_ = make(max_bytes=1000)
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(b"x" * 1001, "hi")
        self.assertEqual(c.exception.status, 413)
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(b"", "hi")
        self.assertEqual(c.exception.status, 400)

    def test_over_30_seconds_never_reaches_a_model(self):
        svc, ic, *_ = make()
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(tone_wav(31.5), "hi")
        self.assertEqual(c.exception.status, 413)
        self.assertEqual(ic.calls, [])

    def test_busy_when_the_queue_is_full(self):
        svc, *_ = make(max_waiting=0)
        svc._slots.acquire()  # pretend one note is already being heard and nobody may wait
        with self.assertRaises(SpeechError) as c:
            svc.transcribe(tone_wav(1), "hi")
        self.assertEqual((c.exception.status, c.exception.retry_after), (503, 5))


if __name__ == "__main__":
    unittest.main()
