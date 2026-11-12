"""IndicConformer (AI4Bharat, MIT) on onnxruntime: speech to text for Hindi, Malayalam and Kannada.

Used by service.py. The repo `ai4bharat/indic-conformer-600m-multilingual` holds ONE acoustic encoder shared by 22 languages and one
CTC output layer whose 5.6k pieces are split per language by `language_masks.json`. So a note is encoded once, and "which language
is this" can be scored cheaply by decoding it under each language's mask. We use the CTC path only (the RNNT path is slower and its
files are not fetched); see Deferred.md for what that leaves out.

Written from the model's published layout (assets/encoder.onnx + external weights, ctc_decoder.onnx, vocab.json, language_masks.json)
without access to the gated files, so tensor names are read from the loaded graphs rather than assumed, and shapes are checked.
The first real run is the proof (Deferred.md "IndicConformer front end unchecked").
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .config import INDIC_LANGUAGES
from .engines import Heard
from .errors import SpeechError
from .features import log_mel

MODEL_DIR = "indic-conformer"


class IndicConformer:
    model = "ai4bharat/indic-conformer-600m-multilingual (CTC, onnxruntime)"
    languages = INDIC_LANGUAGES

    def __init__(self, models_dir: Path, threads: int = 4) -> None:
        import onnxruntime as ort  # imported here so tests that never load a model do not need it

        assets = models_dir / MODEL_DIR / "assets"
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # encoder.onnx keeps its weights in sibling files (Constant_*, layers.*, onnx__*); onnxruntime finds them next to it.
        self._encoder = ort.InferenceSession(str(assets / "encoder.onnx"), opts, providers=["CPUExecutionProvider"])
        self._ctc = ort.InferenceSession(str(assets / "ctc_decoder.onnx"), opts, providers=["CPUExecutionProvider"])
        self._vocab: dict[str, list[str]] = json.loads((assets / "vocab.json").read_text(encoding="utf-8"))
        masks = json.loads((assets / "language_masks.json").read_text(encoding="utf-8"))
        self._masks = {lang: _as_index(masks[lang]) for lang in self.languages}
        for lang in self.languages:
            if lang not in self._vocab:
                raise RuntimeError(f"vocab.json has no entry for {lang}")

    # -- the model run -------------------------------------------------------------------------------------------------

    def _log_probs(self, samples: np.ndarray) -> np.ndarray:
        """[frames, full vocabulary] log-probabilities of the CTC layer (before any language mask)."""
        feats = log_mel(samples)
        ins = self._encoder.get_inputs()
        feed = {ins[0].name: feats}
        if len(ins) > 1:
            feed[ins[1].name] = np.array([feats.shape[2]], dtype=np.int64)
        outs = self._encoder.run(None, feed)
        encoded = outs[0]
        ctc_in = self._ctc.get_inputs()[0].name
        logp = self._ctc.run(None, {ctc_in: encoded})[0]
        logp = np.asarray(logp)
        if logp.ndim == 3:
            logp = logp[0]
        return logp

    def _decode(self, logp: np.ndarray, language: str) -> tuple[str, float | None, float]:
        """Decode under one language's mask. Returns (text, confidence, language_score)."""
        idx = self._masks[language]
        if logp.shape[1] <= int(idx.max()):
            # some exports put time last; the vocabulary axis is the one the mask indexes
            logp = logp.T
        sub = logp[:, idx]  # [frames, pieces of this language + blank]
        pieces = self._vocab[language]
        blank = len(pieces)
        best = sub.argmax(axis=1)
        top = sub.max(axis=1)
        # language score: average log of the probability mass this language's pieces hold per frame. Speech in another
        # language leaves its mass on pieces outside the mask, so the right language scores highest.
        m = sub.max(axis=1, keepdims=True)
        mass = (m[:, 0] + np.log(np.exp(sub - m).sum(axis=1)))
        score = float(mass.mean())
        out: list[str] = []
        probs: list[float] = []
        prev = -1
        for t, k in enumerate(best):
            k = int(k)
            if k != prev and k < blank:
                out.append(pieces[k])
                probs.append(math.exp(float(top[t])))
            prev = k
        text = "".join(out).replace("▁", " ").strip()
        text = " ".join(text.split())
        conf = float(np.mean(probs)) if probs else None
        return text, (min(max(conf, 0.0), 1.0) if conf is not None else None), score

    def transcribe(self, samples: np.ndarray, language: str | None) -> Heard:
        if language is not None and language not in self.languages:
            raise SpeechError(400, f"The Indic model does not hear '{language}'. Use hi, ml or kn.")
        logp = self._log_probs(samples)
        if language is not None:
            text, conf, _ = self._decode(logp, language)
            return Heard(text, language, conf)
        # no hint: decode under each language (the heavy encoder ran once) and keep the one whose pieces hold the most mass
        best: tuple[float, Heard] | None = None
        for lang in self.languages:
            text, conf, score = self._decode(logp, lang)
            if best is None or score > best[0]:
                best = (score, Heard(text, lang, conf))
        assert best is not None
        return best[1]


def _as_index(mask) -> np.ndarray:
    """language_masks.json may hold a 0/1 (or true/false) flag per piece, or the list of selected positions; return the positions."""
    arr = np.asarray(mask)
    if arr.dtype == bool or (arr.size and set(np.unique(arr).tolist()) <= {0, 1} and arr.size > 2000):
        return np.flatnonzero(arr.astype(bool))
    return arr.astype(np.int64)
