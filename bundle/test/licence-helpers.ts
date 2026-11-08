// Leases and extensions for the bundle's tests, signed like fleet signs them, with RFC 8032's published TEST 1 key (the vectors' key: anyone can sign with it, which is the
// point; never a production key).
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { kidOf } from "../../modules/licence/token.ts";
import type { LeaseShop } from "../../modules/licence/rules.ts";

export const VECTORS = JSON.parse(readFileSync(new URL("./fixtures/licence-vectors.json", import.meta.url), "utf8"));
export const TEST_PUBLIC_HEX: string = VECTORS.test_key.public_hex;
const KEY = Buffer.from(TEST_PUBLIC_HEX, "hex");
const PRIVATE = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(VECTORS.test_key.seed_hex, "hex")]), format: "der", type: "pkcs8" });

/** fleet's canonical form, for these values: keys sorted, no spaces */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `"${k}":${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v));

/** Sign a payload with the published test key, the way fleet's signPayload does. */
export function signTest(payload: Record<string, unknown>, prefix = payload.kind === "extension" ? "gx1" : "gl1"): string {
  const head = `${prefix}.${kidOf(KEY)}.${Buffer.from(canonical(payload), "ascii").toString("base64url")}`;
  return `${head}.${sign(null, Buffer.from(head, "ascii"), PRIVATE).toString("base64url")}`;
}

export const DAY = 86_400;
/** The start of a local day in fleet's time zone, as in the vectors (8 Dec 2026, IST). */
export const T0 = 1_796_668_200;
export const shopEntry = (change: Partial<LeaseShop> = {}): LeaseShop => ({ id: "glow-salon", plan: "business", state: "active", paid_through: T0, grace_days: 30, expires: T0 + 30 * DAY, stop_at: null, export_until: null, notice: null, ...change });
export const lease = (serial: number, issuedAt: number, shops: LeaseShop[] = [shopEntry()], deployment = "acme-vps-1"): string => signTest({ v: 1, kind: "lease", deployment, serial, issued_at: issuedAt, shops });
export const extension = (issuedAt: number, until: number, deployments: string[] = ["*"]): string => signTest({ v: 1, kind: "extension", deployments, issued_at: issuedAt, until });
/** geometer.json's pinned key for these tests. */
export const PIN = { licence: { keys: [TEST_PUBLIC_HEX] } };
