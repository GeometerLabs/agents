"""Whisper (OpenAI, MIT) through whisper.cpp's command-line program: English transcription, and the cheap first look at the language.

Used by service.py. Two model files, both ggml builds of Whisper: a small English-only one (`ggml-small.en-q5_1.bin`) that writes the
English notes, and the multilingual `ggml-tiny-q5_1.bin`, which is only asked "what language is this" when a note arrives with no hint
(about a second on 4 vCPUs, an assumption to measure). whisper.cpp is a separate small program built into the image (Dockerfile) and run
once per note as a child process: no Python binding to pin, and a crash in it cannot take the service down.
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .audio import write_wav
from .engines import Guess, Heard
from .errors import SpeechError

ENGLISH_FILE = "ggml-small.en-q5_1.bin"
DETECTOR_FILE = "ggml-tiny-q5_1.bin"
MODEL_DIR = "whisper"

_DETECTED = re.compile(r"auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)")


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False, text=True)
    except subprocess.TimeoutExpired:
        raise SpeechError(503, "The speech model took too long on this note and was stopped. Please try again.")
    except FileNotFoundError:
        raise SpeechError(503, "The English speech program (whisper.cpp) is not installed on this server.")


class WhisperEnglish:
    model = "whisper small.en q5_1 (whisper.cpp)"
    languages = ("en",)

    def __init__(self, models_dir: Path, cli: str = "whisper-cli", threads: int = 4) -> None:
        self._model = models_dir / MODEL_DIR / ENGLISH_FILE
        if not self._model.is_file():
            raise FileNotFoundError(self._model)
        self._cli, self._threads = cli, threads

    def transcribe(self, samples: np.ndarray, language: str | None) -> Heard:
        if language not in (None, "en"):
            raise SpeechError(400, f"The English model does not hear '{language}'.")
        fd, wav = tempfile.mkstemp(prefix="note-", suffix=".wav")
        os.close(fd)
        prefix = wav[:-4]
        try:
            write_wav(wav, samples)
            # -ojf writes <prefix>.json with every token's probability; -nt keeps timestamps out of the text; -np keeps progress chatter out of stdout.
            done = _run([self._cli, "-m", str(self._model), "-f", wav, "-l", "en", "-t", str(self._threads), "-nt", "-np", "-ojf", "-of", prefix], timeout=60)
            if done.returncode != 0:
                raise SpeechError(503, "The English speech model failed on this note.")
            data = json.loads(Path(prefix + ".json").read_text(encoding="utf-8"))
        finally:
            for p in (wav, prefix + ".json"):
                try:
                    os.unlink(p)
                except FileNotFoundError:
                    pass
        return parse_whisper_json(data)


def parse_whisper_json(data: dict) -> Heard:
    """Join the segments' text; confidence is the mean probability of the real word pieces (special tokens like [_BEG_] are skipped)."""
    parts: list[str] = []
    probs: list[float] = []
    for seg in data.get("transcription", []):
        parts.append(str(seg.get("text", "")))
        for tok in seg.get("tokens", []):
            if not str(tok.get("text", "")).startswith("[_") and isinstance(tok.get("p"), (int, float)):
                probs.append(float(tok["p"]))
    text = " ".join(" ".join(parts).split())
    conf = sum(probs) / len(probs) if probs else None
    if conf is not None and (math.isnan(conf) or not 0 <= conf <= 1):
        conf = None
    return Heard(text, "en", conf)


class WhisperGuesser:
    """Language guess from Whisper tiny. Cheap, and wrong sometimes on Hindi-English mixes: the bake-off measures how often (README)."""
    model = "whisper tiny q5_1 (whisper.cpp), language detection only"

    def __init__(self, models_dir: Path, cli: str = "whisper-cli", threads: int = 4) -> None:
        self._model = models_dir / MODEL_DIR / DETECTOR_FILE
        if not self._model.is_file():
            raise FileNotFoundError(self._model)
        self._cli, self._threads = cli, threads

    def guess(self, samples: np.ndarray) -> Guess:
        fd, wav = tempfile.mkstemp(prefix="note-", suffix=".wav")
        os.close(fd)
        try:
            write_wav(wav, samples)
            done = _run([self._cli, "-m", str(self._model), "-f", wav, "-l", "auto", "-dl", "-t", str(self._threads)], timeout=30)
        finally:
            try:
                os.unlink(wav)
            except FileNotFoundError:
                pass
        return parse_detection(done.stdout + "\n" + done.stderr)


def parse_detection(output: str) -> Guess:
    m = _DETECTED.search(output)
    if not m:
        raise SpeechError(503, "The language check gave no answer for this note.")
    return Guess(m.group(1), float(m.group(2)))
