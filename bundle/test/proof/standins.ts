// What the proof's Guards call instead of the internet: the pathway's Razorpay, WhatsApp and Calendar stand-ins on 8790, plus (8791) a Google token endpoint
// and a model endpoint. Test money, practice messages, a made-up model. Run in a container on the egress network by test/proof/run.ts.
import { createServer } from "node:http";
import { startStandins } from "../../../templates/commerce/bookings/standins/server.ts";

const stand = await startStandins({ razorpayWebhookSecret: "standin-razorpay-webhook-secret", whatsappAppSecret: "standin-whatsapp-app-secret" }, { port: 8790, host: "0.0.0.0" });
let tokens = 0; const modelCalls: string[] = [];
createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === "/oauth2/token") return send(200, { access_token: `ya29.proof-token-${++tokens}-0123456789`, expires_in: 3599, token_type: "Bearer" });
    if (req.url === "/v1/chat/completions") { modelCalls.push(String((JSON.parse(Buffer.concat(chunks).toString() || "{}") as { model?: string }).model)); return send(200, { choices: [{ message: { content: "{}" } }] }); }
    if (req.url === "/_state") return send(200, { tokens, modelCalls });
    send(404, {});
  });
}).listen(8791, "0.0.0.0");
console.log(`stand-ins on ${stand.port} and 8791`);
