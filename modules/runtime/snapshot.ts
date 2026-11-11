// An agent's store as one piece of JSON, and back, the same way for every template. Maps and Sets are written as lists in their own order, because an agent
// depends on that order (Bookings looks from the newest booking back, Fees walks a parent's fees oldest first, and a tick walks them all oldest first). The counters
// are saved too, so a step that runs again after a restart registers the same "b-3" or "f-3" and finds its own payment link.
//
// A template says which fields its store has (a list, in the order they are written). EVERY field of the store that must survive a restart has to be in that list: the
// runtime builds a fresh store from the last saved snapshot for each step, so a field that is not saved is lost at once. (Fees' `startedAtMs` is one: without it every
// tick would believe the agent had only just started, and no month would ever be chased.) A test per template (test/runtime.test.ts) saves a store with every field set
// and reads it back.
import type { AiState } from "../understanding/ai-state.ts";

export type SnapshotField =
  | { name: string; kind: "map" | "set" }
  /** A whole number counter that is always there. */
  | { name: string; kind: "count" }
  /** A whole number that is left out until it is first set. */
  | { name: string; kind: "optional-number" }
  /** The month's AI counts: left out until the first message, and a snapshot written before they existed still loads. */
  | { name: string; kind: "optional-ai" }
  /** A plain JSON object that is left out until it is first set (a UPI shop's ledger), so a snapshot written before it existed still loads, and one without it is unchanged. */
  | { name: string; kind: "optional-object" };

export interface SnapshotCodec<S> {
  serialize(store: S): string;
  /** A fresh store from saved JSON. Never shares anything with the store it was saved from. */
  parse(json: string): S;
  /** The saved JSON with every `count` field (the id counters: nextBooking, nextDue, ...) moved on by `gap`. Used once after a restore (restored.ts). */
  skipCounters(json: string, gap: number): string;
  /**
   * The saved JSON with every `count` field at least where `taken` has it: `taken` is the store of a step that was thrown away and will not run again (core.ts, endTask).
   * The ids that step gave out may already name a calendar hold or a payment link at a provider, so they are never given out again (B75, 11 Nov 2026).
   */
  keepCounters(json: string, taken: string): string;
}

/** `format` is the number written first; change it only with a migration, because a runtime refuses a snapshot it cannot read. */
export function snapshotCodec<S extends object>(format: number, fields: readonly SnapshotField[]): SnapshotCodec<S> {
  return {
    serialize(store) {
      const out: Record<string, unknown> = { format };
      const get = store as Record<string, unknown>;
      for (const f of fields) {
        const value = get[f.name];
        if (f.kind === "map" || f.kind === "set") out[f.name] = [...(value as Iterable<unknown>)];
        else if (f.kind === "count") out[f.name] = value;
        else if (f.kind === "optional-number") { if (typeof value === "number") out[f.name] = value; } else if (value) out[f.name] = value;
      }
      return JSON.stringify(out);
    },

    parse(json) {
      const raw = JSON.parse(json) as Record<string, unknown>;
      const unreadable = () => new Error("The saved state is not in a format this version can read. It was probably written by another version of the pathway.");
      if (raw.format !== format) throw unreadable();
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const value = raw[f.name];
        if (f.kind === "map" || f.kind === "set") {
          if (!Array.isArray(value)) throw unreadable();
          out[f.name] = f.kind === "map" ? new Map(value as []) : new Set(value as []);
        } else if (f.kind === "count") {
          if (!Number.isInteger(value)) throw unreadable();
          out[f.name] = value;
        } else if (f.kind === "optional-number") {
          if (typeof value === "number" && Number.isFinite(value)) out[f.name] = value;
        } else if (value && typeof value === "object") out[f.name] = value as AiState;
      }
      return out as S;
    },

    skipCounters(json, gap) {
      const raw = JSON.parse(json) as Record<string, unknown>;
      for (const f of fields) if (f.kind === "count" && Number.isInteger(raw[f.name])) raw[f.name] = (raw[f.name] as number) + gap;
      return JSON.stringify(raw);
    },

    keepCounters(json, taken) {
      const raw = JSON.parse(json) as Record<string, unknown>;
      const other = JSON.parse(taken) as Record<string, unknown>;
      let moved = false;
      for (const f of fields) {
        if (f.kind !== "count" || !Number.isInteger(raw[f.name]) || !Number.isInteger(other[f.name]) || (other[f.name] as number) <= (raw[f.name] as number)) continue;
        raw[f.name] = other[f.name];
        moved = true;
      }
      return moved ? JSON.stringify(raw) : json; // unchanged text when nothing moved, so a quiet end writes nothing new
    },
  };
}
