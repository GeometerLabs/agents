// "Leave with your shop" (block S, 18 Nov 2026; owner: "no operator should hold a shop hostage"): the two things an owner can ask for without their Operator's help or
// approval, and the one place that says how those asks look in the record. Pure: no disk, no clock, nothing that reads another shop. The runtime (the assistant's
// conversation) writes the two asks into the shop's own record; the panel and the deployer read them back from the exported record (the same lane as a handover's "move CODE").
//
//   owner_file_asked        "Get my shop's file": the owner wants their shop's package. The server side that can read the shop's files builds it with the OWNER profile
//                           (bundle/export/build.ts) and hands it to the shop's own runtime for the owner's session to take once (bundle/lib/owner-file.ts).
//   owner_file_taken        the owner's session took the file (the runtime writes it), so the server can delete its copy.
//   operator_change_asked   "Change my Operator": the owner wants another Operator. The current Operator's panel shows it at once; the existing handover (modules/approvals/
//                           handover.ts: the Operator names the target, the owner texts `move CODE`) finishes it, and the owner still confirms. If nothing happens for
//                           STRANDED_DAYS, Geometer's admin sees the shop as stranded (decision 17), so an Operator who goes quiet cannot keep a shop.
//
// Every ask carries `refs.ask` (a short id), `refs.via` ("whatsapp" or "page": a page ask came through the owner's app, link or session) and, for the file, nothing else.
// An ask is the owner's own words and nothing is done on it by itself: a file is only built, a move still needs the owner's `move CODE`.
import { randomBytes } from "node:crypto";

export const FILE_ASKED = "owner_file_asked";
export const FILE_TAKEN = "owner_file_taken";
export const OPERATOR_ASKED = "operator_change_asked";

/** How long the owner has to take the file once it is ready. After this the server's copy is deleted and a new ask makes a new one. */
export const FILE_HOURS = 72;
/** How long the current Operator has to start the handover before Geometer's admin is shown the shop as stranded. */
export const STRANDED_DAYS = 14;
/** The same kind of ask is taken once in this long, so a phone or a page cannot flood the record. */
export const ASK_AGAIN_MS = 60 * 60_000;

export type AskKind = "file" | "operator";
export const ACTION_OF: Record<AskKind, string> = { file: FILE_ASKED, operator: OPERATOR_ASKED };

/** A short id for one ask: the file made for it carries the same id. */
export const newAskId = (): string => `ask_${randomBytes(6).toString("hex")}`;
export const ASK_ID = /^ask_[0-9a-f]{12}$/u;

/** The few fields of a record entry an ask is read from (the runtime's entries and the exported record's both have them). */
export interface AskEntry { time: string; action: string; outcome: string; refs?: Readonly<Record<string, string>> }
export interface Ask { id: string; at: string; via: "whatsapp" | "page" }

/** The latest ask of a kind in the record, or undefined. Only a confirmed entry with a well-formed id counts. */
export function latestAsk(entries: readonly AskEntry[], kind: AskKind): Ask | undefined {
  let found: Ask | undefined;
  for (const e of entries) {
    if (e.action !== ACTION_OF[kind] || e.outcome !== "confirmed") continue;
    const id = e.refs?.ask;
    if (id === undefined || !ASK_ID.test(id) || !Number.isFinite(Date.parse(e.time))) continue;
    if (!found || Date.parse(e.time) >= Date.parse(found.at)) found = { id, at: e.time, via: e.refs?.via === "page" ? "page" : "whatsapp" };
  }
  return found;
}

/** Did the owner's session take the file made for this ask? */
export const fileTaken = (entries: readonly AskEntry[], askId: string): boolean => entries.some((e) => e.action === FILE_TAKEN && e.outcome === "confirmed" && e.refs?.ask === askId);

/** May the owner ask this kind again now? Not within ASK_AGAIN_MS of the last one (the owner is told it is already on its way). */
export const mayAskAgain = (entries: readonly AskEntry[], kind: AskKind, nowMs: number): boolean => {
  const last = latestAsk(entries, kind);
  return !last || nowMs - Date.parse(last.at) >= ASK_AGAIN_MS;
};

/**
 * Is an "operator change" ask still open? It is closed by a handover that finished after it (the assignment's newest move is later than the ask). `lastMoveAt` is the
 * time of the shop's newest move in assignment.json (the panel passes it), or undefined when the shop has never moved.
 */
export const operatorAskOpen = (ask: Ask | undefined, lastMoveAt: string | undefined): ask is Ask => ask !== undefined && (lastMoveAt === undefined || Date.parse(lastMoveAt) < Date.parse(ask.at));

/** The stranded rule (decision 17): an open ask older than STRANDED_DAYS, with no handover started or finished since, is Geometer's to see. */
export const stranded = (ask: Ask | undefined, lastMoveAt: string | undefined, handoverStartedAt: string | undefined, nowMs: number): boolean =>
  operatorAskOpen(ask, lastMoveAt) && nowMs - Date.parse(ask.at) >= STRANDED_DAYS * 86_400_000 && (handoverStartedAt === undefined || Date.parse(handoverStartedAt) < Date.parse(ask.at));
