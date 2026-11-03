// A panel started on a temporary server folder, and a small browser (cookies, forms, CSRF tokens) to use it with.
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCalendar } from "../../../pathways/bookings/src/adapters/calendar.ts";
import { createFakeMessaging } from "../../../pathways/bookings/src/adapters/messaging.ts";
import { createFakePayments } from "../../../pathways/bookings/src/adapters/payments.ts";
import { fakeClock } from "../../../pathways/bookings/src/clock.ts";
import { startStandins } from "../../../pathways/bookings/standins/server.ts";
import type { RunningStandins } from "../../../pathways/bookings/standins/server.ts";
import type { PanelConfig } from "../config.ts";
import { makeInviteLink, startPanel } from "../server.ts";
import type { RunningPanel } from "../server.ts";
import type { Role } from "../accounts.ts";

export const NOW = Date.parse("2026-11-04T10:00:00+05:30");
export const EXAMPLE = new URL("../../../pathways/bookings/clients/glow-salon.example/", import.meta.url).pathname;
export const CALENDAR_ID = "glowsalon@group.calendar.google.com";
export const SHARE_ADDRESS = "geometer-calendar@geometer-bookings.iam.gserviceaccount.com";
export const PHONE_ID = "100000000000001";
export const PASS = "a long enough passphrase";

export interface Boot {
  panel: RunningPanel;
  config: PanelConfig;
  dir: string;
  logs: string[];
  browser(): Browser;
  invite(role: Role): string;
  /** Make an account through a real invitation and return a signed-in browser. */
  account(handle: string, role: Role, language?: string): Promise<Browser>;
  addShop(id: string, o?: { ownerId?: string; ownerName?: string; ownerRole?: "builder" | "partner"; name?: string }): void;
  status(shop: string, status: unknown): void;
  standins?: RunningStandins;
  close(): Promise<void>;
}

export async function boot(change: Partial<PanelConfig> = {}, o: { standins?: boolean; mode?: "own" | "hosted"; key?: boolean; signing?: boolean } = {}): Promise<Boot> {
  const dir = mkdtempSync(join(tmpdir(), "geo-panel-"));
  const outside = mkdtempSync(join(tmpdir(), "geo-panel-keys-"));
  mkdirSync(join(dir, "shops"), { recursive: true });
  let standins: RunningStandins | undefined;
  if (o.standins) {
    const clock = fakeClock(NOW);
    standins = await startStandins({
      clock, fakes: { payments: createFakePayments(clock), calendar: createFakeCalendar(), messaging: createFakeMessaging(clock) }, razorpayWebhookSecret: "standin-rzp", whatsappAppSecret: "standin-wa",
      phoneNumberId: PHONE_ID, displayPhoneNumber: "+91 90000 11111", verifiedName: "Hosahalli Beauty", calendarId: CALENDAR_ID,
    }, { port: 0 });
  }
  const dataKeyFile = o.key || o.mode === "hosted" ? join(outside, "data.key") : undefined;
  if (dataKeyFile) { writeFileSync(dataKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 }); chmodSync(dataKeyFile, 0o600); }
  let signingKeyFile: string | undefined;
  if (o.signing) {
    signingKeyFile = join(outside, "report-key.pem");
    writeFileSync(signingKeyFile, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(signingKeyFile, 0o600);
  }
  const config: PanelConfig = {
    serverDir: dir, mode: o.mode ?? "own", host: "127.0.0.1", port: 0, trustProxy: false, pathwaysDir: new URL("../../../pathways/", import.meta.url).pathname, staleMinutes: 30, now: () => NOW,
    calendarShareAddress: SHARE_ADDRESS, ...(dataKeyFile ? { dataKeyFile } : {}), ...(signingKeyFile ? { signingKeyFile } : {}),
    ...(standins ? { guardUrl: standins.url } : {}), ...change,
  };
  const logs: string[] = [];
  const panel = await startPanel(config, { log: (l) => logs.push(l) });
  const boot: Boot = {
    panel, config, dir, logs, standins,
    browser: () => new Browser(panel.url),
    invite(role) { return makeInviteLink({ ...config, port: panel.port }, role, "test"); },
    async account(handle, role, language = "en") {
      const b = new Browser(panel.url);
      const link = boot.invite(role);
      const path = new URL(link).pathname;
      const page = await b.get(path);
      const token = tokenOf(page.text);
      const done = await b.req("POST", "/join", { _csrf: token, token: path.slice("/join/".length), name: handle.toUpperCase(), handle, passphrase: PASS, language });
      if (done.status !== 303) throw new Error(`could not make ${handle}: ${done.status} ${done.text.slice(0, 200)}`);
      return b;
    },
    addShop(id, s = {}) {
      const shop = join(dir, "shops", id);
      mkdirSync(shop, { recursive: true });
      cpSync(join(EXAMPLE, "settings.json"), join(shop, "settings.json"));
      cpSync(join(EXAMPLE, "pathway.lock"), join(shop, "pathway.lock"));
      writeFileSync(join(shop, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { payments: {}, calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_ID }, timeoutMs: 20000 } }));
      if (s.name) {
        const settings = JSON.parse(readFileSync(join(shop, "settings.json"), "utf8"));
        settings.name = s.name;
        writeFileSync(join(shop, "settings.json"), JSON.stringify(settings));
      }
      if (s.ownerId) writeFileSync(join(shop, "owner.json"), JSON.stringify({ schema: 1, accountId: s.ownerId, accountName: s.ownerName ?? "Divya", role: s.ownerRole ?? "partner", createdAt: "2026-11-01T10:00:00Z", template: "bookings" }));
    },
    status(shop, status) {
      mkdirSync(join(dir, "status"), { recursive: true });
      writeFileSync(join(dir, "status", `${shop}.json`), typeof status === "string" ? status : JSON.stringify(status));
    },
    async close() { await panel.close(); await standins?.close(); },
  };
  return boot;
}

export const tokenOf = (text: string): string => {
  const m = /name="_csrf" value="([^"]+)"/u.exec(text);
  if (!m) throw new Error(`no form token on the page: ${text.slice(0, 300)}`);
  return m[1];
};

export interface Reply { status: number; text: string; headers: Headers; location?: string; cookies: string[] }

export class Browser {
  jar = new Map<string, string>();
  base: string;
  headers: Record<string, string> = {};
  constructor(base: string) { this.base = base; }
  async req(method: "GET" | "POST", path: string, form?: Record<string, string>, extra: Record<string, string> = {}): Promise<Reply> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.base + path, {
      method, redirect: "manual",
      headers: { ...(cookie ? { cookie } : {}), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...this.headers, ...extra },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
    const cookies = res.headers.getSetCookie();
    for (const c of cookies) {
      const [pair, ...attrs] = c.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      if (attrs.some((a) => /^\s*Max-Age=0\s*$/iu.test(a))) this.jar.delete(name); else this.jar.set(name, pair.slice(eq + 1).trim());
    }
    return { status: res.status, text: await res.text(), headers: res.headers, location: res.headers.get("location") ?? undefined, cookies };
  }
  get(path: string, extra: Record<string, string> = {}) { return this.req("GET", path, undefined, extra); }
  /** POST a form carrying the token found on `from` (a page of this panel that has a form). */
  async post(path: string, form: Record<string, string>, from: string = path): Promise<Reply> {
    const token = tokenOf((await this.get(from)).text);
    return this.req("POST", path, { _csrf: token, ...form });
  }
}
