"""fetch-models: download the speech models into the models folder and check every file. Run by the OPERATOR, with their own Hugging Face token.

Never run by Geometer's code or by the service. Why it exists: IndicConformer's repository is gated (a Hugging Face account that has
accepted its terms is needed to download it), so the files cannot be baked into the image or fetched anonymously.

What "pinned" means here (models.lock.json): each model is fixed to ONE commit of its repository, and each file to the git object id
it has at that commit. For a large file that id belongs to a small pointer text which spells out the file's sha256 and size. So after a
file is downloaded the script hashes it, rebuilds that pointer text from the sha256 it just computed and the pinned size, and checks the
pointer's git id equals the pinned one. A different file cannot pass without the commit's own record being different. Small files are
checked against their git blob id. This needs no file listing from Hugging Face, and the same check runs offline for `--check`.
A file that fails is deleted and the script stops. Where the lock also holds a sha256 (the Whisper files) it must agree as well.

The token goes only to huggingface.co (it is stripped when the download is redirected to the storage host) and is never printed or stored.

Usage:  python3 -m geometer_speech.fetch_models --models-dir /srv/geometer/speech-models [--token-file FILE] [--only indic-conformer]
        python3 -m geometer_speech.fetch_models --models-dir DIR --check          (re-verify files already on disk, no network)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HF = "https://huggingface.co"
LOCK = Path(__file__).resolve().parent.parent / "models.lock.json"
CHUNK = 1024 * 1024


def pointer_text(sha256: str, size: int) -> bytes:
    """The Git LFS pointer file that stands in for a large file in the repository."""
    return f"version https://git-lfs.github.com/spec/v1\noid sha256:{sha256}\nsize {size}\n".encode()


def git_blob_oid(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def git_blob_oid_file(path: Path) -> str:
    h = hashlib.sha1(b"blob %d\0" % path.stat().st_size)
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


class StripAuthOnRedirect(urllib.request.HTTPRedirectHandler):
    """Hugging Face redirects downloads to a storage host; the token must not follow it there."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlsplit(newurl).netloc != urllib.parse.urlsplit(req.full_url).netloc:
            new.headers.pop("Authorization", None)
            new.unredirected_hdrs.pop("Authorization", None)
        return new


def opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(StripAuthOnRedirect)


def verify_file(path: Path, f: dict) -> bool:
    """True when the file on disk is exactly the one the pinned commit records (size, then the git id, rebuilt from the sha256 for large files)."""
    if not path.is_file() or path.stat().st_size != f["size"]:
        return False
    if not f.get("lfs"):
        return git_blob_oid_file(path) == f["git"]
    digest = sha256_file(path)
    if f.get("sha256") and digest != f["sha256"]:
        return False
    return git_blob_oid(pointer_text(digest, f["size"])) == f["git"]


def download(op: urllib.request.OpenerDirector, model: dict, f: dict, dest: Path, token: str | None) -> None:
    url = f"{HF}/{model['repo']}/resolve/{model['revision']}/{urllib.parse.quote(f['path'])}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
    part = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with op.open(req, timeout=120) as resp, part.open("wb") as out:
            while chunk := resp.read(CHUNK):
                out.write(chunk)
    except urllib.error.HTTPError as e:
        part.unlink(missing_ok=True)
        hint = " Log in to Hugging Face, accept the model's terms on its page, and pass your token." if e.code in (401, 403) else ""
        raise SystemExit(f"{f['path']}: Hugging Face answered {e.code}.{hint}")
    os.replace(part, dest)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Download and verify Geometer's speech models (run by the operator, with their own Hugging Face token).")
    ap.add_argument("--models-dir", type=Path, required=True)
    ap.add_argument("--lock", type=Path, default=LOCK)
    ap.add_argument("--token-file", type=Path, help="a file holding your Hugging Face access token (read access is enough); or set HF_TOKEN")
    ap.add_argument("--only", action="append", help="fetch just this model id (indic-conformer, whisper-english)")
    ap.add_argument("--check", action="store_true", help="only re-verify what is already on disk; no network")
    args = ap.parse_args(argv)

    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    token = args.token_file.read_text(encoding="utf-8").strip() if args.token_file else os.environ.get("HF_TOKEN", "").strip() or None
    op = opener()
    bad = 0
    for model in lock["models"]:
        if args.only and model["id"] not in args.only:
            continue
        target = args.models_dir / model["target"]
        print(f"== {model['id']}: {model['repo']} @ {model['revision'][:12]} ({model['license']}, {len(model['files'])} files)")
        if not args.check and model.get("gated") and not token:
            print(f"  {model['repo']} is gated: give your Hugging Face token (--token-file or HF_TOKEN) after accepting its terms at {HF}/{model['repo']}", file=sys.stderr)
            return 2
        good = fetched = 0
        for f in model["files"]:
            dest = target / f["path"]
            if verify_file(dest, f):
                good += 1
                continue
            if args.check:
                print(f"  {f['path']}: MISSING or WRONG")
                bad += 1
                continue
            download(op, model, f, dest, token)
            if not verify_file(dest, f):
                dest.unlink(missing_ok=True)
                raise SystemExit(f"{f['path']}: the downloaded file failed its check against the pinned commit and was deleted. Stopping.")
            fetched += 1
        print(f"  {good} already good, {fetched} downloaded and checked")
    print("All files checked." if not bad else f"{bad} file(s) need attention.")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
