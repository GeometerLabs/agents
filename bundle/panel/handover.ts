// Moving a shop to another partner or builder (plan B38), with the owner's agreement and the reason recorded.
//
// The steps. Whoever serves the shop (or a builder on the server) says who gets it and why. The panel makes a one-use code, shows it once, and keeps its hash with the request
// (72 hours). The owner sends "move CODE" to the shop's WhatsApp number from their own number; the agent writes a `handover_agreed` entry in the record (modules/approvals/handover.ts).
// When the panel finds that entry in the shop's exported record, from the owner's number (as the export writes it: a fingerprint under the shop's key), after the request and before it ran out, it writes
// assignment.json and the move is done. Until then nothing has moved. A request can be cancelled, and a new one replaces an expired one.
//
// What moves: who can see and change the shop in the panel, and the name on the owner's monthly report (assignment.json, read by the panel and by the deployer).
// What does not: the shop's WhatsApp, payment and calendar accounts are the shop's own; no key is carried across (the secrets inbox is write-only and never read back, and the
// shop's own settings and runtime.json are not rewritten here), so whoever serves the shop now enters them again. Never to Geometer.
import { personLabel } from "../../modules/record/fingerprint.ts";
import { HANDOVER_ACTION, handoverHash, newHandoverCode } from "../../modules/approvals/handover.ts";
import type { Account, Accounts } from "./accounts.ts";
import { readExport } from "./activity.ts";
import { HANDOVER_REASONS, companyOf } from "./contract.ts";
import type { AssignmentFile, HandoverReason, Person } from "./contract.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";

/** How long the owner has to send the code. */
export const HANDOVER_HOURS = 72;

export interface PendingMove {
  schema: 1;
  id: string;
  shop: string;
  from: Person;
  to: Person;
  reason: HandoverReason;
  requestedBy: { id: string; name: string };
  codeHash: string;
  requestedAt: string;
  expiresAt: string;
}

export type StartProblem = "who" | "same" | "geometer" | "reason" | "waiting";
export type MoveState =
  | { state: "none" }
  | { state: "waiting"; move: PendingMove }
  | { state: "expired"; move: PendingMove }
  | { state: "done"; assignment: AssignmentFile };

/** An account called (or named) like Geometer, or a server's own service name, is not somewhere a shop can go: "never to Geometer directly". */
const GEOMETER_LIKE = /geometer|fleet|^server$|^system$|^admin$/iu;

export function createHandover(shops: Shops, accounts: Accounts, store: Store, now: () => number) {
  const key = (shop: string) => `handover/${shop}.json`;
  const iso = (ms: number) => new Date(ms).toISOString();
  const read = (shop: string) => store.read<PendingMove>(key(shop));

  /** The owner's agreement in the shop's exported record, if it is there for this request. */
  function agreement(move: PendingMove): { at: string } | undefined {
    const settings = shops.settings(move.shop);
    const data = readExport(shops.paths.exports(move.shop));
    const personKey = shops.personKey(move.shop); // B69: no key on this server yet (the next deploy gives it): the move waits, nothing is decided without it
    if (!settings || !data || !personKey) return undefined;
    const owner = personLabel(personKey, "c", settings.owner.whatsapp);
    const from = Date.parse(move.requestedAt);
    const until = Date.parse(move.expiresAt);
    const hit = data.entries.find((e) => {
      const at = Date.parse(e.time);
      return e.action === HANDOVER_ACTION && e.outcome === "confirmed" && e.conversation === owner && e.refs?.handover === move.codeHash && at >= from && at <= until;
    });
    return hit ? { at: hit.time } : undefined;
  }

  const api = {
    reasons: HANDOVER_REASONS,

    /** The state of the shop's move. Looking is also how a move completes: if the owner's agreement is in the record, the shop is moved now. */
    check(shop: string): MoveState {
      const move = read(shop);
      if (!move) return { state: "none" };
      const found = agreement(move);
      if (found) {
        // the shop may have moved already (or its server changed) since this was asked: the move is only made from the person it was asked from
        const served = shops.servedBy(shop);
        if (!served || served.accountId !== move.from.accountId) { store.remove(key(shop)); return { state: "none" }; }
        const assignment = shops.assign(shop, move.to, move.reason, { at: found.at, codeHash: move.codeHash });
        store.remove(key(shop));
        return { state: "done", assignment };
      }
      return now() > Date.parse(move.expiresAt) ? { state: "expired", move } : { state: "waiting", move };
    },

    /** Ask for a move. The code comes back once and is not kept. */
    start(shop: string, by: Account, input: { to: string; reason: string }): { ok: true; code: string; move: PendingMove } | { ok: false; problem: StartProblem } {
      const state = api.check(shop);
      if (state.state === "waiting") return { ok: false, problem: "waiting" };
      if (!(HANDOVER_REASONS as readonly string[]).includes(input.reason)) return { ok: false, problem: "reason" };
      const target = accounts.byHandle(input.to);
      if (!target) return { ok: false, problem: "who" };
      if (GEOMETER_LIKE.test(target.handle) || GEOMETER_LIKE.test(target.name)) return { ok: false, problem: "geometer" };
      const served = shops.servedBy(shop);
      if (!served) return { ok: false, problem: "who" };
      if (target.id === served.accountId) return { ok: false, problem: "same" };
      const code = newHandoverCode();
      const at = now();
      const move: PendingMove = {
        schema: 1, id: `mv_${at.toString(36)}`, shop, requestedBy: { id: by.id, name: by.name }, reason: input.reason as HandoverReason,
        from: { accountId: served.accountId, accountName: served.accountName, ...(served.company ? { company: served.company } : {}), role: served.role },
        to: { accountId: target.id, accountName: target.name, ...(companyOf(target.company) ? { company: companyOf(target.company) as string } : {}), role: target.role },
        codeHash: handoverHash(code), requestedAt: iso(at), expiresAt: iso(at + HANDOVER_HOURS * 3_600_000),
      };
      store.write(key(shop), move);
      return { ok: true, code, move };
    },

    cancel(shop: string): void { store.remove(key(shop)); },

    /** Look at every shop with a move waiting, so a move whose agreement has arrived is made even if nobody opens its page. */
    sweep(): void {
      for (const file of store.list("handover")) {
        const shop = file.replace(/\.json$/u, "");
        if (shops.exists(shop)) api.check(shop);
      }
    },
  };
  return api;
}
export type Handover = ReturnType<typeof createHandover>;
