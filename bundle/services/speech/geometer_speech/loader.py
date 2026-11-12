"""Builds the real SpeechService from the model files in the mounted folder: whichever models are present are loaded, the rest are reported missing.

Used by server.py at start. Split from service.py so the tests (and the bake-off's helpers) never import onnxruntime.
"""
from __future__ import annotations

import logging

from .config import Settings
from .service import SpeechService

log = logging.getLogger("geometer-speech")


def build_service(settings: Settings) -> SpeechService:
    indic = english = guesser = None
    try:
        from .indic import IndicConformer

        indic = IndicConformer(settings.models_dir, settings.threads)
        log.info("loaded %s", indic.model)
    except (FileNotFoundError, OSError) as e:
        log.warning("Hindi/Malayalam/Kannada model not loaded: %s", e)
    try:
        from .whisper_cpp import WhisperEnglish, WhisperGuesser

        english = WhisperEnglish(settings.models_dir, settings.whisper_cli, settings.threads)
        log.info("loaded %s", english.model)
        guesser = WhisperGuesser(settings.models_dir, settings.whisper_cli, settings.threads)
        log.info("loaded %s", guesser.model)
    except FileNotFoundError as e:
        log.warning("English / language-guess model not loaded: %s", e)
    return SpeechService(settings, indic, english, guesser)
