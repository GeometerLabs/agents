"""The speech service's brain: check the request, decode the audio, choose an engine, run it, shape the answer.

Used by server.py (HTTP) and by the tests, which hand it fake engines. The HTTP layer never touches a model and the engines never
see HTTP; this file is the only place that knows the routing rules:
  - a language hint (hi, ml, kn, en) goes straight to that language's engine;
  - no hint: Whisper tiny guesses the language. English with enough probability goes to Whisper; hi / ml / kn named with some confidence
    goes to the Indic model in that language; anything else goes to the Indic model, which scores Hindi, Malayalam and Kannada against
    each other on the note itself and keeps the best (config.py language_pick).
One model run at a time (a 4 vCPU box gains nothing from two at once), with a short queue and a plain "busy" answer beyond it.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

from .audio import SAMPLE_RATE, decode
from .config import INDIC_LANGUAGES, LANGUAGES, SECONDS_GRACE, Settings
from .engines import Heard, LanguageGuesser, Transcriber
from .errors import SpeechError


@dataclass(frozen=True)
class Result:
    text: str
    language: str
    seconds: float
    model: str
    confidence: float | None

    def as_json(self) -> dict:
        out: dict = {"text": self.text, "language": self.language, "seconds": round(self.seconds, 2), "model": self.model}
        if self.confidence is not None:
            out["confidence"] = round(self.confidence, 3)
        return out


def normalise_hint(hint: str | None) -> str | None:
    """'hi', 'HI', 'hi-IN', 'ml_IN' -> 'hi' / 'ml'; blank or 'auto' -> None (detect). Anything else is refused in words."""
    if hint is None:
        return None
    h = hint.strip().lower().replace("_", "-").split("-")[0]
    if h in ("", "auto", "und"):
        return None
    if h not in LANGUAGES:
        raise SpeechError(400, f"The language '{hint}' is not supported. Use hi, ml, kn or en, or leave it out and the service will listen and decide.")
    return h


class SpeechService:
    def __init__(self, settings: Settings, indic: Transcriber | None, english: Transcriber | None, guesser: LanguageGuesser | None) -> None:
        self.settings = settings
        self.indic, self.english, self.guesser = indic, english, guesser
        # one model run at a time; `_slots` counts the running one plus the waiting ones
        self._run = threading.Lock()
        self._slots = threading.BoundedSemaphore(1 + settings.max_waiting)

    def ready(self) -> dict[str, bool]:
        return {"indic": self.indic is not None, "english": self.english is not None, "language_guess": self.guesser is not None}

    def is_ready(self) -> bool:
        # useful with at least one engine; a missing one is reported on the request that needs it
        return self.indic is not None or self.english is not None

    def transcribe(self, audio: bytes, hint: str | None) -> Result:
        if not audio:
            raise SpeechError(400, "No audio came with the request.")
        if len(audio) > self.settings.max_bytes:
            raise SpeechError(413, f"This audio is larger than {self.settings.max_bytes // (1024 * 1024)} MB. Please send a shorter voice note.")
        language = normalise_hint(hint)
        samples = decode(audio, ffmpeg=self.settings.ffmpeg, max_seconds=self.settings.max_seconds, grace=SECONDS_GRACE)
        seconds = samples.size / SAMPLE_RATE
        if not self._slots.acquire(blocking=False):
            raise SpeechError(503, "The speech service is busy with other notes. Please try again in a few seconds.", retry_after=5)
        try:
            if not self._run.acquire(timeout=self.settings.wait_seconds):
                raise SpeechError(503, "The speech service is busy with other notes. Please try again in a few seconds.", retry_after=5)
            try:
                heard, model = self._route(samples, language)
            finally:
                self._run.release()
        finally:
            self._slots.release()
        return Result(heard.text, heard.language, seconds, model, heard.confidence)

    # -- routing -------------------------------------------------------------------------------------------------------

    def _engine(self, language: str | None) -> Transcriber:
        """The engine for a language, or a plain 503 naming the missing model files (the operator's `fetch-models` step)."""
        if language == "en":
            if self.english is None:
                raise SpeechError(503, "The English speech model is not installed on this server yet. The operator needs to run fetch-models.")
            return self.english
        if self.indic is None:
            raise SpeechError(503, "The Hindi, Malayalam and Kannada speech model is not installed on this server yet. The operator needs to run fetch-models.")
        return self.indic

    def _route(self, samples: np.ndarray, language: str | None) -> tuple[Heard, str]:
        if language is None:
            language = self._detect(samples)  # None here means "Indic, let the model choose among hi / ml / kn"
        engine = self._engine(language)
        return engine.transcribe(samples, language), engine.model

    def _detect(self, samples: np.ndarray) -> str | None:
        """English, or None for 'one of the Indic languages'. With no guesser installed: Indic if we have it, else English."""
        if self.guesser is None:
            return None if self.indic is not None else "en"
        guess = self.guesser.guess(samples)
        if guess.language == "en" and guess.probability >= self.settings.english_min_probability:
            return "en"
        # Among the Indic languages, whisper-first (default) believes Whisper when it names hi / ml / kn with some confidence: the Indic model's own
        # per-language scoring is unproven (a head trained with a per-language softmax gives probability outside a language's pieces no meaning).
        # When Whisper says something else (it may call Hindi 'ur' or 'mr', Malayalam 'ta') the Indic model scores the three on the audio.
        # SPEECH_LANGUAGE_PICK=ctc always scores, so the bake-off's --detect can compare the two.
        if self.settings.language_pick == "whisper-first" and guess.language in INDIC_LANGUAGES and guess.probability >= 0.5 and self.indic is not None:
            return guess.language
        return None
