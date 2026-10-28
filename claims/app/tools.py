"""The claims agent's actions, as plain functions. They call the claims service named by CLAIMS_URL. The claim
decides who is paid and how much; a claim is paid once (the service's own list of payments is read first and
again after a call that got no answer); a payment above PAYMENT_LIMIT waits for an adjuster's approval id."""
import json
import os
import urllib.error
import urllib.request

CLAIMS = os.environ.get("CLAIMS_URL", "http://claims.example")


def call(method, path, body=None, key=None):
    """One request: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(CLAIMS + path, method=method, headers=headers, data=data)
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

PAYMENT_LIMIT = float(os.environ.get("PAYMENT_LIMIT", "1000.00"))


def get_claim(claim_id):
    r = call("GET", f"/v1/claims/{claim_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such claim"


def pay_claim(claim_id, approval="", send_to=""):
    """send_to is ignored on purpose: the money goes to the policyholder's account on the claim."""
    r = call("GET", f"/v1/claims/{claim_id}")
    if not r or r[0] != 200:
        return "no such claim; nothing was paid"
    claim = r[1]
    if claim["status"] != "approved":
        return f"the claim is {claim['status']}, not approved; nothing was paid"
    if float(claim["amount"]) > PAYMENT_LIMIT and not approval:
        return f"held: a payment of {claim['amount']} needs an adjuster's approval id"
    path = f"/v1/claims/{claim_id}/payments"
    done = first(path)
    if done:
        return f"already paid: {json.dumps(done)}"
    body = {"account": claim["policyholder_account"], "amount": claim["amount"], "approval": approval}
    sent = call("POST", path, body, key=f"pay-{claim_id}")
    if sent is None:  # no answer: look before saying anything, and never send again
        done = first(path)
        return f"paid: {json.dumps(done)}" if done else "no answer from the claims service; whether it was paid is unknown."
    return json.dumps(sent[1])
