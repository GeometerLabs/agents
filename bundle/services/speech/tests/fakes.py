"""Stand-in engines and test audio, so every test runs without a model file, onnxruntime or whisper.cpp.

Used by test_service.py and test_server.py. `tone_wav` builds a real WAV in memory (stdlib only) that ffmpeg then decodes, so the
decode step is exercised for real while the models are not.
"""
from __future__ import annotations

import io
import math
import wave

import numpy as np

from geometer_speech.engines import Guess, Heard


class FakeEngine:
    def __init__(self, model: str, languages: tuple[str, ...], text: str = "hello", chosen: str | None = None, confidence: float | None = 0.9) -> None:
        self.model, self.languages, self.text, self.chosen, self.confidence = model, languages, text, chosen, confidence
        self.calls: list[tuple[int, str | None]] = []

    def transcribe(self, samples: np.ndarray, language: str | None) -> Heard:
        self.calls.append((samples.size, language))
        return Heard(self.text, language or self.chosen or self.languages[0], self.confidence)


class FakeGuesser:
    model = "fake-guesser"

    def __init__(self, language: str, probability: float) -> None:
        self.answer, self.calls = Guess(language, probability), 0

    def guess(self, samples: np.ndarray) -> Guess:
        self.calls += 1
        return self.answer


def tone_wav(seconds: float, rate: int = 16_000, hz: float = 440.0) -> bytes:
    n = int(seconds * rate)
    pcm = np.array([int(8000 * math.sin(2 * math.pi * hz * i / rate)) for i in range(n)], dtype="<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def multipart_body(file: bytes, language: str | None = None, boundary: str = "XBOUNDARYX") -> tuple[bytes, str]:
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice-note"\r\nContent-Type: audio/ogg\r\n\r\n'.encode(), file, b"\r\n"]
    if language is not None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'.encode())
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
