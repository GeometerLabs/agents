// What each tap in the demo does: the actions (say, pay, time, cancel, owner, reset, shop) with their checks, in one place.
// The local-network server (app.ts) and the browser build (web/local.ts) both call this, so the two cannot drift apart.
// Nothing here knows about HTTP, cookies, the network or the page: it takes a body and gives back a status and a JSON value.
import { settingsFromForm } from "./personalise.ts";
import { MAX_MESSAGE_LENGTH, createDemo } from "./session.ts";
import type { Demo, OwnerCommand } from "./session.ts";
import { buildState } from "./view.ts";
import type { Settings } from "../src/settings.ts";
import { localParts, zonedToMs } from "../src/time.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** The shop everyone using one demo sees. The shop form replaces it and raises `version`, so every open page starts again on its next request. */
export interface Shop { settings: Settings; version: number }
/** One visitor's world, and the shop version it was built for. */
export interface Seat { demo: Demo; shopVersion: number }
export interface ActionResult { status: 200 | 422; json: unknown }

/**
 * Where the fake clock starts for a new world. Default: today's real date at 10:00 in the shop's time zone, so "tomorrow" is the real
 * tomorrow and every suggestion is still ahead (starting at the real time of day would put an evening demo's "tomorrow 6pm" inside the
 * 24-hour window). A number or a function pins it, for tests.
 */
export function demoStart(timezone: string, nowMs?: number | (() => number)): number {
  if (typeof nowMs === "function") return nowMs();
  if (nowMs !== undefined) return nowMs;
  return zonedToMs(localParts(Date.now(), timezone), { hour: 10, minute: 0 }, timezone);
}

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/**
 * Run one action for one visitor. Each action runs after the ones before it in the same world finish (the agent has no locking).
 * Throws HttpError for a request the demo refuses; a shop form with mistakes gives status 422 and the plain-words errors.
 */
export async function runAction(pathname: string, body: Record<string, unknown>, seat: Seat, shop: Shop, startMs: () => number): Promise<ActionResult> {
  let notice: string | undefined;
  switch (pathname) {
    case "/api/say": {
      const message = text(body.text, MAX_MESSAGE_LENGTH + 1);
      if (message === "") throw new HttpError(400, "Write a message first.");
      if (message.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Keep it under ${MAX_MESSAGE_LENGTH} characters.`);
      notice = await seat.demo.run(() => seat.demo.say(message));
      break;
    }
    case "/api/pay": {
      if (body.times !== 1 && body.times !== 2) throw new HttpError(400, "Pay once or twice.");
      const times = body.times;
      notice = await seat.demo.run(() => seat.demo.pay(times));
      break;
    }
    case "/api/time": {
      if (body.minutes !== 15 && body.minutes !== 60 && body.minutes !== 1440) throw new HttpError(400, "Choose 15 minutes, 1 hour or 1 day.");
      const minutes = body.minutes;
      notice = await seat.demo.run(() => seat.demo.advance(minutes));
      break;
    }
    case "/api/cancel":
      notice = await seat.demo.run(() => seat.demo.cancel());
      break;
    case "/api/owner": {
      const command = body.command;
      const ref = text(body.ref, 12);
      if ((command !== "approve" && command !== "deny" && command !== "retry") || !/^b-\d{1,6}$/.test(ref)) throw new HttpError(400, "Choose approve, deny or retry for a booking.");
      notice = await seat.demo.run(() => seat.demo.owner(command as OwnerCommand, ref));
      break;
    }
    case "/api/reset":
      seat.demo = createDemo(shop.settings, startMs());
      seat.shopVersion = shop.version;
      break;
    case "/api/shop": {
      const result = settingsFromForm(body.form, shop.settings);
      if (!result.ok) return { status: 422, json: { errors: result.errors } };
      shop.settings = result.settings;
      shop.version += 1;
      seat.demo = createDemo(shop.settings, startMs());
      seat.shopVersion = shop.version;
      notice = seat.demo.ui.rebuilt;
      break;
    }
    default:
      throw new HttpError(404, "Nothing here.");
  }
  return { status: 200, json: buildState(seat.demo, notice) };
}
