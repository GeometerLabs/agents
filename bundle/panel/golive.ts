// The checks before a shop goes live, and the papers they produce.
//  1. The hand check: the same situations scripts/hand-check.ts runs, each on the shop's OWN Go program started on THIS shop's settings.json, against stand-in services
//     (24 Nov 2026, owner: "Run the hand check on Go"). In a child process with a time limit (bundle/lib/hand-check-go.ts), within the request. A run that could not happen
//     is stored as a hand check of nothing, with the reason, so "go live" refuses it; a stored check from before (no program named) is run again.
//  2. The connection checks: read-only, through the shop's Guards (checks.ts). Only possible once the deployer has applied the shop.
//  3. "Ready to go live": allowed only when 1 and 2 passed, the deployer says the last update was applied and every limit is proven, and the settings
//     are still the ones that were checked. It writes the go-live certificate (report/), signed when the panel has a key.
// The results are kept in the panel's data (counts and codes: nothing secret), so the page can show them after the redirect.
import { join } from "node:path";
import { goProgramsDir, programDigest } from "../../modules/crash-test/programs.ts";
import { runGoHandCheck } from "../lib/hand-check-go.ts";
import type { HandCheckOutcome } from "../lib/hand-check-go.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import { gatewayOf } from "../../modules/payments/providers/index.ts";
import { guardsOf, kindFor, runtimeHasWhatsApp } from "../lib/kinds.ts";
import type { HandCheckSummaryLike, Kind } from "../lib/kinds.ts";
import { checkConnections } from "./checks.ts";
import type { CheckResult, ConnectionTargets } from "./checks.ts";
import { guardUrlFor, readGuardAgentToken } from "./config.ts";
import type { PanelConfig } from "./config.ts";
import { createDocuments } from "./documents.ts";
import type { Shops } from "./shops.ts";
import type { Store } from "./store.ts";

export interface StoredChecks {
  at: string;
  settingsDigest: string;
  /** The hand check's own summary (counts, the digest of the settings it ran on, what could not run), plus how many things are listed as not tested. */
  hand: HandCheckSummaryLike & { failed: number; notTested: number };
  /** null: this server has not said where the shop's Guards are, so nothing could be checked. */
  connections: CheckResult[] | null;
  /** Batch 3: what the runtime counted when the checks ran: the owner's passkeys and the phones with alerts on. Left out: the runtime did not answer (or has no sign-in). */
  ownerAccess?: { passkeys: number; alertPhones: number };
}

/**
 * Item 11h (decision 45): "owner-signin": a shop with no WhatsApp whose owner has no way to hear yet. Without WhatsApp, the owner signs in with a passkey from the
 * Operator's setup QR and turns on alerts in their app; until one passkey exists and one phone has alerts on, a payment to mark or a refund to approve would reach
 * nobody. Batch 3: the runtime's /status counts both (go/internal/runtime ownerAccess) and the checks keep the counts they saw, so "go live" refuses until the owner has
 * signed in and one phone has alerts. A shop WITH WhatsApp keeps the owner's WhatsApp as a way to hear, so it is not held back by this.
 */
export type Unmet = "hand-check" | "deploy" | "limits" | "connections" | "settings-changed" | "owner-signin";

const iso = (ms: number) => new Date(ms).toISOString();

// Runs and keeps the go-live checks (hand check, connection checks) and decides "ready" only when every condition holds; the stored result is what the certificate and the confirm page read.
export function createGoLive(config: PanelConfig, shops: Shops, store: Store) {
  const now = () => (config.now ?? Date.now)();
  const key = config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined; // fails at start, not at the first certificate
  const agentToken = readGuardAgentToken(config);

  /** The template a shop is: its hand check, its certificate and its settings digest (Bookings, Fees and Orders each have their own: lib/kinds.ts). */
  const kindOf = (shop: string): Kind => kindFor(shops.kind(shop)) as Kind;
  const docs = createDocuments(store);
  const stored = (shop: string) => store.read<StoredChecks>(`checks/${shop}.json`);

  function targetsFor(shop: string): ConnectionTargets | undefined {
    if (!config.guardUrl) return undefined;
    const meta = shops.meta(shop);
    // Only a shop that chose a gateway has a gateway account to check and a key to pin (B71): a UPI shop, or settings with no payment block, has none.
    const settings0 = shops.settings(shop);
    const gateway = gatewayOf(settings0?.payment);
    const runtime = shops.runtime(shop);
    const pins = shops.pins(shop);
    const wa = guardUrlFor(config, shop, "whatsapp") as string;
    const hasCalendar = guardsOf(kindOf(shop), settings0).includes("calendar"); // B72: a shop on its own booking list has no calendar to check
    // A shop whose WhatsApp goes through Gupshup (runtime.json `provider`) has no Meta number read to make: its check is Gupshup's app read (checks.ts checkGupshup)
    const messaging = runtime?.services?.messaging;
    // item 11h: a shop with no WhatsApp has no WhatsApp to check
    const whatsapp = !runtimeHasWhatsApp(runtime) ? {} : messaging?.provider === "gupshup-selfserve"
      ? { gupshupSelfServe: { baseUrl: wa, appName: String(messaging.appName ?? ""), ...(messaging.appId ? { appId: String(messaging.appId) } : {}) } }
      : messaging?.provider === "gupshup"
      ? { gupshup: { baseUrl: wa, appId: String(messaging.appId ?? "") } }
      : { whatsapp: { baseUrl: wa, phoneNumberId: String(messaging?.phoneNumberId ?? ""), businessNumber: meta.whatsapp?.businessNumber ?? "" } };
    return {
      ...(agentToken ? { agentToken } : {}),
      ...whatsapp,
      ...(gateway ? { gateway: { provider: gateway.id, baseUrl: guardUrlFor(config, shop, gateway.id) as string, ...(meta.gateway?.provider === gateway.id && meta.gateway.keyId ? { keyId: meta.gateway.keyId } : {}), expectedMode: meta.gateway?.mode ?? "live", ...(pins?.gateway?.provider === gateway.id && pins.gateway.keyId ? { pinnedKeyId: pins.gateway.keyId } : {}) } } : {}),
      ...(hasCalendar ? { calendar: { baseUrl: guardUrlFor(config, shop, "calendar") as string, calendarId: String(runtime?.services?.calendar?.calendarId ?? "") } } : {}),
    };
  }

  /** The hand check of one shop, on its own program: the panel's own runner (a test's, or the child process of lib/hand-check-go.ts). */
  const handCheck = config.handCheck ?? ((kind: string, settingsFile: string) => runGoHandCheck(kind, settingsFile));
  /** The hand check ran on the program that is on this server now (the same file digest): after an update swaps the program, a stored check of the old one no longer counts. */
  const ranOnThisProgram = (checks: StoredChecks | undefined): boolean => !!checks?.hand.program && programDigest(join(goProgramsDir(), checks.hand.program.name)) === checks.hand.program.sha256;
  /** A stored hand check still stands for these settings when it ran on them (the same digest) and on the program that is here now. */
  const handStillStands = (checks: StoredChecks | undefined, digest: string): boolean => !!checks && checks.settingsDigest === digest && checks.hand.total > 0 && ranOnThisProgram(checks);
  /** What a hand check that could not run is kept as: nothing held, nothing tried, and why, so the gate refuses it and the page says what happened. */
  const notRun = (outcome: Extract<HandCheckOutcome, { ok: false }>): HandCheckSummaryLike => ({ held: 0, total: 0, checks: 0, failedTitles: [], notRun: [outcome.reason] });

  const api = {
    stored,
    /**
     * Run the go-live checks. `reuseHand`: keep the stored hand check when it still stands (the same settings, the same program file), as the confirm page does, so a
     * confirmation does not wait for a minute's run that would only repeat itself; the connection checks always run again.
     */
    async run(shop: string, o: { reuseHand?: boolean } = {}): Promise<StoredChecks | undefined> {
      const settings = shops.settings(shop);
      if (!settings) return undefined;
      const papers = kindOf(shop).papers;
      // a listings-only shop moves no money and sends no message, so it has no hand check and no go-live paper
      if (!papers) return undefined;
      const before = stored(shop);
      let summary: HandCheckSummaryLike;
      if (o.reuseHand && handStillStands(before, papers.policyDigest(settings))) summary = before!.hand;
      else {
        const outcome = await handCheck(kindOf(shop).id, shops.settingsFile(shop));
        summary = outcome.ok ? outcome.summary : notRun(outcome);
      }
      const certificate = papers.buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: now() });
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
      // batch 3: what the shop's runtime counts of the owner's way in (passkeys, phones with alerts), asked once here; it is kept with the checks that ask it
      const probe = runtimeHasWhatsApp(shops.runtime(shop)) ? undefined : (await shops.probeRuntime(shop)).counts?.ownerAccess;
      const ownerAccess = probe && Number.isInteger(probe.passkeys) && Number.isInteger(probe.alertPhones) ? { passkeys: Number(probe.passkeys), alertPhones: Number(probe.alertPhones) } : undefined;
      const result: StoredChecks = {
        at: iso(now()), settingsDigest: papers.policyDigest(settings),
        hand: { ...summary, failed: certificate.checks.failed, notTested: certificate.notTested.length },
        connections: report ? report.results : null,
        ...(ownerAccess ? { ownerAccess } : {}),
      };
      store.write(`checks/${shop}.json`, result);
      return result;
    },

    /** What still stands between this shop and "Ready to go live". Empty when nothing does. */
    unmet(shop: string, settings: any): Unmet[] {
      if (!kindOf(shop).papers) return []; // nothing to check or prove: see `run`
      const checks = stored(shop);
      const out: Unmet[] = [];
      // the hand check stands only when it ran on the shop's own Go program (a check stored before 24 Nov 2026 names none: it is run again), every situation held,
      // and it ran on the program that is on this server now (an update that swaps the program asks for the check again)
      if (!checks || checks.hand.total === 0 || checks.hand.held < checks.hand.total || !ranOnThisProgram(checks)) out.push("hand-check");
      else if (checks.settingsDigest !== kindOf(shop).papers!.policyDigest(settings)) out.push("settings-changed");
      const read = shops.status(shop);
      if (!read.ok || read.status.deploy?.state !== "applied") out.push("deploy");
      else if (!read.status.limits || read.status.limits.of === 0 || read.status.limits.proven < read.status.limits.of) out.push("limits");
      if (!checks?.connections || !checks.connections.every((c) => c.ok)) out.push("connections");
      if (!runtimeHasWhatsApp(shops.runtime(shop)) && !(checks?.ownerAccess && checks.ownerAccess.passkeys >= 1 && checks.ownerAccess.alertPhones >= 1)) out.push("owner-signin");
      return out;
    },

    /** Make the go-live certificate in the owner's language. Refuses (returns the unmet list) unless nothing is unmet. */
    ready(shop: string, preparedBy: string): { ok: true; files: string[] } | { ok: false; unmet: Unmet[] } {
      const settings = shops.settings(shop);
      if (!settings) return { ok: false, unmet: ["settings-changed"] };
      const unmet = api.unmet(shop, settings);
      if (unmet.length > 0) return { ok: false, unmet };
      if (!kindOf(shop).papers) return { ok: true, files: [] };
      const checks = stored(shop) as StoredChecks;
      const files = docs.make(shop, "go-live", (scratch) => kindOf(shop).papers!.writeGoLiveCertificate({ settings, handCheck: checks.hand, language: settings.owner.language, out: scratch, key, preparedBy, now: now() }).files);
      shops.saveMeta(shop, { ...shops.meta(shop), readyAt: iso(now()) });
      return { ok: true, files };
    },

    docs,
    documents: (shop: string, kind: "go-live" | "monthly") => docs.list(shop, kind),
  };

  return api;
}

export type GoLive = ReturnType<typeof createGoLive>;
