// The heartbeat's panel address (plan item 14b, part 2a): the account page's "Open panel" link comes from `panel_url` in the heartbeat. It is sent only in the
// shape fleet takes (fleet refuses a whole heartbeat for one field it does not take), and only by a server with a panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeartbeat, panelUrlForFleet } from "../services/heartbeat.ts";
import { opsConfig } from "../generate/configs.ts";
import { serverConfig } from "./helpers.ts";

test("only the panel's https address alone is sent; anything fleet would refuse is left out", () => {
  for (const ok of ["https://shops.example.com", "https://shops.example.com:8443", "https://localhost:8443"]) assert.equal(panelUrlForFleet(ok), ok);
  for (const bad of [undefined, "", "http://shops.example.com", "https://shops.example.com/", "https://shops.example.com/panel", "https://203.0.113.7", "https://a@b.com", `https://${"a".repeat(200)}.com`]) assert.equal(panelUrlForFleet(bad), undefined, String(bad));
  const at = new Date("2026-11-11T10:00:00Z");
  const sent = buildHeartbeat({ deploymentId: "ravi-abcdef", bundleVersion: "0.1.0", panelUrl: "https://shops.example.com", now: at, shops: [], baseline: {} }).body;
  assert.equal(sent.panel_url, "https://shops.example.com");
  assert.equal("panel_url" in buildHeartbeat({ deploymentId: "ravi-abcdef", bundleVersion: "0.1.0", panelUrl: "http://shops.example.com", now: at, shops: [], baseline: {} }).body, false);
  assert.equal("panel_url" in buildHeartbeat({ deploymentId: "ravi-abcdef", bundleVersion: "0.1.0", now: at, shops: [], baseline: {} }).body, false, "an older ops config: as before");
});

test("ops is told the panel's address only on a server with a panel", () => {
  assert.equal(JSON.parse(opsConfig(serverConfig({ panel: { enabled: true } }), [])).panelUrl, "https://shops.example.com");
  assert.equal(JSON.parse(opsConfig(serverConfig({ panel: { enabled: true }, ports: { http: 8080, https: 8443 } }), [])).panelUrl, "https://shops.example.com:8443");
  assert.equal(JSON.parse(opsConfig(serverConfig(), [])).panelUrl, undefined);
});
