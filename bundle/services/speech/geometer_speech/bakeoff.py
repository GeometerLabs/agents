"""The bake-off: score the speech service on real voice notes before any shop relies on it.

Run by the owner (README, "The bake-off"). Input is a folder with one sub-folder per language (hi, ml, kn, en); each holds audio files
and, beside each, a reference transcript written by a native speaker: `note1.ogg` + `note1.txt`, or one `transcripts.tsv` per folder
(`file name<TAB>transcript`). The tool sends every note to a running service, exactly as a shop's speech Guard would, and reports per
language: word error rate (WER), character error rate (CER, on Unicode characters) and, for Indic scripts, CER on aksharas (a consonant
with its vowel signs counts as one unit, which is how a reader sees a mistake), plus the time taken per second of audio.

WER alone misleads for Indic text: Hindi, Malayalam and Kannada join and inflect words, so one wrong ending makes a whole word wrong
while the sound is almost right. Read WER and CER together; the akshara figure is the closest to "would a person call this right".

Only the standard library is used, so it runs anywhere python3 does, including on the owner's laptop against the server.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path

AUDIO_SUFFIXES = {".ogg", ".opus", ".oga", ".mp3", ".m4a", ".aac", ".wav", ".amr", ".flac", ".webm", ".mp4"}
_INDIC_DIGITS = {ord(c): str(i) for base in (0x0966, 0x0D66, 0x0CE6) for i, c in enumerate(chr(base + k) for k in range(10))}
# the virama (halant) joins a consonant to the next one: the two letters are one visible unit
_VIRAMAS = {"्", "്", "್"}


# ---- text normalisation and error rates ---------------------------------------------------------------------------------

def normalise(text: str, *, digits: bool = False, keep_joiners: bool = False) -> str:
    """Make two spellings of the same speech comparable: NFC, no punctuation (including the danda), Latin lower-case, single spaces.

    Zero-width joiners are dropped unless `keep_joiners`: they change how a letter is drawn, rarely what is said, and writers differ.
    `digits` maps Devanagari, Malayalam and Kannada digits to 0-9 so '५' and '5' agree.
    """
    t = unicodedata.normalize("NFC", text)
    if not keep_joiners:
        t = t.replace("‌", "").replace("‍", "")
    if digits:
        t = t.translate(_INDIC_DIGITS)
    out = []
    for ch in t.lower():
        cat = unicodedata.category(ch)
        out.append(" " if cat.startswith("P") or cat.startswith("S") or ch.isspace() else ch)
    return " ".join("".join(out).split())


def akshara(text: str) -> list[str]:
    """Split into visible units: a base letter with its combining marks, and consonants joined by a virama stay together."""
    units: list[str] = []
    join_next = False
    for ch in text:
        if ch.isspace():
            units.append(" ")
            join_next = False
        elif units and units[-1] != " " and (join_next or unicodedata.category(ch).startswith("M")):
            units[-1] += ch
            join_next = ch in _VIRAMAS
        else:
            units.append(ch)
            join_next = False
    return units


def edit_distance(a: list, b: list) -> int:
    """Levenshtein distance (insertions, deletions, substitutions each cost 1) with one row of memory."""
    if not a:
        return len(b)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def rates(reference: str, hypothesis: str) -> dict[str, tuple[int, int]]:
    """(errors, reference length) for words, characters and aksharas of one note."""
    rw, hw = reference.split(), hypothesis.split()
    rc, hc = list(reference.replace(" ", "")), list(hypothesis.replace(" ", ""))
    ra, ha = [u for u in akshara(reference) if u != " "], [u for u in akshara(hypothesis) if u != " "]
    return {"wer": (edit_distance(rw, hw), len(rw)), "cer": (edit_distance(rc, hc), len(rc)), "aer": (edit_distance(ra, ha), len(ra))}


# ---- reading the folder ----------------------------------------------------------------------------------------------------

@dataclass
class Note:
    language: str
    path: Path
    reference: str


def load_notes(root: Path, languages: list[str] | None = None) -> tuple[list[Note], list[str]]:
    """Return the notes with a reference, and a list of problems in plain words (audio without a transcript, empty transcripts)."""
    notes: list[Note] = []
    problems: list[str] = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        if languages and folder.name not in languages:
            continue
        table: dict[str, str] = {}
        tsv = folder / "transcripts.tsv"
        if tsv.is_file():
            for line in tsv.read_text(encoding="utf-8").splitlines():
                name, _, text = line.partition("\t")
                if name.strip() and text.strip():
                    table[name.strip()] = text.strip()
        for audio in sorted(f for f in folder.iterdir() if f.suffix.lower() in AUDIO_SUFFIXES):
            sidecar = audio.with_suffix(".txt")
            ref = sidecar.read_text(encoding="utf-8").strip() if sidecar.is_file() else table.get(audio.name, table.get(audio.stem, ""))
            if not ref:
                problems.append(f"{folder.name}/{audio.name}: no reference transcript (expected {sidecar.name} or a line in transcripts.tsv); skipped")
                continue
            notes.append(Note(folder.name, audio, ref))
    return notes, problems


# ---- talking to the service ---------------------------------------------------------------------------------------------------

def send(url: str, audio: Path, hint: str | None, token: str | None, timeout: float) -> tuple[dict, float]:
    """POST one note to /v1/transcribe as a multipart form (exactly what the adapter sends) and return (reply, seconds taken)."""
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{audio.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(), audio.read_bytes(), b"\r\n"]
    if hint:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{hint}\r\n'.encode())
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(url.rstrip("/") + "/v1/transcribe", data=b"".join(parts), headers=headers, method="POST")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            msg = ""
        raise RuntimeError(f"HTTP {e.code} {msg}".strip())
    return body, time.perf_counter() - started


# ---- the report ---------------------------------------------------------------------------------------------------------------

@dataclass
class LangStats:
    notes: int = 0
    failed: int = 0
    audio_seconds: float = 0.0
    wall_seconds: list[float] = field(default_factory=list)
    errors: dict[str, int] = field(default_factory=lambda: {"wer": 0, "cer": 0, "aer": 0})
    lengths: dict[str, int] = field(default_factory=lambda: {"wer": 0, "cer": 0, "aer": 0})
    detect_right: int = 0
    worst: list[tuple[float, str, str, str]] = field(default_factory=list)  # (note WER, file, reference, heard)
    models: set[str] = field(default_factory=set)

    def add(self, note_rates: dict[str, tuple[int, int]], audio_s: float, wall_s: float, name: str, ref: str, hyp: str) -> None:
        self.notes += 1
        self.audio_seconds += audio_s
        self.wall_seconds.append(wall_s)
        for k, (e, n) in note_rates.items():
            self.errors[k] += e
            self.lengths[k] += n
        e, n = note_rates["wer"]
        self.worst.append((e / n if n else 0.0, name, ref, hyp))

    def pct(self, k: str) -> float | None:
        return 100.0 * self.errors[k] / self.lengths[k] if self.lengths[k] else None


def summarise(stats: dict[str, LangStats], detect: bool) -> list[dict]:
    rows = []
    for lang, s in sorted(stats.items()):
        wall = sorted(s.wall_seconds)
        rows.append({
            "language": lang, "notes": s.notes, "failed": s.failed, "audio_seconds": round(s.audio_seconds, 1),
            "wer_pct": _r(s.pct("wer")), "cer_pct": _r(s.pct("cer")), "akshara_error_pct": _r(s.pct("aer")),
            "seconds_per_audio_second": _r(sum(s.wall_seconds) / s.audio_seconds, 3) if s.audio_seconds else None,
            "median_seconds_per_note": _r(statistics.median(wall), 2) if wall else None,
            "slowest_seconds_per_note": _r(wall[-1], 2) if wall else None,
            "language_detected_right_pct": _r(100.0 * s.detect_right / s.notes) if detect and s.notes else None,
            "models": sorted(s.models),
            "worst": [{"wer": round(w, 2), "file": f, "reference": r, "heard": h} for w, f, r, h in sorted(s.worst, reverse=True)[:5]],
        })
    return rows


def _r(x: float | None, n: int = 1) -> float | None:
    return None if x is None else round(x, n)


def render(rows: list[dict], problems: list[str]) -> str:
    out = ["", f"{'lang':<5}{'notes':>6}{'fail':>6}{'WER %':>8}{'CER %':>8}{'akshara %':>11}{'sec/sec':>9}{'median s':>10}{'detect %':>10}"]
    fmt = lambda v: "-" if v is None else f"{v}"
    for r in rows:
        out.append(f"{r['language']:<5}{r['notes']:>6}{r['failed']:>6}{fmt(r['wer_pct']):>8}{fmt(r['cer_pct']):>8}{fmt(r['akshara_error_pct']):>11}{fmt(r['seconds_per_audio_second']):>9}{fmt(r['median_seconds_per_note']):>10}{fmt(r['language_detected_right_pct']):>10}")
    out += ["", "sec/sec = seconds of computer time per second of audio (below 1 means faster than the note is long).", "akshara % = errors counted per visible letter unit; for Hindi, Malayalam and Kannada read it beside WER."]
    for r in rows:
        if r["worst"]:
            out.append(f"\nWorst notes, {r['language']}:")
            for w in r["worst"]:
                out.append(f"  WER {w['wer']:.2f}  {w['file']}\n    said : {w['reference']}\n    heard: {w['heard']}")
    for p in problems:
        out.append(f"note: {p}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Score the speech service on real voice notes (WER, CER, speed).")
    ap.add_argument("folder", type=Path, help="folder with one sub-folder per language (hi, ml, kn, en), each holding audio + transcripts")
    ap.add_argument("--url", default="http://127.0.0.1:8080", help="the running service (default %(default)s)")
    ap.add_argument("--token-file", type=Path, help="file holding the service's shared token, if it has one")
    ap.add_argument("--detect", action="store_true", help="send NO language hint, so the service must find the language itself; reports how often it was right")
    ap.add_argument("--languages", nargs="*", help="only these sub-folders")
    ap.add_argument("--digits", action="store_true", help="treat Indic digits and 0-9 as the same before comparing")
    ap.add_argument("--keep-joiners", action="store_true", help="keep zero-width joiners when comparing")
    ap.add_argument("--timeout", type=float, default=60.0)
    ap.add_argument("--json", type=Path, help="also write the full result here")
    args = ap.parse_args(argv)

    if not args.folder.is_dir():
        print(f"{args.folder} is not a folder", file=sys.stderr)
        return 2
    token = args.token_file.read_text(encoding="utf-8").strip() if args.token_file else None
    notes, problems = load_notes(args.folder, args.languages)
    if not notes:
        print("No notes with a reference transcript were found.\n" + "\n".join(problems), file=sys.stderr)
        return 2
    stats: dict[str, LangStats] = {}
    for n in notes:
        s = stats.setdefault(n.language, LangStats())
        try:
            reply, wall = send(args.url, n.path, None if args.detect else n.language, token, args.timeout)
        except Exception as e:  # one bad note must not lose the rest of the run
            s.failed += 1
            problems.append(f"{n.language}/{n.path.name}: {e}")
            continue
        heard = normalise(str(reply.get("text", "")), digits=args.digits, keep_joiners=args.keep_joiners)
        ref = normalise(n.reference, digits=args.digits, keep_joiners=args.keep_joiners)
        s.add(rates(ref, heard), float(reply.get("seconds", 0.0)), wall, n.path.name, ref, heard)
        s.models.add(str(reply.get("model", "")))
        if args.detect and reply.get("language") == n.language:
            s.detect_right += 1
    rows = summarise(stats, args.detect)
    print(render(rows, problems))
    if args.json:
        args.json.write_text(json.dumps({"rows": rows, "problems": problems}, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
