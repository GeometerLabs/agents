"""A small in-memory copy of the service, on a local port, so the tools' real HTTP calls can be tested.
Records come from fixtures.json here, a copy of ../.geometer/fixtures.json (the records Geometer's simulated
service uses); the copy is kept so the tests run on their own, wherever the folder is copied.
GET /v1/<collection>/<id> returns a record; POST /v1/<collection>/<id>/<what> stores a body and GET of the
same path lists what was stored. `svc.drop["reply"] = True` makes the next POSTs take effect but never answer."""
import json
import os
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace

import pytest

os.environ.setdefault("OPENAI_API_KEY", "test-key")  # the clients want one; no model is called

FIXTURES = json.loads((pathlib.Path(__file__).parent / "fixtures.json").read_text())["collections"]


@pytest.fixture
def svc():
    posts, stored, drop = [], {}, {"reply": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body):
            self.send_response(code)
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def do_GET(self):
            parts = self.path.strip("/").split("/")  # v1, collection, id[, what]
            if len(parts) == 4:
                return self.reply(200, stored.get(self.path, []))
            records = {r["id"]: r for r in FIXTURES.get(parts[1], [])}
            self.reply(200, records[parts[2]]) if parts[2] in records else self.reply(404, None)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
            posts.append(body)
            stored.setdefault(self.path, []).append(body)
            if drop["reply"]:
                return self.connection.close()
            self.reply(201, body)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield SimpleNamespace(url=f"http://127.0.0.1:{server.server_port}", posts=posts, drop=drop)
    server.shutdown()
