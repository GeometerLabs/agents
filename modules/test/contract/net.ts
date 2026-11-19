// Small things every runtime contract suite needs and none should write twice: a free port, random hex for secrets and a sleep. Shared by the listings suite
// (templates/commerce/listings/contract) and the Bookings suite (templates/commerce/bookings/contract) so the two harnesses stay one idea.
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

/** A port nothing listens on now (bound to 0 and released). */
export async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** `n` random bytes as 2n hex digits (a token, a key). */
export const hex = (n: number): string => randomBytes(n).toString("hex");

/** Wait a moment. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
