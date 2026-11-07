// The real `geo-guard` binary for the tests that run it. The launcher itself is bundle/agent/guard-process.ts (the crash test of an agent uses it too); this file only says
// where the built program is on a developer's computer and what a test says when it is not there.
//
// It needs the built binary (monorepo target/debug/geo-guard, macOS). Without it `haveBinary` is false and a test that uses this says it was skipped and why. Set GEO_GUARD_BIN to use another.
import { existsSync } from "node:fs";
import { startRealGuard as start } from "../agent/guard-process.ts";
import type { RealGuard, RealGuardOptions } from "../agent/guard-process.ts";

export { credential } from "../agent/guard-process.ts";
export type { RealGuard } from "../agent/guard-process.ts";

export const BINARY = process.env.GEO_GUARD_BIN ?? "/Users/navaltharun/Work/geometer/monorepo/target/debug/geo-guard";
export const haveBinary = existsSync(BINARY);
export const skipWithoutBinary: string | false = haveBinary ? false : `needs the built geo-guard binary, which is not at ${BINARY} (build it in the monorepo, or set GEO_GUARD_BIN); these tests run the real Guard`;

export const startRealGuard = (o: Omit<RealGuardOptions, "binary">): Promise<RealGuard> => start({ ...o, binary: BINARY });
