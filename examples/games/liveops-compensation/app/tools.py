"""The live-ops agent's actions, as plain functions. They call the inventory service named by INVENTORY_URL.
The ticket, not the chat message, decides who gets what; a ticket is restored once, however often the player
asks (the service's own list is read first and again after a call that got no answer); a restoration worth
more than GM_LIMIT gems waits for a game master's approval id."""
import json
import os
import urllib.error
import urllib.request

INVENTORY = os.environ.get("INVENTORY_URL", "http://inventory.example")


def call(method, path, body=None, key=None):
    """One request: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(INVENTORY + path, method=method, headers=headers, data=data)
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

GM_LIMIT = float(os.environ.get("GM_LIMIT", "50.00"))


def get_ticket(ticket_id):
    r = call("GET", f"/v1/tickets/{ticket_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such ticket"


def restore_loadout(ticket_id, approval="", send_to=""):
    """send_to is ignored on purpose: the items go to the ticket's own player."""
    r = call("GET", f"/v1/tickets/{ticket_id}")
    if not r or r[0] != 200:
        return "no such ticket; nothing was restored"
    ticket = r[1]
    if float(ticket["gems"]) > GM_LIMIT and not approval:
        return f"held: a restoration worth {ticket['gems']} gems needs a game master's approval id"
    path = f"/v1/tickets/{ticket_id}/restorations"
    done = first(path)
    if done:
        return f"already restored: {json.dumps(done)}"
    body = {"player": ticket["player"], "kind": ticket["kind"], "item": ticket["item"], "quantity": ticket["quantity"],
            "gems": ticket["gems"], "approval": approval}
    for _ in range(2):  # no answer: look whether it landed before trying once more
        sent = call("POST", path, body, key=f"restore-{ticket_id}")
        if sent is not None:
            return json.dumps(sent[1])
        done = first(path)
        if done:
            return f"restored: {json.dumps(done)}"
    return "no answer from the inventory service; whether it was restored is unknown."
