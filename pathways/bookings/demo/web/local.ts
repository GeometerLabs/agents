// The demo's "server", inside the page: the same actions (demo/api.ts) and the same screen state (demo/view.ts) as the local-network
// demo, run against the real agent on the in-memory stand-ins. No network, no sign-in, nothing saved. One shop and one world per call.
//
// It has no page code in it, so a test (or a later "Try to break it" game) can drive it with no browser.
import { HttpError, demoStart, runAction } from "../api.ts";
import type { ActionResult, Seat, Shop } from "../api.ts";
import { applyLanguage } from "../personalise.ts";
import { createDemo } from "../session.ts";
import { buildState } from "../view.ts";
import { glowSalon } from "../../src/harness.ts";
import type { Settings } from "../../src/settings.ts";

export interface LocalDemoOptions {
  /** The shop the demo starts with. Default: Glow Salon, the example shop. */
  settings?: Settings;
  /** A language code from LANGUAGES to start in (the shop form can change it). */
  language?: string;
  /** Where the fake clock starts. Default: the morning of today's real date, shop time (see demoStart). A number or a function pins it. */
  nowMs?: number | (() => number);
}

/** What the page's script sees of a `fetch` answer. */
export interface LocalResponse { ok: boolean; json(): Promise<unknown> }

export interface LocalDemo {
  /** The paths of the local-network demo: GET /api/state, then POST /api/say, /tap, /pay, /time, /cancel, /owner, /reset, /shop with a JSON body. */
  request(path: string, body?: unknown): Promise<ActionResult | { status: number; json: unknown }>;
  /** The same, shaped like `fetch`, which is what the page's script calls. */
  fetch(path: string, init?: { method?: string; body?: string }): Promise<LocalResponse>;
}

export function createLocalDemo(options: LocalDemoOptions = {}): LocalDemo {
  let settings = options.settings ?? glowSalon();
  if (options.language !== undefined) {
    const applied = applyLanguage(settings, options.language);
    if (!applied.ok) throw new Error(applied.errors.join(" "));
    settings = applied.settings;
  }
  const shop: Shop = { settings, version: 1 };
  const startMs = () => demoStart(shop.settings.timezone, options.nowMs);
  const seat: Seat = { demo: createDemo(shop.settings, startMs()), shopVersion: shop.version };

  async function request(path: string, body?: unknown) {
    try {
      if (body === undefined) {
        if (path !== "/api/state") throw new HttpError(404, "Nothing here.");
        return { status: 200, json: buildState(seat.demo) };
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
      return await runAction(path, body as Record<string, unknown>, seat, shop, startMs);
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, json: { error: e.message } };
      return { status: 500, json: { error: "The demo hit a problem. Press Start again." } };
    }
  }

  return {
    request,
    async fetch(path, init) {
      let body: unknown;
      if (init?.body !== undefined) {
        try { body = JSON.parse(init.body); } catch { return { ok: false, json: async () => ({ error: "That was not valid JSON." }) }; }
      }
      const answer = await request(path, body);
      return { ok: answer.status < 300, json: async () => answer.json };
    },
  };
}
