// One-time confirmations asked for from outside the panel (the Claude Code plugin, plan B11). A request is only ever CREATED on the command line (`main.ts
// confirm-link`); it does nothing until a signed-in person opens its link and presses the button in the panel. The token is kept only as a sha256, the link works
// once, runs out in two hours and is tied to the shop and to the settings as they were when it was asked for.
//
// What a person can confirm here is deliberately small:
//   limits   a change that makes limits tighter or leaves them (bundle/lib/limits-draft.ts). Anything that loosens a limit, or is not on that list, is refused
//            here as well, whatever was written into this file: a person loosens a limit in the panel's own edit form, never through a link.
//   go-live  "ready to go live": the same hand check, connection checks and certificate as the panel's own button, plus the person's statement about the WhatsApp templates.
import { gatewayOf } from "../../modules/payments/providers/index.ts";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guardsOf, kindFor } from "../lib/kinds.ts";
import { TIGHTEN_ONLY, applyChanges, judgeChanges, refusalText, settingsDigest } from "../lib/limits-draft.ts";
import type { Change, ChangeRow } from "../lib/limits-draft.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";

export type ConfirmKind = "limits" | "go-live";
export interface Confirmation {
  id: string; tokenHash: string; kind: ConfirmKind; shop: string;
  /** The shop's settings as they were when this was asked for. */
  digest: string;
  changes?: Change[];
  note: string;
  createdAt: string; expiresAt: string;
  usedAt?: string; usedBy?: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{16,80}$/u;
const TTL_MS = 2 * 3_600_000;

// The one-time link store: only a sha256 of the token is kept, a link works once and ends after two hours, and it is tied to the settings it was asked for. `now` is injectable for tests.
export function createConfirmations(store: Store, now: () => number = Date.now) {
  const load = () => store.read<{ schema: 1; items: Confirmation[] }>("confirmations.json")?.items ?? [];
  const save = (items: Confirmation[]) => store.write("confirmations.json", { schema: 1, items });
  const find = (token: string) => { const h = sha256(token); return load().find((c) => c.tokenHash === h); };
  return {
    /** The token comes back once and is never kept: only its sha256 is. */
    create(o: { kind: ConfirmKind; shop: string; digest: string; changes?: Change[]; note?: string }): { token: string; confirmation: Confirmation } {
      const token = randomBytes(24).toString("base64url");
      const confirmation: Confirmation = { id: `cf_${randomBytes(6).toString("hex")}`, tokenHash: sha256(token), kind: o.kind, shop: o.shop, digest: o.digest, ...(o.changes ? { changes: o.changes } : {}), note: (o.note ?? "").slice(0, 200),
        createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + TTL_MS).toISOString() };
      save([...load().filter((c) => Date.parse(c.expiresAt) > now() - 7 * 86_400_000), confirmation]);
      return { token, confirmation };
    },
    find,
    status(token: string): "ok" | "used" | "expired" | "unknown" {
      const c = find(token);
      if (!c) return "unknown";
      if (c.usedAt) return "used";
      return Date.parse(c.expiresAt) <= now() ? "expired" : "ok";
    },
    /** Spend the link. False when somebody else spent it first. */
    spend(token: string, accountId: string): boolean {
      const c = find(token);
      if (!c || c.usedAt || Date.parse(c.expiresAt) <= now()) return false;
      save(load().map((x) => (x.id === c.id ? { ...x, usedAt: new Date(now()).toISOString(), usedBy: accountId } : x)));
      return true;
    },
  };
}
export type Confirmations = ReturnType<typeof createConfirmations>;

export type LimitsPlan = { ok: true; raw: any; proposed: any; rows: ChangeRow[]; digest: string } | { ok: false; problems: string[] };

/** The shop's settings.json as written (Fees' differs from its checked shape, and what is written is what a builder wrote). */
export function rawSettings(shops: Shops, shop: string): any | undefined {
  try { return JSON.parse(readFileSync(join(shops.paths.shop(shop), "settings.json"), "utf8")); } catch { return undefined; }
}

/**
 * The one check both the command line (before a link is made) and the confirm button (before anything is written) run: the changes put into the settings in force NOW,
 * every difference judged (default-deny), the result checked by the template's own settings check and its Guard limits.
 */
export function planLimits(shops: Shops, shop: string, changes: readonly Change[], expectDigest?: string): LimitsPlan {
  const raw = rawSettings(shops, shop);
  if (!raw) return { ok: false, problems: [`There are no readable settings for ${shop}.`] };
  const digest = settingsDigest(raw);
  if (expectDigest !== undefined && digest !== expectDigest) return { ok: false, problems: ["The settings changed after this was asked for. Ask for the change again from what is there now."] };
  if (changes.length === 0) return { ok: false, problems: ["There is no change to confirm."] };
  const kindId = shops.kind(shop);
  const kind = kindFor(kindId);
  if (!kind || !(kindId in TIGHTEN_ONLY)) return { ok: false, problems: [`The plugin may not change limits of the "${kindId}" template. A person does it in the panel's edit form.`] };
  const applied = applyChanges(raw, changes);
  if (!applied.ok) return { ok: false, problems: [applied.problem] };
  const rows = judgeChanges(kindId, raw, applied.settings);
  if (rows.length === 0) return { ok: false, problems: ["That leaves every limit as it is: nothing to confirm."] };
  const refused = rows.filter((r) => r.verdict !== "tighter");
  if (refused.length > 0) return { ok: false, problems: refused.map(refusalText) };
  const checked = kind.validateSettings(applied.settings);
  if (!checked.ok) return { ok: false, problems: checked.errors };
  if (gatewayOf(checked.settings.payment)) {
    try { kind.gatewaySpec(checked.settings, { tenant: shop, version: 1, reviewedBy: "confirm-check" }, { approvalTtlSeconds: 86_400 }); } catch (e) { return { ok: false, problems: [(e as Error).message] }; }
  }
  return { ok: true, raw, proposed: applied.settings, rows, digest };
}
