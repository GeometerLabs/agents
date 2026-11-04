// The shops on the server, as files. This is the only place the panel touches shops/, status/, requests/ and exports/. It writes desired state
// (settings.json, runtime.json, pathway.lock, owner.json, pins.json) and a stop request; it reads the deployer's results and each runtime's /status.
// Who may see a shop is decided here, in one function, and every page and every action goes through it: a builder sees every shop on the server, a
// partner only the shops whose owner.json names them, and a shop that is not yours looks exactly like a shop that does not exist.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { validateRuntimeConfig, parseLock, pathwayVersion } from "../../pathways/bookings/server/config.ts";
import { PATHWAY } from "../../pathways/bookings/server/runtime.ts";
import { validateSettings } from "../../pathways/bookings/src/settings.ts";
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import type { Account } from "./accounts.ts";
import { runtimeTokenFileFor, runtimeUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { SHOP_ID, parseOwner, parseStatus, parseStopRequest, serverPaths } from "./contract.ts";
import type { OwnerFile, PinsFile, RuntimeProbe, SecretName, StatusRead, StopRequest } from "./contract.ts";
import type { Store } from "./store.ts";

/** What the panel itself remembers about a shop that is not in the shop's folder. The secrets themselves are never here: only that they arrived. */
export interface ShopMeta {
  schema: 1;
  expectedBookings?: number;
  whatsapp?: { businessNumber: string };
  razorpay?: { mode: "live" | "test"; keyId: string };
  calendar?: { shareAddress?: string };
  receipts: Partial<Record<SecretName, string>>;
  readyAt?: string;
}

export interface ShopRef { id: string; owner: OwnerFile | undefined }

const iso = (ms: number) => new Date(ms).toISOString();

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
    owner(id: string): OwnerFile | undefined { return parseOwner(readText(join(paths.shop(safe(id)), "owner.json"))); },
    /** The shops this person may see. */
    visibleTo(account: Account): ShopRef[] {
      const all = api.ids().map((id) => ({ id, owner: api.owner(id) }));
      return account.role === "builder" ? all : all.filter((s) => s.owner?.accountId === account.id);
    },
    /** The one rule. A shop the account cannot see is undefined: callers answer 404, never 403. */
    find(account: Account, id: string): ShopRef | undefined {
      if (!SHOP_ID.test(id) || !existsSync(paths.shop(id))) return undefined;
      const owner = api.owner(id);
      return account.role === "builder" || owner?.accountId === account.id ? { id, owner } : undefined;
    },
    exists: (id: string) => SHOP_ID.test(id) && existsSync(paths.shop(id)),

    settings(id: string): Settings | undefined {
      const text = readText(join(paths.shop(safe(id)), "settings.json"));
      if (text === undefined) return undefined;
      try { const r = validateSettings(JSON.parse(text)); return r.ok ? r.settings : undefined; } catch { return undefined; }
    },
    runtime(id: string): Record<string, any> | undefined {
      try { return JSON.parse(readText(join(paths.shop(safe(id)), "runtime.json")) ?? "null") ?? undefined; } catch { return undefined; }
    },
    /** The shop's pin as it is on disk (`bookings@0.1.0`), or undefined when there is none. */
    lock(id: string): string | undefined { const text = readText(join(paths.shop(safe(id)), "pathway.lock")); return text?.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#")); },
    pins(id: string): PinsFile | undefined {
      try { const p = JSON.parse(readText(join(paths.shop(safe(id)), "pins.json")) ?? "null") as PinsFile | null; return p?.schema === 1 ? p : undefined; } catch { return undefined; }
    },
    status(id: string): StatusRead { return parseStatus(readText(paths.statusFile(safe(id)))); },
    stopRequest(id: string): StopRequest | undefined { return parseStopRequest(readText(paths.stopFile(safe(id)))); },
    meta(id: string): ShopMeta { return store.read<ShopMeta>(`meta/${safe(id)}.json`) ?? { schema: 1, receipts: {} }; },
    saveMeta(id: string, meta: ShopMeta): void { store.write(`meta/${safe(id)}.json`, meta); },

    /** Is the folder one the deployer and the runtime will accept? The deployer adds the Guard addresses; here stand-in ones stand in for them. */
    checkFolder(settings: Settings, runtime: Record<string, unknown>, lock: string, keptPin = false): string[] {
      const problems: string[] = [];
      const s = (runtime.services ?? {}) as Record<string, Record<string, unknown>>;
      const withGuards = { ...runtime, services: { ...s, payments: { baseUrl: "http://guard.invalid", ...(s.payments ?? {}) }, calendar: { baseUrl: "http://guard.invalid", ...(s.calendar ?? {}) }, messaging: { baseUrl: "http://guard.invalid", ...(s.messaging ?? {}) } },
        ...(runtime.parser ? { parser: { baseUrl: "http://guard.invalid", ...(runtime.parser as object) } } : {}) };
      const r = validateRuntimeConfig(withGuards, "/tmp");
      if (!r.ok) problems.push(...r.errors);
      // a shop that already has a pin keeps it (`geometer update` moves it, after the hand check on its own settings): only its template has to be this one
      try { const l = parseLock(lock); if (l.pathway !== PATHWAY || (!keptPin && l.version !== pathwayVersion())) problems.push(`pathway.lock says ${l.pathway}@${l.version} but this panel builds ${PATHWAY}@${pathwayVersion()}.`); } catch (e) { problems.push((e as Error).message); }
      if (!validateSettings(settings).ok) problems.push("the settings do not pass their own check");
      return problems;
    },

    /** Write the shop's desired state. owner.json is written once and never again (flag wx), so the first account to set a shop up stays its attribution. */
    writeFolder(id: string, parts: { settings: Settings; runtime: Record<string, unknown>; lock: string; pins?: PinsFile }, creator?: { account: Account; template: string }): void {
      const dir = paths.shop(safe(id));
      // A new shop's folder is made without `recursive`, so a folder that is already there (another shop with this name) is an error, never shared.
      if (creator) { mkdirSync(paths.shops, { recursive: true }); mkdirSync(dir); } else mkdirSync(dir, { recursive: true });
      writeAtomic(join(dir, "settings.json"), `${JSON.stringify(parts.settings, null, 2)}\n`);
      writeAtomic(join(dir, "runtime.json"), `${JSON.stringify(parts.runtime, null, 2)}\n`);
      writeAtomic(join(dir, "pathway.lock"), `${parts.lock}\n`);
      if (parts.pins) writeAtomic(join(dir, "pins.json"), `${JSON.stringify(parts.pins, null, 2)}\n`);
      if (creator) {
        const owner: OwnerFile = { schema: 1, accountId: creator.account.id, accountName: creator.account.name, role: creator.account.role, createdAt: iso(now()), template: creator.template };
        try { writeFileSync(join(dir, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx", mode: 0o644 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
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
