// The shop's licence on its page (plan B13): where it stands, the dates, fleet's renew link, and a note when the lease kept on this server has not been refreshed for
// more than 2 days. The STATE is the one the deployer worked out from the signed lease (status/<shop>.json `licence`), because that is what the shop's runtime acts on: an
// offline expiry can make it differ from what fleet last said. The DAYS and the renew link come from fleet's unsigned copy for the panel (fleet/<shop>.json `licence`),
// which states them as fleet's own local days; without it, the signed times are shown as days in India, fleet's time zone.
//
// Decision 39 (monorepo ADR-0070): a shop the lease does not list has NO LICENCE (state `none`): its Guards take no new work, so the page says so instead of
// showing nothing. A shop the builder's trial covers shows the day the trial ends (fleet's `trial_ends`).
import type { FleetAnswer, ShopStatus } from "./contract.ts";

/** The lease's five states, and `none`: the lease does not list the shop (decision 39). */
export const LICENCE_STATES = ["active", "reminder", "warning", "wind_down", "stopped", "none"] as const;
export type LicenceState = (typeof LICENCE_STATES)[number];
/** The kept lease is said to be out of date once it is older than this. */
export const STALE_AFTER_MS = 2 * 24 * 3600 * 1000;

export interface LicenceView {
  state: LicenceState;
  /** Days, as "2026-12-08". */
  paidThrough?: string;
  windDownOn?: string;
  stopOn?: string;
  exportUntil?: string;
  extendedUntil?: string;
  /** fleet's payment link for the invoice holding the shop back (https only). */
  renewUrl?: string;
  /** The day the kept lease was signed, when that is more than 2 days ago. */
  staleSince?: string;
  /** The day the builder's trial ends, for a shop it covers (fleet's unsigned `trial_ends`). */
  trialEnds?: string;
}

/** A signed time (the start of a local day in fleet's time zone) as that day. */
const dayInIndia = (iso: string | null | undefined): string | undefined => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return undefined;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
};

export function licenceView(status: ShopStatus["licence"] | undefined, fleet: FleetAnswer["licence"] | undefined, nowMs: number): LicenceView | undefined {
  if (!status) return undefined;
  if (!status.listed) return { state: "none" };
  const pick = (unsigned: string | null | undefined, signed: string | null | undefined) => unsigned ?? dayInIndia(signed);
  const stale = status.leaseIssuedAt && nowMs - Date.parse(status.leaseIssuedAt) > STALE_AFTER_MS ? dayInIndia(status.leaseIssuedAt) : undefined;
  const v: LicenceView = { state: status.state };
  const set = (k: keyof Omit<LicenceView, "state">, value: string | undefined) => { if (value) v[k] = value; };
  set("paidThrough", pick(fleet?.paid_through, status.paidThrough));
  // with an emergency extension, the signed wind-down day is the later one; fleet's copy does not know about the extension
  set("windDownOn", status.extendedUntil ? dayInIndia(status.windDownOn) : pick(fleet?.wind_down_on, status.windDownOn));
  set("stopOn", pick(fleet?.stop_on, status.stopOn));
  set("exportUntil", pick(fleet?.export_until, status.exportUntil));
  set("extendedUntil", dayInIndia(status.extendedUntil));
  if (status.state !== "active") set("renewUrl", fleet?.renew_url ?? undefined);
  set("staleSince", stale);
  set("trialEnds", fleet?.trial_ends);
  return v;
}

/** A day ("2026-12-08") as the panel's language writes it. */
export const dayWords = (day: string, lang: string): string => new Intl.DateTimeFormat(`${lang}-IN-u-nu-latn`, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
