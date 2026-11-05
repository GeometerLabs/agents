// The checks before a shop goes live, and the papers they produce.
//  1. The hand check: the same situations scripts/hand-check.ts runs, on THIS shop's own prices and hours, against stand-in services. In this process.
//  2. The connection checks: read-only, through the shop's Guards (checks.ts). Only possible once the deployer has applied the shop.
//  3. "Ready to go live": allowed only when 1 and 2 passed, the deployer says the last update was applied and every limit is proven, and the settings
//     are still the ones that were checked. It writes the go-live certificate (report/), signed when the panel has a key.
// The results are kept in the panel's data (counts and codes: nothing secret), so the page can show them after the redirect.
import { readFileSync } from "node:fs";
import { runOn } from "../../templates/commerce/bookings/crash-test/situations.ts";
import { buildGoLiveCertificate, summariseRun } from "../../templates/commerce/bookings/report/certificate.ts";
import type { HandCheckSummary } from "../../templates/commerce/bookings/report/certificate.ts";
import { policyDigest } from "../../templates/commerce/bookings/report/data.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { writeGoLiveCertificate } from "../../templates/commerce/bookings/report/run.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import { checkConnections } from "./checks.ts";
import type { CheckResult, ConnectionTargets } from "./checks.ts";
import { guardUrlFor } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { createDocuments } from "./documents.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";

export interface StoredChecks {
  at: string;
  settingsDigest: string;
  /** The hand check's own summary (counts, the digest of the settings it ran on, what could not run), plus how many things are listed as not tested. */
  hand: HandCheckSummary & { failed: number; notTested: number };
  /** null: this server has not said where the shop's Guards are, so nothing could be checked. */
  connections: CheckResult[] | null;
}

export type Unmet = "hand-check" | "deploy" | "limits" | "connections" | "settings-changed";

const iso = (ms: number) => new Date(ms).toISOString();

export function createGoLive(config: PanelConfig, shops: Shops, store: Store) {
  const now = () => (config.now ?? Date.now)();
  const key = config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined; // fails at start, not at the first certificate
  const agentToken = (() => {
    if (!config.guardAgentTokenFile) return undefined;
    try { return readFileSync(config.guardAgentTokenFile, "utf8").trim() || undefined; } catch { return undefined; }
  })();

  const docs = createDocuments(store);
  const stored = (shop: string) => store.read<StoredChecks>(`checks/${shop}.json`);

  function targetsFor(shop: string): ConnectionTargets | undefined {
    if (!config.guardUrl) return undefined;
    const meta = shops.meta(shop);
    const runtime = shops.runtime(shop);
    const pins = shops.pins(shop);
    const wa = guardUrlFor(config, shop, "whatsapp") as string;
    const rz = guardUrlFor(config, shop, "razorpay") as string;
    const cal = guardUrlFor(config, shop, "calendar") as string;
    return {
      ...(agentToken ? { agentToken } : {}),
      whatsapp: { baseUrl: wa, phoneNumberId: String(runtime?.services?.messaging?.phoneNumberId ?? ""), businessNumber: meta.whatsapp?.businessNumber ?? "" },
      razorpay: { baseUrl: rz, ...(meta.razorpay?.keyId ? { keyId: meta.razorpay.keyId } : {}), expectedMode: meta.razorpay?.mode ?? "live", ...(pins?.razorpay?.keyId ? { pinnedKeyId: pins.razorpay.keyId } : {}) },
      calendar: { baseUrl: cal, calendarId: String(runtime?.services?.calendar?.calendarId ?? "") },
    };
  }

  const api = {
    stored,
    async run(shop: string): Promise<StoredChecks | undefined> {
      const settings = shops.settings(shop);
      if (!settings) return undefined;
      const ran = await runOn(settings);
      const summary = summariseRun(ran);
      const certificate = buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: now() });
      const targets = targetsFor(shop);
      const report = targets ? await checkConnections(targets) : undefined;
      // What the providers reported replaces what was typed (a calendar id as Google writes it), and is pinned for Guard's exact allowlists.
      if (report?.allOk) {
        // Only the pins are written, and runtime.json only if the confirmed calendar id is written differently from what was typed.
        shops.writePins(shop, { schema: 1, checkedAt: iso(now()), ...report.pins });
        const runtime = shops.runtime(shop);
        const calendarId = report.pins.calendar?.calendarId;
        if (runtime && calendarId && runtime.services?.calendar?.calendarId !== calendarId) shops.writeRuntime(shop, { ...runtime, services: { ...runtime.services, calendar: { ...runtime.services.calendar, calendarId } } });
      }
      const result: StoredChecks = {
        at: iso(now()), settingsDigest: policyDigest(settings),
        hand: { ...summary, failed: certificate.checks.failed, notTested: certificate.notTested.length },
        connections: report ? report.results : null,
      };
      store.write(`checks/${shop}.json`, result);
      return result;
    },

    /** What still stands between this shop and "Ready to go live". Empty when nothing does. */
    unmet(shop: string, settings: Settings): Unmet[] {
      const checks = stored(shop);
      const out: Unmet[] = [];
      if (!checks || checks.hand.total === 0 || checks.hand.held < checks.hand.total) out.push("hand-check");
      else if (checks.settingsDigest !== policyDigest(settings)) out.push("settings-changed");
      const read = shops.status(shop);
      if (!read.ok || read.status.deploy?.state !== "applied") out.push("deploy");
      else if (!read.status.limits || read.status.limits.of === 0 || read.status.limits.proven < read.status.limits.of) out.push("limits");
      if (!checks?.connections || !checks.connections.every((c) => c.ok)) out.push("connections");
      return out;
    },

    /** Make the go-live certificate in the owner's language. Refuses (returns the unmet list) unless nothing is unmet. */
    ready(shop: string, preparedBy: string): { ok: true; files: string[] } | { ok: false; unmet: Unmet[] } {
      const settings = shops.settings(shop);
      if (!settings) return { ok: false, unmet: ["settings-changed"] };
      const unmet = api.unmet(shop, settings);
      if (unmet.length > 0) return { ok: false, unmet };
      const checks = stored(shop) as StoredChecks;
      const files = docs.make(shop, "go-live", (scratch) => writeGoLiveCertificate({ settings, handCheck: checks.hand, language: settings.owner.language, out: scratch, key, preparedBy, now: now() }).files);
      shops.saveMeta(shop, { ...shops.meta(shop), readyAt: iso(now()) });
      return { ok: true, files };
    },

    docs,
    documents: (shop: string, kind: "go-live" | "monthly") => docs.list(shop, kind),
  };

  return api;
}

export type GoLive = ReturnType<typeof createGoLive>;
