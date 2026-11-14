// Found by item 11i's design pass in headless Chromium: under "Referrer-Policy: no-referrer" a browser posts every form with `Origin: null` (the Fetch standard),
// so the front's Origin check refused a real browser's booking, cancel, "I have paid", the owner's answers and the sign-in with 403. The pages now send their
// origin only ("strict-origin"): a Referer never carries a page's address (a booking's handle, the owner's link), and the Origin check is as strict as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PAGE_REFERRER, frontHandler } from "../front.ts";
import { ownerPage } from "../owner-page.ts";
import type { ChannelBackend, Offer, OwnerView } from "../backend.ts";

const OFFER: Offer = { shop: { name: "Glow Salon", timezone: "Asia/Kolkata", languages: ["en"], deposit: { amountInr: 200, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Glow Salon" }, paused: false }, services: [] };
const VIEW: OwnerView = { shop: { name: "Glow Salon", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [] };

test("the pages send their origin only, never their address; a form posted with Origin: null (or another site's) is still refused", async () => {
  assert.equal(PAGE_REFERRER, "strict-origin", "not no-referrer: under it a browser posts every form with Origin: null");
  const backend = { offer: async () => OFFER, submit: async () => "saved", view: async () => null, owner: async () => VIEW } as unknown as ChannelBackend;
  const server = createServer(frontHandler({ shops: { glow: { publicUrl: "https://partners.example/s/glow", backend } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/s/glow`;
  try {
    const page = await fetch(`${base}/?lang=en`);
    assert.equal(page.headers.get("referrer-policy"), "strict-origin");
    const owner = await fetch(`${base}/o/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456?lang=en`);
    assert.equal(owner.headers.get("referrer-policy"), "strict-origin");
    assert.ok((await owner.text()).includes('<meta name="referrer" content="strict-origin">'));
    for (const origin of ["null", "https://elsewhere.example"]) {
      const r = await fetch(`${base}/book`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: "service=haircut&start=1&name=Asha&phone=9811111111&lang=en" });
      assert.equal(r.status, 403, `Origin: ${origin}`);
    }
  } finally { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); }
  assert.ok(!ownerPage({ base: "https://pages.example/glow/o/x", language: "en", view: VIEW, relayAsks: [] }).includes("no-referrer"));
});
