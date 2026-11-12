"""Pieces that wrap the models, tested without the models: whisper.cpp output parsing, IndicConformer's CTC decode on fake tensors,
the multipart reader, the bake-off's scoring and the fetch-models pins."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from geometer_speech import bakeoff, fetch_models, multipart
from geometer_speech.errors import SpeechError
from geometer_speech.indic import IndicConformer, _as_index
from geometer_speech.whisper_cpp import parse_detection, parse_whisper_json

LOCK = json.loads(fetch_models.LOCK.read_text(encoding="utf-8"))


class WhisperParsing(unittest.TestCase):
    def test_json(self):
        h = parse_whisper_json({"transcription": [{"text": " book a", "tokens": [{"text": "[_BEG_]", "p": 1.0}, {"text": " book", "p": 0.9}, {"text": " a", "p": 0.7}]}, {"text": " haircut", "tokens": [{"text": " haircut", "p": 0.8}]}]})
        self.assertEqual((h.text, h.language), ("book a haircut", "en"))
        self.assertAlmostEqual(h.confidence, 0.8)

    def test_no_tokens_no_confidence(self):
        self.assertIsNone(parse_whisper_json({"transcription": [{"text": "hi"}]}).confidence)

    def test_detection_line(self):
        g = parse_detection("whisper_full_with_state: auto-detected language: hi (p = 0.987654)\n")
        self.assertEqual((g.language, round(g.probability, 3)), ("hi", 0.988))
        with self.assertRaises(SpeechError):
            parse_detection("nothing useful")


class IndicDecode(unittest.TestCase):
    """CTC decode on hand-made log-probabilities: collapse repeats, drop blanks, join pieces, score languages."""

    def model(self):
        m = object.__new__(IndicConformer)
        m._vocab = {"hi": ["▁क", "ल", "▁सु"], "ml": ["▁എ", "ന്"], "kn": ["▁ಅ"]}
        # full vocabulary of 8 slots: hi owns 0,1,2 + blank 3; ml owns 4,5 + blank 6; kn owns 7 (+ blank 3 reused to keep the example small)
        m._masks = {"hi": np.array([0, 1, 2, 3]), "ml": np.array([4, 5, 6]), "kn": np.array([7, 3])}
        m.languages = ("hi", "ml", "kn")
        return m

    @staticmethod
    def frames(ids, size=8, hot=0.9):
        lp = np.full((len(ids), size), np.log((1 - hot) / (size - 1)))
        for t, k in enumerate(ids):
            lp[t, k] = np.log(hot)
        return lp

    def test_collapse_and_blank(self):
        text, conf, _ = self.model()._decode(self.frames([0, 0, 3, 1, 1, 3, 2]), "hi")
        self.assertEqual(text, "कल सु")
        self.assertAlmostEqual(conf, 0.9, places=2)

    def test_repeat_across_a_blank_is_two_letters(self):
        text, *_ = self.model()._decode(self.frames([1, 3, 1]), "hi")
        self.assertEqual(text, "लल")

    def test_silence_is_empty_with_no_confidence(self):
        text, conf, _ = self.model()._decode(self.frames([3, 3, 3]), "hi")
        self.assertEqual((text, conf), ("", None))

    def test_language_score_prefers_the_language_whose_pieces_hold_the_mass(self):
        m = self.model()
        lp = self.frames([4, 5, 4, 5, 6])
        scores = {l: m._decode(lp, l)[2] for l in m.languages}
        self.assertEqual(max(scores, key=scores.get), "ml")

    def test_mask_formats(self):
        self.assertEqual(_as_index([3, 5, 9]).tolist(), [3, 5, 9])
        self.assertEqual(_as_index([False, True, True, False] + [False] * 3000).tolist(), [1, 2])


class MultipartReader(unittest.TestCase):
    def test_parts_binary_safe(self):
        blob = bytes(range(256)) + b"\r\n--XBOUNDARYX-not-a-boundary\r\n"
        body = (b'--B\r\nContent-Disposition: form-data; name="file"; filename="a.ogg"\r\nContent-Type: audio/ogg\r\n\r\n' + blob + b'\r\n--B\r\nContent-Disposition: form-data; name="language"\r\n\r\nhi\r\n--B--\r\n')
        parts = {p.name: p for p in multipart.parse(body, b"B")}
        self.assertEqual(parts["file"].data, blob)
        self.assertEqual(parts["language"].data, b"hi")

    def test_no_boundary_is_a_400(self):
        with self.assertRaises(SpeechError):
            multipart.boundary_of("multipart/form-data")


class BakeoffScoring(unittest.TestCase):
    def test_wer_cer_basic(self):
        r = bakeoff.rates("the cat sat", "the cat sit")
        self.assertEqual(r["wer"], (1, 3))
        self.assertEqual(r["cer"], (1, 9))

    def test_normalise_ignores_punctuation_danda_case_and_joiners(self):
        self.assertEqual(bakeoff.normalise("कल, सुबह।  Haircut!"), "कल सुबह haircut")
        self.assertEqual(bakeoff.normalise("क्‍ष"), bakeoff.normalise("क्ष"))
        self.assertEqual(bakeoff.normalise("५ बजे", digits=True), "5 बजे")

    def test_akshara_units_for_each_script(self):
        self.assertEqual(bakeoff.akshara("क्षमा"), ["क्ष", "मा"])          # Devanagari conjunct + vowel sign
        self.assertEqual(bakeoff.akshara("ಕನ್ನಡ"), ["ಕ", "ನ್ನ", "ಡ"])        # Kannada
        self.assertEqual(len(bakeoff.akshara("മലയാളം")), 4)                # Malayalam: മ ല യാ ളം

    def test_indic_one_matra_wrong_is_one_akshara_but_the_word_is_wrong(self):
        r = bakeoff.rates("बुकिंग", "बुकिंग".replace("ि", "ी"))
        self.assertEqual(r["wer"], (1, 1))
        self.assertEqual(r["aer"][0], 1)
        self.assertLess(r["aer"][0] / r["aer"][1], 0.5)

    def test_folder_loading_with_sidecars_and_tsv(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "hi").mkdir()
            (root / "en").mkdir()
            (root / "hi" / "a.ogg").write_bytes(b"x")
            (root / "hi" / "a.txt").write_text("कल आना\n", encoding="utf-8")
            (root / "hi" / "b.ogg").write_bytes(b"x")   # no transcript
            (root / "en" / "c.mp3").write_bytes(b"x")
            (root / "en" / "transcripts.tsv").write_text("c.mp3\tbook a haircut\n", encoding="utf-8")
            notes, problems = bakeoff.load_notes(root)
            self.assertEqual({(n.language, n.path.name, n.reference) for n in notes}, {("hi", "a.ogg", "कल आना"), ("en", "c.mp3", "book a haircut")})
            self.assertEqual(len(problems), 1)
            self.assertIn("hi/b.ogg", problems[0])

    def test_summary_and_render(self):
        s = bakeoff.LangStats()
        s.add(bakeoff.rates("a b c d", "a b c x"), 10.0, 4.0, "n.ogg", "a b c d", "a b c x")
        rows = bakeoff.summarise({"hi": s}, detect=False)
        self.assertEqual(rows[0]["wer_pct"], 25.0)
        self.assertEqual(rows[0]["seconds_per_audio_second"], 0.4)
        self.assertIn("25.0", bakeoff.render(rows, []))


class FetchModelsPins(unittest.TestCase):
    def test_every_pin_is_complete(self):
        for m in LOCK["models"]:
            self.assertRegex(m["revision"], r"^[0-9a-f]{40}$")
            for f in m["files"]:
                self.assertRegex(f["git"], r"^[0-9a-f]{40}$", f["path"])
                self.assertGreater(f["size"], 0)

    def test_lock_holds_only_what_the_ctc_path_needs(self):
        ic = next(m for m in LOCK["models"] if m["id"] == "indic-conformer")
        paths = {f["path"] for f in ic["files"]}
        for need in ("assets/encoder.onnx", "assets/ctc_decoder.onnx", "assets/vocab.json", "assets/language_masks.json"):
            self.assertIn(need, paths)
        self.assertFalse([p for p in paths if "joint_" in p or "rnnt" in p or p.endswith(".py") or p.endswith(".ts")])

    def test_pinned_sha256_agrees_with_the_pinned_git_pointer(self):
        # for the files whose sha256 is public (Whisper) the lock must be self-consistent: sha256 + size rebuild the pointer whose id is pinned
        checked = 0
        for m in LOCK["models"]:
            for f in m["files"]:
                if f.get("lfs") and f.get("sha256"):
                    self.assertEqual(fetch_models.git_blob_oid(fetch_models.pointer_text(f["sha256"], f["size"])), f["git"], f["path"])
                    self.assertEqual(len(fetch_models.pointer_text(f["sha256"], f["size"])), f["pointer_size"])
                    checked += 1
        self.assertEqual(checked, 2)

    def test_hub_answers_that_do_not_match_the_pin_stop_the_run(self):
        ic = {"files": [{"path": "w.bin", "size": 10, "lfs": True, "git": "0" * 40}], "repo": "x/y"}
        with self.assertRaises(SystemExit):
            fetch_models.expected_for(ic, {"w.bin": {"lfs": {"oid": "a" * 64}}})       # pointer id would not match
        with self.assertRaises(SystemExit):
            fetch_models.expected_for(ic, {"w.bin": {"lfs": {"oid": "*" * 64}}})       # hidden: no token / terms not accepted
        sha = "b" * 64
        good = {"files": [{"path": "w.bin", "size": 10, "lfs": True, "git": fetch_models.git_blob_oid(fetch_models.pointer_text(sha, 10))}], "repo": "x/y"}
        self.assertEqual(fetch_models.expected_for(good, {"w.bin": {"lfs": {"oid": sha}}}), {"w.bin": sha})

    def test_verify_file_small_and_large(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "f"
            p.write_bytes(b"hello")
            self.assertTrue(fetch_models.verify_file(p, {"size": 5, "git": fetch_models.git_blob_oid(b"hello")}, None))
            import hashlib
            self.assertTrue(fetch_models.verify_file(p, {"size": 5, "lfs": True, "git": ""}, hashlib.sha256(b"hello").hexdigest()))
            self.assertFalse(fetch_models.verify_file(p, {"size": 5, "lfs": True, "git": ""}, "0" * 64))
            self.assertFalse(fetch_models.verify_file(p, {"size": 6, "git": fetch_models.git_blob_oid(b"hello")}, None))


if __name__ == "__main__":
    unittest.main()
