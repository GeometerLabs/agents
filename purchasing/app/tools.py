"""The purchasing agent's actions, as plain functions. They call the procurement service named by PROCUREMENT_URL.
The purchase request decides the supplier, the item and the amount; a request is ordered once (the service's
own list of orders is read first and again after a call that got no answer); an order above the buyer's limit
(on the request) waits for the buyer's own approval id."""
import json
import os
import urllib.error
import urllib.request

PROCUREMENT = os.environ.get("PROCUREMENT_URL", "http://procurement.example")


def call(method, path, body=None, key=None):
    """One request: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(PROCUREMENT + path, method=method, headers=headers, data=data)
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


def get_request(request_id):
    r = call("GET", f"/v1/requests/{request_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such request"


def place_order(request_id, approval=""):
    r = call("GET", f"/v1/requests/{request_id}")
    if not r or r[0] != 200:
        return "no such request; nothing was ordered"
    req = r[1]
    if float(req["amount"]) > float(req["buyer_limit"]) and not approval:
        return f"held: {req['amount']} is above the buyer's limit of {req['buyer_limit']}; the buyer must approve it"
    path = f"/v1/requests/{request_id}/orders"
    done = first(path)
    if done:
        return f"already ordered: {json.dumps(done)}"
    body = {k: req[k] for k in ("buyer", "supplier", "item", "quantity", "amount")} | {"approval": approval}
    for _ in range(2):  # no answer: look whether it landed before trying once more
        sent = call("POST", path, body, key=f"order-{request_id}")
        if sent is not None:
            return json.dumps(sent[1])
        done = first(path)
        if done:
            return f"ordered: {json.dumps(done)}"
    return "no answer from the supplier; whether it was ordered is unknown."
