"""Settings of the speech service, read once from environment variables (set by the bundle's Compose file).

Used by server.py (limits, token) and service.py (where the model files are). Nothing here is secret
except the token, which is read from a file so it never sits in an environment listing.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# The four languages a shop can use. Hindi, Malayalam and Kannada go to IndicConformer; English to Whisper.
LANGUAGES = ("hi", "ml", "kn", "en")
INDIC_LANGUAGES = ("hi", "ml", "kn")

# The owner's limits (12 Nov): a WhatsApp voice note is 5-30 s; refuse more than that, in plain words.
MAX_SECONDS = 30.0
# Codecs pad a few milliseconds past the stated length; a note a hair over 30.0 s is still a 30 s note.
SECONDS_GRACE = 0.25
MAX_BYTES = 5 * 1024 * 1024


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "")
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if 0 <= value <= 1 else default


@dataclass(frozen=True)
class Settings:
    models_dir: Path = Path("/models")
    host: str = "0.0.0.0"
    port: int = 8080
    # Shared token: only when the service is NOT on the same private network as its Guard. Empty means "private network, no token".
    token: str = ""
    require_token: bool = False
    threads: int = 4
    # How many requests may wait for the one model run at a time, and for how long (kept well under the adapter's 20 s timeout, which also has to cover the run itself).
    max_waiting: int = 3
    wait_seconds: float = 5.0
    # Below this probability Whisper's language guess is not trusted as "English" and the Indic model gets the note.
    english_min_probability: float = 0.6
    # "whisper-first": when Whisper tiny names hi, ml or kn, believe it; otherwise score the three on the Indic model. "ctc": always score on the Indic model.
    language_pick: str = "whisper-first"
    whisper_cli: str = "whisper-cli"
    ffmpeg: str = "ffmpeg"
    max_seconds: float = MAX_SECONDS
    max_bytes: int = MAX_BYTES
    extras: dict = field(default_factory=dict)

    @staticmethod
    def from_env() -> "Settings":
        token = os.environ.get("SPEECH_TOKEN", "").strip()
        token_file = os.environ.get("SPEECH_TOKEN_FILE", "")
        if token_file:
            # A missing file with a path given is a mistake worth stopping for, not a silent "no token".
            token = Path(token_file).read_text(encoding="utf-8").strip()
        return Settings(
            models_dir=Path(os.environ.get("SPEECH_MODELS_DIR", "/models")),
            host=os.environ.get("SPEECH_HOST", "0.0.0.0"),
            port=_int("SPEECH_PORT", 8080),
            token=token,
            require_token=os.environ.get("SPEECH_REQUIRE_TOKEN", "") == "1",
            threads=_int("SPEECH_THREADS", 4),
            max_waiting=_int("SPEECH_MAX_WAITING", 3),
            wait_seconds=float(_int("SPEECH_WAIT_SECONDS", 5)),
            english_min_probability=_float("SPEECH_EN_MIN_PROB", 0.6),
            language_pick="ctc" if os.environ.get("SPEECH_LANGUAGE_PICK", "") == "ctc" else "whisper-first",
            whisper_cli=os.environ.get("SPEECH_WHISPER_CLI", "whisper-cli"),
            ffmpeg=os.environ.get("SPEECH_FFMPEG", "ffmpeg"),
        )
