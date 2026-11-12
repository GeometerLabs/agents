"""Audio in: turn whatever the customer's phone sent into 16 kHz mono samples with ffmpeg, and enforce the length limit.

Used by service.py. WhatsApp voice notes are Ogg Opus, but AMR, MP3, M4A, WAV and others arrive too; ffmpeg reads them all.
The audio is written to a temporary file only for ffmpeg to read (some formats cannot be read from a pipe) and the file is
deleted before the function returns. Nothing is kept: the service has no store.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import wave

import numpy as np

from .errors import SpeechError

SAMPLE_RATE = 16_000


def decode(data: bytes, *, ffmpeg: str, max_seconds: float, grace: float) -> np.ndarray:
    """Return float32 samples in [-1, 1] at 16 kHz mono; raise SpeechError for audio that is unreadable or too long.

    `-t` stops ffmpeg shortly after the limit: a 5 MB low-bitrate file can hold hours, and decoding all of it would
    let one request hold the box. We keep a little more than the limit so "too long" is measured, not guessed.
    """
    # Opened O_EXCL by mkstemp with 0600; /tmp is a RAM disk in the container (read-only root, tmpfs /tmp).
    fd, path = tempfile.mkstemp(prefix="note-", suffix=".bin")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        cmd = [
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1",
            "-i", path, "-vn", "-sn", "-dn", "-t", str(max_seconds + 2.0),
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1",
        ]
        try:
            done = subprocess.run(cmd, capture_output=True, timeout=30, check=False)
        except subprocess.TimeoutExpired:
            raise SpeechError(422, "This audio took too long to read and was stopped. Please send a normal voice note.")
        except FileNotFoundError:
            raise SpeechError(503, "The speech service cannot read audio on this server (ffmpeg is missing).")
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    pcm = np.frombuffer(done.stdout, dtype=np.int16)
    if done.returncode != 0 or pcm.size == 0:
        raise SpeechError(422, "This does not look like audio the service can read. Please send a voice note (Ogg, MP3, M4A, AMR or WAV).")
    seconds = pcm.size / SAMPLE_RATE
    if seconds > max_seconds + grace:
        raise SpeechError(413, f"This voice note is longer than {int(max_seconds)} seconds. Please send a shorter one.")
    return pcm.astype(np.float32) / 32768.0


def write_wav(path: str, samples: np.ndarray) -> None:
    """Write 16 kHz mono 16-bit WAV (whisper.cpp reads WAV; the stdlib `wave` module needs no extra package)."""
    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
