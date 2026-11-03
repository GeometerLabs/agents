// The five setup steps as a partner on a phone does them, shared by the tests that need a shop to exist.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_ID, PHONE_ID } from "./helpers.ts";
import type { Boot, Browser } from "./helpers.ts";

export const M = {
  token: `EAAMARKERTOKEN${"x".repeat(40)}`, app: "0a1b2c3d4e5f60718a1b2c3d4e5f6071", secret: "MARKERrzpSECRET123456789", hook: "MARKERwebhook-secret-1",
  json: JSON.stringify({ type: "service_account", client_email: "shop-calendar@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nMARKERPRIVATEKEYBODY\n-----END PRIVATE KEY-----\n" }),
};
export const MARKERS = ["MARKERTOKEN", "MARKERrzp", "MARKERwebhook", "MARKERPRIVATEKEY", M.app];

export const STEP1 = { name: "Hosahalli Beauty", svc_name_0: "Haircut", svc_also_0: "hair cut, cutting", svc_price_0: "450", svc_minutes_0: "45", svc_name_1: "Facial", svc_price_1: "900", svc_minutes_1: "60", opens: "10:00", closes: "20:00", day_1: "on", day_2: "on", day_3: "on", day_4: "on", day_5: "on", day_6: "on" };
export const STEP2 = { deposit: "200", window: "24" };
export const STEP3 = { primary: "ml", lang_en: "on", ownerLanguage: "ml", ownerNumber: "98765 43210" };
export const STEP4 = { waNumber: "+91 90000 11111", waNumberId: PHONE_ID, waToken: M.token, waAppSecret: M.app, calId: CALENDAR_ID, rzpMode: "live", rzpKeyId: "rzp_live_AbCdEf123456", rzpKeySecret: M.secret, rzpWebhook: M.hook };

export interface Flow { draft: string; shop: string; replies: string[] }

/** The five steps as a partner on a phone does them. Every reply is kept, so a test can look for what must never appear. */
export async function setUp(b: Boot, who: Browser, steps: Record<string, string>[] = [STEP1, STEP2, STEP3, STEP4]): Promise<Flow> {
  const replies: string[] = [];
  const start = await who.post("/setup", { template: "bookings" }, "/setup");
  const draft = start.location!.split("/")[2];
  for (const [i, form] of steps.entries()) {
    const path = `/setup/${draft}/${i + 1}`;
    const page = await who.get(path);
    replies.push(page.text);
    const r = await who.post(path, form, path);
    replies.push(r.text);
    assert.equal(r.status, 303, `step ${i + 1}: ${r.text.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").slice(0, 400)}`);
  }
  const shop = JSON.parse(readFileSync(join(b.dir, "panel", "data", "drafts", `${draft}.json`), "utf8")).shopId as string;
  return { draft, shop, replies };
}

