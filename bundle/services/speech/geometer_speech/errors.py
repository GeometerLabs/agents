"""The one error the service raises on purpose: carries the HTTP status and a sentence a person can read.

Used everywhere; server.py turns it into a JSON body {"error": "..."}. Messages are written for the shop's
operator, not for a programmer, because the speech Guard passes them back up the chain.
"""
from __future__ import annotations


class SpeechError(Exception):
    def __init__(self, status: int, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after = retry_after
