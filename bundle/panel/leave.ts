// What the panel knows about an owner leaving with their shop (block S, 18 Nov 2026): that the owner asked for their file, that the owner asked for another Operator, and, for
// the server's admin, the shops where that ask has waited too long (decision 17: an Operator who goes quiet cannot keep a shop). Read only from the shop's exported record and the
// deployer's status file (bundle/lib/owner-file.ts); nothing here asks the shop's runtime, builds a file or moves a shop. The Operator can see the asks and cannot stop either.
//
// "Stranded" is the rule in modules/approvals/leave.ts: an ask for another Operator that is older than STRANDED_DAYS, with no handover started or finished since it. A handover the
// Operator started (waiting for the owner's code) pauses the clock: the owner is on their way out, and the owner's own code is the last step. If the code never comes, the owner
// asks again and the ask is new.
import { fileTaken, latestAsk, operatorAskOpen, stranded, STRANDED_DAYS } from "../../modules/approvals/leave.ts";
import type { Ask } from "../../modules/approvals/leave.ts";
import { readLeaveStatus } from "../lib/owner-file.ts";
import { readExport } from "./activity.ts";
import type { Handover } from "./handover.ts";
import type { Shops } from "./shops.ts";

export interface LeaveView {
  file?: { askedAt: string; state: "asked" | "ready" | "taken" | "expired" | "problem"; until?: string; problem?: string };
  operator?: { askedAt: string; handover: "none" | "waiting" | "expired"; daysLeft: number; stranded: boolean };
}
export interface StrandedShop { shop: string; name: string; askedAt: string; operator: string }

const DAY = 86_400_000;

export function createLeave(serverDir: string, shops: Shops, handover: Handover, now: () => number) {
  /** The two asks of one shop, or undefined when the owner has asked for neither. */
  function view(shop: string): LeaveView | undefined {
    const entries = readExport(shops.paths.exports(shop))?.entries ?? [];
    const out: LeaveView = {};
    const file = latestAsk(entries, "file");
    if (file) {
      const s = readLeaveStatus(serverDir, shop)?.file;
      const mine = s?.ask === file.id ? s : undefined;
      out.file = fileTaken(entries, file.id) ? { askedAt: file.at, state: "taken" }
        : mine ? { askedAt: file.at, state: mine.state, ...(mine.expiresAt ? { until: mine.expiresAt } : {}), ...(mine.problem ? { problem: mine.problem } : {}) }
          : { askedAt: file.at, state: "asked" };
    }
    const op = latestAsk(entries, "operator");
    const moves = shops.assignment(shop)?.history ?? [];
    const lastMove = moves.length > 0 ? moves[moves.length - 1].at : undefined;
    if (operatorAskOpen(op, lastMove)) {
      const state = handover.check(shop);
      const started = state.state === "waiting" || state.state === "expired" ? state.move.requestedAt : undefined;
      const n = now();
      out.operator = { askedAt: op.at, handover: state.state === "waiting" ? "waiting" : state.state === "expired" ? "expired" : "none", daysLeft: Math.max(0, Math.ceil(STRANDED_DAYS - (n - Date.parse(op.at)) / DAY)), stranded: stranded(op, lastMove, started, n) };
    }
    return out.file || out.operator ? out : undefined;
  }

  return {
    view,
    /** Every shop on this server whose owner is stranded, for the admin's page, oldest ask first. */
    stranded(): StrandedShop[] {
      const list: StrandedShop[] = [];
      for (const id of shops.ids()) {
        const v = view(id);
        if (v?.operator?.stranded) list.push({ shop: id, name: shops.settings(id)?.name ?? id, askedAt: v.operator.askedAt, operator: shops.servedBy(id)?.accountName ?? "" });
      }
      return list.sort((a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt));
    },
  };
}
export type Leave = ReturnType<typeof createLeave>;
export type { Ask };
