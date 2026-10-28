"""The game director's actions, as plain functions. They call the world service named by WORLD_URL. Each world
event is answered once (the service's own list is read first and again after a call that got no answer); a
spawn of more than SPAWN_LIMIT units waits for a game master's approval id; a shop price outside
[MIN_PRICE, MAX_PRICE] gems is refused."""
import json
import os
import urllib.error
import urllib.request

WORLD = os.environ.get("WORLD_URL", "http://world.example")


def call(method, path, body=None, key=None):
    """One request: (status, json), or None when no answer came."""
    headers = {"Content-Type": "application/json", **({"Idempotency-Key": key} if key else {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(WORLD + path, method=method, headers=headers, data=data)
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

SPAWN_LIMIT = int(os.environ.get("SPAWN_LIMIT", "100"))
MIN_PRICE = float(os.environ.get("MIN_PRICE", "1.00"))
MAX_PRICE = float(os.environ.get("MAX_PRICE", "1000.00"))


def get_event(event_id):
    r = call("GET", f"/v1/events/{event_id}")
    return json.dumps(r[1]) if r and r[0] == 200 else "no such event"


def once(path, body, key):
    """Make one change per event: look first, and after a call with no answer look again before saying anything."""
    done = first(path)
    if done:
        return f"already applied: {json.dumps(done)}"
    sent = call("POST", path, body, key=key)
    if sent is None:
        done = first(path)
        return f"applied: {json.dumps(done)}" if done else "no answer from the world; whether it was applied is unknown."
    return json.dumps(sent[1])


def spawn_resource(event_id, resource, count, approval=""):
    if count < 1:
        return "refused: a spawn must be at least 1 unit"
    if count > SPAWN_LIMIT and not approval:
        return f"held: a spawn of {count} units needs a game master's approval id"
    body = {"resource": resource, "count": count, "approval": approval}
    return once(f"/v1/events/{event_id}/spawns", body, f"spawn-{event_id}")


def set_price(event_id, item, price):
    try:
        gems = float(price)
    except (TypeError, ValueError):
        return f"refused: {price!r} is not a price"
    if not MIN_PRICE <= gems <= MAX_PRICE:
        return f"refused: a price of {gems:.2f} gems is outside {MIN_PRICE:.2f} to {MAX_PRICE:.2f}"
    return once(f"/v1/events/{event_id}/prices", {"item": item, "price": f"{gems:.2f}"}, f"price-{event_id}")
