// The shop character on WhatsApp (item 11i): a sticker by its link inside the 24-hour window only, and the morning template's image header, on each provider exactly
// as its documented contract says (read 14 Nov 2026: Meta's sticker-messages and template-media pages, Gupshup's self-serve sticker and image-template pages,
// Gupshup's partner pages) and nothing more. Gupshup's partner API documents a sticker only by an uploaded media id, so that adapter has no sticker at all.
// Against the fake, the Cloud API stand-in, and a stub of the Guard in front of each service. Nothing here touches a real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { ApiError, WindowClosedError } from "../../core/faults.ts";
import type { Http, HttpReply } from "../../core/http.ts";
import { createFakeMessaging, stickerProblem } from "../messaging.ts";
import { createCloudApiMessaging, describeMetaError, stickerBody, templateBody } from "../whatsapp.ts";
import { createGupshupMessaging } from "../gupshup.ts";
import { stickerForm, templateForm } from "../gupshup-selfserve.ts";
import { whatsappStandin } from "../../standins/whatsapp.ts";

const OWNER = "+919800000009";
const STICKER = "https://pages.example/glow-salon/character/needs.webp?v=0123456789abcdef";
const PNG = "https://pages.example/glow-salon/character/needs.png?v=0123456789abcdef";

/** A stub of the Guard in front of a Cloud API service: keeps each request and answers with a message id. */
function stubHttp(): { http: Http; seen: { method: string; path: string; body: unknown }[] } {
  const seen: { method: string; path: string; body: unknown }[] = [];
  return { seen, http: { async request(method, path, o): Promise<HttpReply> { seen.push({ method, path, body: o?.body }); return { status: 200, body: { messages: [{ id: `wamid.${seen.length}` }] } }; } } };
}

test("a sticker is a .webp link over https; the fake takes one only inside the window", async () => {
  assert.equal(stickerProblem({ link: STICKER }), null);
  for (const bad of ["http://pages.example/a.webp", "https://pages.example/a.png", "https://pages example/a.webp"]) assert.notEqual(stickerProblem({ link: bad }), null, bad);
  const m = createFakeMessaging(fakeClock(0));
  await assert.rejects(m.sendSticker(OWNER, { link: STICKER }), WindowClosedError);
  m.receive(OWNER, "hi");
  await assert.rejects(m.sendSticker(OWNER, { link: "https://x.example/a.png" }), ApiError);
  const sent = await m.sendSticker(OWNER, { link: STICKER });
  assert.deepEqual([sent.kind, sent.sticker?.link], ["sticker", STICKER]);
});

test("Meta: the sticker body is Meta's (type sticker, a link), only inside the window; the template's image header is the first component", async () => {
  assert.deepEqual(stickerBody(OWNER, { link: STICKER }), { messaging_product: "whatsapp", recipient_type: "individual", to: OWNER, type: "sticker", sticker: { link: STICKER } });
  assert.deepEqual(templateBody(OWNER, { name: "owner_morning", language: "en", text: "t", parameters: ["Mithra", "Glow"], headerImage: PNG }).template, {
    name: "owner_morning", language: { code: "en" },
    components: [{ type: "header", parameters: [{ type: "image", image: { link: PNG } }] }, { type: "body", parameters: [{ type: "text", text: "Mithra" }, { type: "text", text: "Glow" }] }],
  });
  assert.equal((templateBody(OWNER, { name: "x", language: "en", text: "t" }).template as { components?: unknown }).components, undefined, "a template with neither keeps no components");
  let last: number | undefined;
  const { http, seen } = stubHttp();
  const meta = createCloudApiMessaging(http, { name: "WhatsApp", sendPath: "/v26.0/1/messages", pingPath: "/v26.0/1", describeError: describeMetaError, stickerByLink: true }, { clock: fakeClock(10), window: { lastInboundAt: () => last } });
  await assert.rejects(meta.sendSticker!(OWNER, { link: STICKER }), WindowClosedError);
  assert.equal(seen.length, 0, "outside the window nothing is asked");
  last = 0;
  const s = await meta.sendSticker!(OWNER, { link: STICKER });
  assert.deepEqual(seen[0].body, stickerBody(OWNER, { link: STICKER }));
  assert.equal((await meta.getMessage(s.id))?.kind, "sticker");
  const t = await meta.sendTemplate(OWNER, { name: "owner_morning", language: "en", text: "t", parameters: [], headerImage: PNG });
  assert.equal((await meta.getMessage(t.id))?.headerImage, PNG);
  await assert.rejects(meta.sendTemplate(OWNER, { name: "owner_morning", language: "en", text: "t", headerImage: "http://x/a.png" }), ApiError);
});

test("Gupshup's partner pass-through has no sticker (its page documents only an uploaded id); its templates are Meta's bodies, the image header included (above)", () => {
  const g = createGupshupMessaging({ baseUrl: "http://guard.invalid", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }, { clock: fakeClock(0), window: { lastInboundAt: () => 0 } });
  assert.equal(g.sendSticker, undefined);
});

test("Gupshup self-serve: a sticker is message={type: sticker, url}; an image header is message={type: image, image: {link}} beside the template's id", () => {
  const c = { appName: "Glow_Salon", sourceNumber: "919876543210" };
  const s = stickerForm(c, OWNER, { link: STICKER });
  assert.deepEqual(JSON.parse(s.message), { type: "sticker", url: STICKER });
  assert.deepEqual([s.channel, s.source, s.destination, s["src.name"]], ["whatsapp", "919876543210", "919800000009", "Glow_Salon"]);
  const t = templateForm(c, OWNER, "tpl-1", ["Mithra"], PNG);
  assert.deepEqual(JSON.parse(t.template), { id: "tpl-1", params: ["Mithra"] });
  assert.deepEqual(JSON.parse(t.message!), { type: "image", image: { link: PNG } });
  assert.equal(templateForm(c, OWNER, "tpl-1", []).message, undefined, "no header, no message field");
});

test("the Cloud API stand-in: a sticker by link inside the window; a template made with an image header must carry one picture, and one made without cannot", async () => {
  const m = createFakeMessaging(fakeClock(0));
  m.approve("owner_morning", "en");
  m.approve("booking_day_open", "en");
  const standin = whatsappStandin(m, { templates: [{ name: "owner_morning", header: "image", bodies: { en: "Good morning from {name}.", hi: "", ml: "", kn: "" } }, { name: "booking_day_open", bodies: { en: "Open on {date}.", hi: "", ml: "", kn: "" } }] });
  const post = (body: unknown) => standin({ method: "POST", path: "/v26.0/100000000000001/messages", query: new URLSearchParams(), headers: {}, body });
  const closed = await post(stickerBody(OWNER, { link: STICKER }));
  assert.equal((closed?.body as { error: { code: number } }).error.code, 131047, "outside the window: Meta's 131047");
  m.receive(OWNER, "hi");
  assert.equal((await post(stickerBody(OWNER, { link: STICKER })))?.status, 200);
  assert.equal(m.outbox().at(-1)?.sticker?.link, STICKER);
  const withHeader = await post(templateBody(OWNER, { name: "owner_morning", language: "en", text: "", parameters: ["Mithra"], headerImage: PNG }));
  assert.equal(withHeader?.status, 200);
  assert.deepEqual([m.outbox().at(-1)?.text, m.outbox().at(-1)?.headerImage], ["Good morning from Mithra.", PNG]);
  const missing = await post(templateBody(OWNER, { name: "owner_morning", language: "en", text: "", parameters: ["Mithra"] }));
  assert.equal((missing?.body as { error: { code: number } }).error.code, 132012, "made with an image header, sent without");
  const extra = await post(templateBody(OWNER, { name: "booking_day_open", language: "en", text: "", parameters: ["Mon"], headerImage: PNG }));
  assert.equal((extra?.body as { error: { code: number } }).error.code, 132012, "made without, sent with");
});
