// The shops on the server, as files. This is the only place the panel touches shops/, status/, requests/ and exports/. It writes desired state
// (settings.json, runtime.json, pathway.lock, owner.json, pins.json) and a stop request; it reads the deployer's results and each runtime's /status.
// Who may see a shop is decided here, in one function, and every page and every action goes through it: a builder sees every shop on the server, a
// partner only the shops whose owner.json names them, and a shop that is not yours looks exactly like a shop that does not exist.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { canonicalJson } from "../../modules/record/record.ts";
import { parseKey } from "../../modules/record/key-file.ts";
import { parseLock, pathwayVersion } from "../../templates/commerce/bookings/server/config.ts";
import { PATHWAY } from "../../templates/commerce/bookings/server/runtime.ts";
import { kindFor } from "../lib/kinds.ts";
import type { Account } from "./accounts.ts";
import { runtimeTokenFileFor, runtimeUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { SHOP_ID, companyOf, parseAssignmentFile, parseFleetAnswer, parseOwner, parseReportFile, parseStatus, parseStopRequest, resolvePreparedBy, servedByOf, serverPaths } from "./contract.ts";
import type { AssignmentFile, FleetAnswer, HandoverReason, OwnerFile, Person, PinsFile, RuntimeProbe, SecretName, StatusRead, StopRequest } from "./contract.ts";
import type { Store } from "./store.ts";

/** What the panel itself remembers about a shop that is not in the shop's folder. The secrets themselves are never here: only that they arrived. */
export interface ShopMeta {
  schema: 1;
  expectedBookings?: number;
  whatsapp?: { businessNumber: string };
  /** B71: the gateway the shop chose (its provider id), the key's mode and its id (public, not the secret). Left out for a shop with none. */
  gateway?: { provider: string; mode: "live" | "test"; keyId: string };
  calendar?: { shareAddress?: string };
  receipts: Partial<Record<SecretName, string>>;
  readyAt?: string;
  /** What the person said when they confirmed go-live through a one-time link: written down as their statement, not as something checked. */
  goLiveStatement?: { at: string; by: string; whatsappTemplatesSeenApproved: boolean; keysHandedInThroughGuard: boolean };
}

export interface ShopRef { id: string; owner: OwnerFile | undefined }

const iso = (ms: number) => new Date(ms).toISOString();

// The shops layer: the only code that touches shops/, status/ and requests/, and the one place that decides who may see which shop, so a missed check on one page cannot expose a shop.
export function createShops(config: PanelConfig, store: Store) {
  const paths = serverPaths(config.serverDir);
  const now = () => (config.now ?? Date.now)();
  const safe = (id: string): string => { if (!SHOP_ID.test(id)) throw new Error("not a shop id"); return id; };
  const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };
  const writeAtomic = (file: string, content: string, mode = 0o644) => {
    mkdirSync(join(file, ".."), { recursive: true });
    const tmp = join(file, "..", `.${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, file);
  };

  const api = {
    paths,
    /** Every shop folder, by id. */
    ids(): string[] {
      if (!existsSync(paths.shops)) return [];
      return readdirSync(paths.shops, { withFileTypes: true }).filter((e) => e.isDirectory() && SHOP_ID.test(e.name)).map((e) => e.name).sort();
    },
    /** Who set the shop up (owner.json, written once). It never changes; who SERVES the shop now is `servedBy`. */
    owner(id: string): OwnerFile | undefined { return parseOwner(readText(join(paths.shop(safe(id)), "owner.json"))); },
    /** Who moved the shop to someone else, if anyone has (assignment.json, written only by a handover). */
    assignment(id: string): AssignmentFile | undefined { return parseAssignmentFile(readText(join(paths.shop(safe(id)), "assignment.json"))); },
    /** Who serves the shop now, in the shape of owner.json: the latest handover's new person, else the one who set it up. A partner sees a shop only while this names them. */
    servedBy(id: string): OwnerFile | undefined { return servedByOf(api.owner(id), api.assignment(id)); },
    /** Who the owner's monthly report says set the shop up ("Divya, local partner"): a handover's new person, else the shop's report.json, else the attribution. The deployer reads the same three files. */
    preparedBy(id: string): string | undefined {
      const report = parseReportFile(readText(join(paths.shop(safe(id)), "report.json")));
      const owner = api.owner(id);
      const assignment = api.assignment(id);
      return resolvePreparedBy({ ...(report ? { report } : {}), ...(owner ? { owner } : {}), ...(assignment ? { assignment } : {}) })?.name;
    },
    /** The shops this person may see. */
    visibleTo(account: Account): ShopRef[] {
      const all = api.ids().map((id) => ({ id, owner: api.servedBy(id) }));
      return account.role === "builder" ? all : all.filter((s) => s.owner?.accountId === account.id);
    },
    /** The one rule. A shop the account cannot see is undefined: callers answer 404, never 403. */
    find(account: Account, id: string): ShopRef | undefined {
      if (!SHOP_ID.test(id) || !existsSync(paths.shop(id))) return undefined;
      const owner = api.servedBy(id);
      return account.role === "builder" || owner?.accountId === account.id ? { id, owner } : undefined;
    },
    /**
     * Move the shop to someone else: assignment.json is written (atomically) with the new person and the move added to its history. Nothing else changes: owner.json stays, the shop's
     * accounts and keys are not touched (a key is never carried across), and the next deploy puts the new name on the owner's monthly report.
     */
    assign(id: string, to: Person, reason: HandoverReason, agreed: { at: string; codeHash: string }): AssignmentFile {
      const before = api.assignment(id);
      const served = api.servedBy(id);
      if (!served) throw new Error("This shop has nobody it is served by, so there is nobody to move it from.");
      const from: Person = { accountId: served.accountId, accountName: served.accountName, ...(served.company ? { company: served.company } : {}), role: served.role };
      const at = iso(now());
      const next: AssignmentFile = { schema: 1, current: { ...to, since: at }, history: [...(before?.history ?? []), { at, from, to, reason, ownerAgreed: agreed }] };
      writeAtomic(join(paths.shop(safe(id)), "assignment.json"), `${JSON.stringify(next, null, 2)}\n`);
      return next;
    },
    exists: (id: string) => SHOP_ID.test(id) && existsSync(paths.shop(id)),
    /** The shop's fingerprint key (B69): what matches a person's number to the record's fingerprints. Undefined when the server has not given it to the panel yet (the next deploy or export does). */
    personKey(id: string): Buffer | undefined {
      const dir = config.personKeysDir;
      if (!dir || !SHOP_ID.test(id)) return undefined;
      const text = readText(join(dir, id));
      try { return text ? parseKey(text, `The fingerprint key of ${id}`) : undefined; } catch { return undefined; }
    },

    /** The shop's settings, judged by the template its lock names (Bookings when there is no lock yet), in that template's own shape. */
    settings(id: string): any | undefined {
      const text = readText(join(paths.shop(safe(id)), "settings.json"));
      if (text === undefined) return undefined;
      const kind = kindFor(api.lock(id)?.split("@")[0]) ?? kindFor("bookings")!;
      try { const r = kind.validateSettings(JSON.parse(text)); return r.ok ? r.settings : undefined; } catch { return undefined; }
    },
    /** Which template a shop is, from its lock: "bookings", "fees" or "orders" (lib/kinds.ts). Bookings when the lock is missing or names one this panel does not know. */
    kind(id: string): string { return kindFor(api.lock(id)?.split("@")[0])?.id ?? "bookings"; },
    runtime(id: string): Record<string, any> | undefined {
      try { return JSON.parse(readText(join(paths.shop(safe(id)), "runtime.json")) ?? "null") ?? undefined; } catch { return undefined; }
    },
    /** The shop's pin as it is on disk (`bookings@0.1.0`), or undefined when there is none. */
    lock(id: string): string | undefined { const text = readText(join(paths.shop(safe(id)), "pathway.lock")); return text?.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#")); },
    pins(id: string): PinsFile | undefined {
      try { const p = JSON.parse(readText(join(paths.shop(safe(id)), "pins.json")) ?? "null") as PinsFile | null; return p?.schema === 1 ? p : undefined; } catch { return undefined; }
    },
    status(id: string): StatusRead { return parseStatus(readText(paths.statusFile(safe(id)))); },
    /** Fleet's last answer about the shop (written by ops), or undefined when it has said nothing readable. */
    fleet(id: string): FleetAnswer | undefined { return parseFleetAnswer(readText(paths.fleetFile(safe(id)))); },
    stopRequest(id: string): StopRequest | undefined { return parseStopRequest(readText(paths.stopFile(safe(id)))); },
    meta(id: string): ShopMeta { return store.read<ShopMeta>(`meta/${safe(id)}.json`) ?? { schema: 1, receipts: {} }; },
    saveMeta(id: string, meta: ShopMeta): void { store.write(`meta/${safe(id)}.json`, meta); },

    /** Is the folder one the deployer and the runtime will accept? The deployer adds the Guard addresses; here stand-in ones stand in for them. */
    checkFolder(settings: any, runtime: Record<string, unknown>, lock: string, keptPin = false, building: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): string[] {
      const problems: string[] = [];
      const kind = kindFor(building.pathway) ?? kindFor("bookings")!;
      const s = (runtime.services ?? {}) as Record<string, Record<string, unknown>>;
      const stand = (o: Record<string, unknown> | undefined) => ({ baseUrl: "http://guard.invalid", ...(o ?? {}) });
      // only the services the template has: a Fees runtime.json that names a calendar is refused by its own check
      const withGuards = { ...runtime, services: { ...s, payments: stand(s.payments), ...(kind.guards.includes("calendar") ? { calendar: stand(s.calendar) } : {}), messaging: stand(s.messaging) },
        ...(runtime.parser ? { parser: { baseUrl: "http://guard.invalid", ...(runtime.parser as object) } } : {}) };
      const r = kind.validateRuntimeConfig(withGuards, "/tmp");
      if (!r.ok) problems.push(...(r.errors ?? []));
      // a shop that already has a pin keeps it (`geometer update` moves it, after the hand check on its own settings): only its template has to be this one
      try { const l = parseLock(lock); if (l.pathway !== building.pathway || (!keptPin && l.version !== building.version)) problems.push(`pathway.lock says ${l.pathway}@${l.version} but this panel builds ${building.pathway}@${building.version}.`); } catch (e) { problems.push((e as Error).message); }
      if (!kind.validateSettings(settings).ok) problems.push("the settings do not pass their own check");
      return problems;
    },

    /** Write the shop's desired state. owner.json is written once and never again (flag wx), so the first account to set a shop up stays its attribution. */
    writeFolder(id: string, parts: { settings: unknown; runtime: Record<string, unknown>; lock: string; pins?: PinsFile }, creator?: { account: Account; template: string }, by?: Account): void {
      const dir = paths.shop(safe(id));
      // A new shop's folder is made without `recursive`, so a folder that is already there (another shop with this name) is an error, never shared.
      if (creator) { mkdirSync(paths.shops, { recursive: true }); mkdirSync(dir); } else mkdirSync(dir, { recursive: true });
      writeAtomic(join(dir, "settings.json"), `${JSON.stringify(parts.settings, null, 2)}\n`);
      api.recordSettings(id, parts.settings, creator?.account ?? by);
      writeAtomic(join(dir, "runtime.json"), `${JSON.stringify(parts.runtime, null, 2)}\n`);
      writeAtomic(join(dir, "pathway.lock"), `${parts.lock}\n`);
      if (parts.pins) writeAtomic(join(dir, "pins.json"), `${JSON.stringify(parts.pins, null, 2)}\n`);
      if (creator) {
        const owner: OwnerFile = { schema: 1, accountId: creator.account.id, accountName: creator.account.name, ...(companyOf(creator.account.company) ? { company: companyOf(creator.account.company) as string } : {}), role: creator.account.role, createdAt: iso(now()), template: creator.template };
        try { writeFileSync(join(dir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx", mode: 0o644 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
    },

    /**
     * Keep this version of the settings, with who saved it, in shops/<shop>/settings-history.jsonl (one line each; B38's export carries it as the limits' history). A version
     * the same as the last one is not written twice. It starts the first time a shop is saved after this was added: nothing is made up for earlier versions.
     */
    recordSettings(id: string, settings: unknown, who?: Account): void {
      const file = join(paths.shop(safe(id)), "settings-history.jsonl");
      const digest = createHash("sha256").update(canonicalJson(settings)).digest("hex");
      const last = (readText(file) ?? "").trim().split("\n").filter((l) => l !== "").at(-1);
      try { if (last && (JSON.parse(last) as { digest?: string }).digest === digest) return; } catch { /* an unreadable last line is not a reason to lose this version */ }
      appendFileSync(file, `${JSON.stringify({ schema: 1, at: iso(now()), by: who ? { id: who.id, name: who.name, role: who.role } : null, digest, settings })}\n`, { mode: 0o644 });
    },

    /** Only the pins: what the providers reported. Settings, runtime and lock are not rewritten, so the deployer sees no change it did not need. */
    writePins(id: string, pins: PinsFile): void { writeAtomic(join(paths.shop(safe(id)), "pins.json"), `${JSON.stringify(pins, null, 2)}\n`); },
    writeRuntime(id: string, runtime: Record<string, unknown>): void { writeAtomic(join(paths.shop(safe(id)), "runtime.json"), `${JSON.stringify(runtime, null, 2)}\n`); },

    /** Ask the server to stop this shop. The panel does not stop anything itself: it writes the request, and only the deployer's status can say it happened. */
    requestStop(id: string, account: Account): StopRequest {
      const existing = api.stopRequest(id);
      if (existing) return existing;
      const request: StopRequest = { schema: 1, requestId: `stop_${randomBytes(8).toString("hex")}`, shop: safe(id), requestedAt: iso(now()), requestedBy: { id: account.id, name: account.name, role: account.role } };
      writeAtomic(paths.stopFile(id), `${JSON.stringify(request, null, 2)}\n`);
      return request;
    },

    /**
     * Ask the shop's agent to look again or ask again about one booking or fee: the panel writes requests/<shop>.recover.<id>.json (a name and an id, nothing else), and the deployer carries it
     * to the shop's runtime, which holds the token the panel never has. The agent does it through Guard and the normal limits (modules/unfinished). The deployer removes the file when done.
     */
    requestRecovery(id: string, caseId: string, action: string, account: Account): { requestId: string } {
      const requestId = randomBytes(8).toString("hex");
      writeAtomic(paths.recoverFile(safe(id), requestId), `${JSON.stringify({ schema: 1, requestId, shop: id, case: caseId, action, requestedAt: iso(now()), requestedBy: { id: account.id, name: account.name, role: account.role } }, null, 2)}\n`);
      return { requestId };
    },

    /** Ask the runtime itself. Counts only (its /status never holds message text). Not configured, or not answering, is said as such. */
    async probeRuntime(id: string): Promise<{ probe: RuntimeProbe | undefined; counts: Record<string, any> | undefined }> {
      const base = runtimeUrlFor(config, safe(id));
      if (!base) return { probe: undefined, counts: undefined };
      const tokenFile = runtimeTokenFileFor(config, id);
      try {
        const ready = await fetch(`${base}/readyz`, { signal: AbortSignal.timeout(3000) });
        const readyBody = (await ready.json().catch(() => ({}))) as { ok?: boolean };
        let counts: Record<string, any> | undefined;
        if (tokenFile) {
          const token = readText(tokenFile)?.trim();
          if (token) {
            const r = await fetch(`${base}/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
            if (r.ok) counts = (await r.json()) as Record<string, any>;
          }
        }
        return { probe: { reachable: true, ready: readyBody.ok === true, refundsNeedBuilder: Number(counts?.refunds?.needBuilder?.total ?? 0) }, counts };
      } catch {
        return { probe: { reachable: false }, counts: undefined };
      }
    },
  };
  return api;
}

export type Shops = ReturnType<typeof createShops>;
