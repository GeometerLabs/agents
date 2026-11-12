"""fetch-models: download the speech models into the models folder and check every file. Run by the OPERATOR, with their own Hugging Face token.

Never run by Geometer's code or by the service. Why it exists: IndicConformer's repository is gated (a Hugging Face account that has
accepted its terms is needed to download it), so the files cannot be baked into the image or fetched anonymously.

What "pinned" means here (models.lock.json): each model is fixed to ONE commit of its repository, and each file to the git object id
it has at that commit. For a large file that id belongs to a small pointer text which spells out the file's sha256 and size, so:
  1. with the operator's token the script asks Hugging Face for the file list AT THAT COMMIT and reads each large file's sha256;
  2. it rebuilds the pointer text from that sha256 and checks its git id equals the pinned one (so Hugging Face cannot hand back a
     different file without the pin noticing);
  3. it downloads the file and checks the bytes against that sha256 (small files: against their git blob id).
A file that fails any check is deleted and the script stops. Where the lock also holds a sha256 (the Whisper files) it must agree.

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


def api_json(op: urllib.request.OpenerDirector, url: str, token: str | None) -> list:
    """GET a JSON list from the Hub, following its `Link: rel=next` pages."""
    out: list = []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"} if token else {})
        with op.open(req, timeout=60) as resp:
            out += json.loads(resp.read().decode("utf-8"))
            link = resp.headers.get("Link", "")
        url = ""
        for part in link.split(","):
            if 'rel="next"' in part and "<" in part:
                url = part[part.index("<") + 1:part.index(">")]
    return out


def expected_for(model: dict, listing: dict[str, dict]) -> dict[str, str | None]:
    """sha256 for every large file of the model (lock first, else the token-authorised listing), checked against the pinned git ids."""
    sha: dict[str, str | None] = {}
    for f in model["files"]:
        if not f.get("lfs"):
            continue
        listed = (listing.get(f["path"], {}).get("lfs") or {}).get("oid", "")
        pinned = f.get("sha256")
        if pinned and listed and pinned != listed:
            raise SystemExit(f"{f['path']}: Hugging Face reports a different sha256 than the lock pins. Stopping: do not use these files.")
        value = pinned or listed
        if not value or "*" in value:
            raise SystemExit(f"{f['path']}: Hugging Face did not show the file's sha256. Is the token valid and has this account accepted the model's terms at https://huggingface.co/{model['repo']} ?")
        if git_blob_oid(pointer_text(value, f["size"])) != f["git"]:
            raise SystemExit(f"{f['path']}: its sha256 does not match the pinned commit. Stopping: the repository is not the revision the lock pins.")
        sha[f["path"]] = value
    return sha


def verify_file(path: Path, f: dict, sha256: str | None) -> bool:
    if not path.is_file() or path.stat().st_size != f["size"]:
        return False
    return sha256_file(path) == sha256 if f.get("lfs") else git_blob_oid_file(path) == f["git"]


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
        sha: dict[str, str | None]
        if args.check:
            # offline: only the sha256 the lock itself holds is known; large files without one are checked by size and reported
            sha = {f["path"]: f.get("sha256") for f in model["files"] if f.get("lfs")}
        else:
            if model.get("gated") and not token:
                print(f"  {model['repo']} is gated: give your Hugging Face token (--token-file or HF_TOKEN) after accepting its terms at {HF}/{model['repo']}", file=sys.stderr)
                return 2
            listing = {e["path"]: e for e in api_json(op, f"{HF}/api/models/{model['repo']}/tree/{model['revision']}?recursive=true", token) if e.get("type") == "file"}
            sha = expected_for(model, listing)
        done = fetched = 0
        for f in model["files"]:
            dest = target / f["path"]
            if f.get("lfs") and sha.get(f["path"]) is None:
                ok = dest.is_file() and dest.stat().st_size == f["size"]
                print(f"  {f['path']}: present, size ok, sha256 not in the lock (run without --check to verify)" if ok else f"  {f['path']}: MISSING")
                bad += 0 if ok else 1
                continue
            if verify_file(dest, f, sha.get(f["path"])):
                done += 1
                continue
            if args.check:
                print(f"  {f['path']}: MISSING or WRONG")
                bad += 1
                continue
            download(op, model, f, dest, token)
            if not verify_file(dest, f, sha.get(f["path"])):
                dest.unlink(missing_ok=True)
                raise SystemExit(f"{f['path']}: the downloaded file failed its check and was deleted. Stopping.")
            fetched += 1
        print(f"  {done} already good, {fetched} downloaded and checked")
    print("All files checked." if not bad else f"{bad} file(s) need attention.")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
