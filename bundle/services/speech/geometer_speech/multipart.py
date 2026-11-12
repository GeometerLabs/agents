"""A small multipart/form-data reader: the adapter sends the voice note as one part named `file`, optionally with a text part `language`.

Used by server.py. The standard library dropped `cgi` in Python 3.13 and `email` is not built for untrusted uploads, so this reads
the body directly: split on the boundary, parse each part's headers, return the parts. The caller has already capped the body at
5 MB, so this works on bytes in memory.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .errors import SpeechError

_BOUNDARY = re.compile(r'boundary=(?:"([^"]+)"|([^;\s]+))', re.I)
_NAME = re.compile(r'\bname="([^"]*)"', re.I)
_FILENAME = re.compile(r'\bfilename="([^"]*)"', re.I)


@dataclass(frozen=True)
class Part:
    name: str
    filename: str | None
    content_type: str
    data: bytes


def boundary_of(content_type: str) -> bytes:
    m = _BOUNDARY.search(content_type)
    if not m:
        raise SpeechError(400, "The request says it is a form but gives no boundary.")
    return (m.group(1) or m.group(2)).encode("latin-1")


def parse(body: bytes, boundary: bytes) -> list[Part]:
    delim = b"--" + boundary
    chunks = body.split(delim)
    parts: list[Part] = []
    # chunks[0] is the preamble; the part after the closing "--" is the epilogue
    for chunk in chunks[1:]:
        if chunk.startswith(b"--"):
            break
        chunk = chunk[2:] if chunk.startswith(b"\r\n") else chunk[1:] if chunk.startswith(b"\n") else chunk
        head, sep, data = chunk.partition(b"\r\n\r\n")
        if not sep:
            head, sep, data = chunk.partition(b"\n\n")
        if not sep:
            raise SpeechError(400, "The form is not well formed.")
        if data.endswith(b"\r\n"):
            data = data[:-2]
        headers = {}
        for line in head.decode("utf-8", "replace").splitlines():
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
        disposition = headers.get("content-disposition", "")
        name = _NAME.search(disposition)
        if not name:
            continue
        fn = _FILENAME.search(disposition)
        parts.append(Part(name.group(1), fn.group(1) if fn else None, headers.get("content-type", ""), data))
    return parts
