// The world a parts-shop situation runs in (decision 65): ONE shop of several template parts on its own Go program (go/cmd/parts), on the shop's own settings, in front of the
// stand-in WhatsApp (its wire format over the in-memory fake, knowing the union of the parts' templates, src/whatsapp.ts) on the hand check's clock. The shared part is modules/crash-test/go-world.ts; what is the
// parts shop's own is here: the shop's saved state read part by part, the record read part by part (refs.part), the owner's page, and the owner's Stock page.
import { readFileSync } from "node:fs";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { openGoWorld } from "../../../../modules/crash-test/go-world.ts";
import type { GoWorldBase } from "../../../../modules/crash-test/go-world.ts";
import type { Answer } from "../../../../modules/crash-test/go-shop.ts";
import { serveHandlers } from "../../../../modules/standins/http.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import type { TemplateCatalogue } from "../../../../modules/standins/whatsapp.ts";
import { partsMetaTemplates } from "../src/whatsapp.ts";
import { isPartName } from "../src/settings.ts";

/** The program the hand check runs (go/cmd/parts), and the template version it serves (pathway.lock). */
export const PROGRAM = "parts";
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A parts shop's settings as the file has them (the parts' blocks are each its template's own). */
export type PartsFile = { owner: { whatsapp: string; language: string }; timezone?: string; parts: Record<string, Record<string, unknown>>; [key: string]: unknown };

export interface PartsWorld extends GoWorldBase<PartsFile, Record<string, unknown>> {
  /** The record's lines a part wrote (refs.part), or the router's own ("parts"). */
  linesOf(part: string): any[];
  /** A part's saved members (the snapshot's parts.<name>), or undefined before its first save. */
  partState(part: string): Record<string, unknown> | undefined;
  /** The shop's one stock count (the assistant's `stock`), or undefined. */
  stock(): { lines: { id: string; count: number; aliases?: string[]; lowFlag?: boolean }[] } | undefined;
  /** GET /internal/channel/owner with the owner's link. */
  ownerPage(): Promise<Answer>;
  /** POST the owner's Stock page op, then wait until it is handled. */
  stockOp(op: Record<string, unknown>): Promise<Answer>;
  /** The code of the newest card the owner was sent ("reply yes K7X2"). */
  cardCode(): string;
}

export async function createPartsWorld(settings: PartsFile, o: { nowMs?: number } = {}): Promise<PartsWorld> {
  const tz = settings.timezone ?? "Asia/Kolkata";
  const catalogue = { templates: partsMetaTemplates(Object.keys(settings.parts).filter(isPartName), { assistant: settings.assistant !== undefined }) } as TemplateCatalogue;
  const base = await openGoWorld<PartsFile, Record<string, unknown>>({
    program: PROGRAM, version: VERSION, settings, at: o.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, tz), customer: "+919844444444",
    parseStore: (json) => JSON.parse(json) as Record<string, unknown>, emptyStore: () => ({}), parseSettings: (raw) => raw as PartsFile, settingsFile: (s) => s as Record<string, unknown>,
    gateway: false,
    // the stand-in knows the shop's number's templates, the union of its parts' (src/whatsapp.ts), and the provider has approved them all
    standins: async (_clock, fakes) => { approveTemplates(fakes.messaging, catalogue); return serveHandlers([whatsappStandin(fakes.messaging, catalogue, { phoneNumberId: "100000000000001" })]); },
  });
  let ops = 0;
  const world: PartsWorld = Object.assign(base, {
    linesOf: (part: string) => base.record.entries().filter((e) => (e.refs?.part ?? "") === part),
    partState: (part: string) => ((base.store as { parts?: Record<string, Record<string, unknown>> }).parts ?? {})[part],
    stock: () => (base.store as { assistant?: { stock?: any } }).assistant?.stock,
    ownerPage: () => base.shop.call("/internal/channel/owner", { owner: base.shop.owner }),
    async stockOp(op: Record<string, unknown>) {
      const a = await base.shop.call("/internal/channel/owner-stock", { owner: base.shop.owner, body: { id: `stock-${++ops}`, op } });
      if (a.status === 200) await base.shop.settle();
      return a;
    },
    cardCode() {
      for (const t of base.messaging.sentTo(base.owner).map((m) => m.text).reverse()) { const m = /\byes ([A-Z0-9]{4,6})\b/u.exec(t); if (m) return m[1]; }
      throw new Error("No card was sent to the owner.");
    },
  });
  return world;
}
