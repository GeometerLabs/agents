// Plan item 11i: the owner's talk box records Ogg Opus where the phone can, else WebM Opus (Android's Chrome records only WebM). The front takes either and hands
// the runtime the recording with the type the browser named; anything else is refused before it reaches the runtime. (The runtime's own check and the length
// read from the bytes are in modules/voice/test/webm.test.ts and the Bookings voice-notes tests.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { frontHandler } from "../front.ts";
import type { ChannelBackend, OwnerView } from "../backend.ts";
import { fakeVoiceNote, fakeWebmVoiceNote } from "../../voice/standin.ts";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";
const VIEW: OwnerView = {
  shop: { name: "Glow Salon", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [],
  app: { character: { style: "clay", personality: "warm" }, mood: "quiet", face: "well", closedToday: false, today: [], waiting: [], cards: [], talk: [], listen: true },
};

test("a recording from the owner's page: Ogg or WebM Opus reaches the runtime with its type; any other type is refused with 415 and reaches nothing", async () => {
  const got: { mime: string; bytes: number }[] = [];
  const backend = { offer: async () => { throw new Error("not asked"); }, submit: async () => "saved", view: async () => null, owner: async () => VIEW, ownerVoice: async (_o: unknown, a: { bytes: Buffer; mime: string }) => { got.push({ mime: a.mime, bytes: a.bytes.length }); return "saved"; } } as unknown as ChannelBackend;
  const server = createServer(frontHandler({ shops: { glow: { publicUrl: "https://partners.example/s/glow", backend } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/s/glow/o/${TOKEN}/voice`;
  try {
    const post = (type: string, body: Uint8Array) => fetch(url, { method: "POST", headers: { "content-type": type }, body });
    assert.equal((await post("audio/webm;codecs=opus", fakeWebmVoiceNote(3))).status, 200, "WebM Opus, as Android's Chrome records it");
    assert.equal((await post("audio/ogg;codecs=opus", fakeVoiceNote(3))).status, 200, "Ogg Opus, as before");
    assert.deepEqual(got.map((g) => g.mime), ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"]);
    for (const type of ["audio/mpeg", "audio/mp4", "video/webm", "text/plain", ""]) assert.equal((await post(type, new Uint8Array([1, 2, 3]))).status, 415, type || "no type");
    assert.equal(got.length, 2, "nothing else reached the runtime");
  } finally { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); }
});
