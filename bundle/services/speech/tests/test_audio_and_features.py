"""Decode step (real ffmpeg, generated tone) and the numpy front end's shapes. No model needed."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from geometer_speech.audio import decode, SAMPLE_RATE
from geometer_speech.errors import SpeechError
from geometer_speech.features import log_mel, mel_filterbank

from .fakes import tone_wav

FFMPEG = shutil.which("ffmpeg")


@unittest.skipUnless(FFMPEG, "ffmpeg not installed")
class DecodeTests(unittest.TestCase):
    def test_wav_tone_becomes_16k_mono_samples(self):
        x = decode(tone_wav(2.0, rate=8000), ffmpeg=FFMPEG, max_seconds=30, grace=0.25)  # 8 kHz in, resampled to 16 kHz
        self.assertEqual(x.dtype, np.float32)
        self.assertAlmostEqual(x.size / SAMPLE_RATE, 2.0, delta=0.05)
        self.assertGreater(float(np.abs(x).max()), 0.1)

    def test_ogg_opus_like_a_whatsapp_voice_note(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "note.ogg"
            made = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-c:a", "libopus", "-b:a", "16k", str(out)], capture_output=True)
            if made.returncode != 0:
                self.skipTest("this ffmpeg cannot write Opus")
            x = decode(out.read_bytes(), ffmpeg=FFMPEG, max_seconds=30, grace=0.25)
        self.assertAlmostEqual(x.size / SAMPLE_RATE, 3.0, delta=0.1)

    def test_webm_opus_like_the_owners_talk_box_on_android(self):
        # plan item 11i: Android's Chrome records only WebM Opus, written live (unknown sizes, no duration), and the owner's page sends it as it is
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "note.webm"
            made = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-c:a", "libopus", "-b:a", "24k", "-live", "1", str(out)], capture_output=True)
            if made.returncode != 0:
                self.skipTest("this ffmpeg cannot write WebM Opus")
            x = decode(out.read_bytes(), ffmpeg=FFMPEG, max_seconds=30, grace=0.25)
        self.assertAlmostEqual(x.size / SAMPLE_RATE, 3.0, delta=0.1)

    def test_a_real_chromium_recording(self):
        # the recording Chromium's MediaRecorder made in the agents repo's tests (modules/voice/test/fixtures), read by the same ffmpeg step
        fixture = Path(__file__).resolve().parents[4] / "modules" / "voice" / "test" / "fixtures" / "chromium-recording.webm"
        if not fixture.exists():
            self.skipTest("the Chromium recording is not next to this service")
        x = decode(fixture.read_bytes(), ffmpeg=FFMPEG, max_seconds=30, grace=0.25)
        # Chromium's test microphone is mostly silence, which the recorder leaves out as gaps: ffmpeg gives back the sound that is there
        self.assertGreater(x.size, 0)

    def test_longer_than_30_seconds_is_refused_in_words(self):
        with self.assertRaises(SpeechError) as c:
            decode(tone_wav(33.0), ffmpeg=FFMPEG, max_seconds=30, grace=0.25)
        self.assertEqual(c.exception.status, 413)
        self.assertIn("30 seconds", c.exception.message)

    def test_exactly_30_seconds_is_fine(self):
        self.assertEqual(round(decode(tone_wav(30.0), ffmpeg=FFMPEG, max_seconds=30, grace=0.25).size / SAMPLE_RATE), 30)

    def test_not_audio_is_refused(self):
        with self.assertRaises(SpeechError) as c:
            decode(b"this is a text file, not a voice note" * 20, ffmpeg=FFMPEG, max_seconds=30, grace=0.25)
        self.assertEqual(c.exception.status, 422)

    def test_missing_ffmpeg_is_a_plain_503(self):
        with self.assertRaises(SpeechError) as c:
            decode(tone_wav(1.0), ffmpeg="/nonexistent/ffmpeg", max_seconds=30, grace=0.25)
        self.assertEqual(c.exception.status, 503)


class FeatureTests(unittest.TestCase):
    def test_shape_and_normalisation(self):
        t = np.arange(SAMPLE_RATE * 3) / SAMPLE_RATE
        f = log_mel((0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32))
        self.assertEqual(f.shape[:2], (1, 80))
        self.assertAlmostEqual(f.shape[2], 3 * 100 + 1, delta=2)  # 10 ms hop
        self.assertTrue(np.isfinite(f).all())
        self.assertLess(abs(float(f[0, :, :290].mean())), 0.2)  # each band is centred over the note

    def test_filterbank_covers_the_spectrum(self):
        fb = mel_filterbank()
        self.assertEqual(fb.shape, (80, 257))
        self.assertTrue((fb.sum(axis=1) > 0).all())


if __name__ == "__main__":
    unittest.main()
