// The fake speech side of a Bookings shop's voice notes, for the contract (runtime.json `speech`): one small HTTP server that plays Meta's media routes (GET /<version>/<media id> gives
// the address of the audio, GET /audio gives its bytes) and Geometer's speech service (POST /stt, a multipart `file`, answers {text, language, confidence}). It records every request.
// The audio is a real Ogg Opus file of the length asked for (modules/voice/standin.ts fakeVoiceNote), so the shop's length rule reads real bytes.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { fakeVoiceNote } from "../../../../modules/voice/standin.ts";

export interface FakeSpeech {
  url: string;
  requests: { method: string; path: string; contentType: string | undefined; bytes: number }[];
  /** What the speech service hears next (default: "hello" in English). */
  transcript: { text: string; language: string | null; confidence: number | null };
  /** The `speech` block for runtime.json. */
  block(): Record<string, unknown>;
  close(): Promise<void>;
}

export async function startFakeSpeech(o: { seconds?: number } = {}): Promise<FakeSpeech> {
  const fake: FakeSpeech = { url: "", requests: [], transcript: { text: "hello", language: "en", confidence: 0.94 }, block: () => ({}), close: async () => undefined };
  const audio = fakeVoiceNote(o.seconds ?? 12);
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      fake.requests.push({ method: req.method ?? "", path, contentType: req.headers["content-type"], bytes: Buffer.concat(chunks).length });
      if (req.method === "GET" && /^\/v\d+\.\d+\/MEDIA\w*$/u.test(path)) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ url: "https://media.stand-in/audio?mid=1", mime_type: "audio/ogg; codecs=opus", file_size: String(audio.length) })); return; }
      if (req.method === "GET" && path === "/audio") { res.writeHead(200, { "content-type": "audio/ogg" }); res.end(Buffer.from(audio)); return; }
      if (req.method === "POST" && path === "/stt") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(fake.transcript)); return; }
      res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fake.block = () => ({ baseUrl: fake.url, media: { lookupBaseUrl: fake.url, downloadBaseUrl: fake.url, downloadHosts: ["media.stand-in"] }, rate: { sttInrPerMinute: 0.6 } });
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}
