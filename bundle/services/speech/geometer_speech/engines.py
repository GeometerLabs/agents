"""The small interfaces the rest of the service is written against, so the real models can be swapped for fakes in tests.

service.py decides WHICH engine hears a note; indic.py and whisper_cpp.py are the real ones; tests/fakes.py holds the fakes.
Nothing here imports a model library, so the tests and the bake-off's helpers load without onnxruntime installed.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class Heard:
    """What an engine heard: the words, the language it decoded as, and a 0..1 confidence (None when the engine cannot say)."""
    text: str
    language: str
    confidence: float | None


class Transcriber(Protocol):
    """Turns 16 kHz mono float32 samples into text."""

    #: Name reported in the response's `model` field, so a bake-off can say which model produced which number.
    model: str
    #: Languages this engine can be asked for.
    languages: tuple[str, ...]

    def transcribe(self, samples: np.ndarray, language: str | None) -> Heard:
        """`language` None means "you choose among your languages" (the Indic engine scores each)."""
        ...


@dataclass(frozen=True)
class Guess:
    language: str
    probability: float


class LanguageGuesser(Protocol):
    """The cheap first look at a note with no language hint: which language is this, roughly."""

    model: str

    def guess(self, samples: np.ndarray) -> Guess: ...
