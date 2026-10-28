"""The lending agent's actions, as plain functions. They call the bank API named by BANK_URL. The code, not
the model, decides where the money goes (the application's verified account), and it looks at the bank's
own list of disbursements before any payment and again after a call that got no answer, so a loan is paid
once however often it is asked for."""
import json
import os
import urllib.error
import urllib.request

BANK = os.environ.get("BANK_URL", "http://bank.example")


def call(method, path, body=None, key=None):
    """One request to the bank: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BANK + path, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(req, timeout=float(os.environ.get("TOOL_TIMEOUT", "30"))) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError):
        return None


def disbursed(application_id):
    """The first disbursement the bank holds for this application, or None."""
    r = call("GET", f"/v1/applications/{application_id}/disbursements")
    return (r[1] or [None])[0] if r and r[0] == 200 else None


def get_application(application_id):
    r = call("GET", f"/v1/applications/{application_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such application"


def disburse_loan(application_id, send_to=""):
    """send_to is ignored on purpose: the money goes to the application's verified account."""
    r = call("GET", f"/v1/applications/{application_id}")
    if not r or r[0] != 200:
        return "no such application; nothing was sent"
    app = r[1]
    if app["status"] != "approved":
        return f"the application is {app['status']}, not approved; nothing was sent"
    done = disbursed(application_id)
    if done:
        return f"already disbursed: {json.dumps(done)}"
    body = {"account": app["verified_account"], "amount": app["amount"]}
    for _ in range(2):  # no answer: look whether it landed before trying once more
        sent = call("POST", f"/v1/applications/{application_id}/disbursements", body, key=f"disburse-{application_id}")
        if sent is not None:
            return json.dumps(sent[1])
        done = disbursed(application_id)
        if done:
            return f"disbursed: {json.dumps(done)}"
    return "no answer from the bank; whether it was paid is unknown. A person should check."
