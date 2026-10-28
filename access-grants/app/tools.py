"""The access agent's actions, as plain functions. They call the directory named by DIRECTORY_URL. The request
decides which account gets which role; a request is granted once (the directory's own list of grants is read
first and again after a call that got no answer); a role above editor (level 2) waits for a security lead's
approval id."""
import json
import os
import urllib.error
import urllib.request

DIRECTORY = os.environ.get("DIRECTORY_URL", "http://directory.example")


def call(method, path, body=None, key=None):
    """One request: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DIRECTORY + path, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=float(os.environ.get("TOOL_TIMEOUT", "30"))) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError):
        return None


def first(path):
    """The first item of a list the service holds at this path, or None."""
    r = call("GET", path)
    return (r[1] or [None])[0] if r and r[0] == 200 else None

ADMIN_LEVEL = int(os.environ.get("ADMIN_LEVEL", "2"))  # levels above this need approval


def get_request(request_id):
    r = call("GET", f"/v1/requests/{request_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such request"


def grant_role(request_id, approval="", send_to=""):
    """send_to is ignored on purpose: the role goes to the account on the request."""
    r = call("GET", f"/v1/requests/{request_id}")
    if not r or r[0] != 200:
        return "no such request; nothing was granted"
    req = r[1]
    if int(req["level"]) > ADMIN_LEVEL and not approval:
        return f"held: the {req['role']} role needs a security lead's approval id"
    path = f"/v1/requests/{request_id}/grants"
    done = first(path)
    if done:
        return f"already granted: {json.dumps(done)}"
    body = {k: req[k] for k in ("account", "role", "level")} | {"approval": approval}
    for _ in range(2):  # no answer: look whether it landed before trying once more
        sent = call("POST", path, body, key=f"grant-{request_id}")
        if sent is not None:
            return json.dumps(sent[1])
        done = first(path)
        if done:
            return f"granted: {json.dumps(done)}"
    return "no answer from the directory; whether the role was granted is unknown."
