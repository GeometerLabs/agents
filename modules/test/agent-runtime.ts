// The runtime's queue, in process, for the tests of what stays TypeScript around a shop (the approvals relay, the real Guard binary): since 24 Nov 2026 a shop's runtime is
// the Go program (decision 61) and the TypeScript server runtime is gone, so a test that needs "a runtime" for the relay to talk to drives the template's own agent through
// this instead. It keeps what those tests relied on: each event handled once by the runtime's event key (the runtime saved it once), in the order given, a beat on demand, the
// refund counts /status gave, and the relay's two calls (the context of a held refund, the owner's decision as one more event) answered in process. The Go runtime's own
// side of those two routes is held by each template's contract (limits-approvals and money contracts).
import type { Context, RefundContext, RuntimeClient } from "../approvals/clients.ts";
import type { RefundIssue } from "../payments/refunds.ts";
import { eventKey } from "../runtime/events.ts";
import type { IncomingEvent } from "../runtime/events.ts";

/** The refund counts the runtime's /status gave: a hold waiting for the owner, a refund being sent again, an issue for the builder (by kind). */
export interface RefundCounts { waitingForOwner: number; beingSentAgain: number; needBuilder: Partial<Record<RefundIssue["kind"], number>> & { total: number } }

/** What the tests ask of the runtime. */
export interface AgentRuntime {
  submit(events: IncomingEvent[]): void;
  kick(): void;
  idle(): Promise<void>;
  tick(): Promise<void>;
}

/** The queue over an agent's `handle`: `tick` is the agent's beat (`{ kind: "tick" }`). */
export function agentRuntime(agent: { handle(event: never): Promise<unknown> }): AgentRuntime {
  const seen = new Set<string>();
  let queue: IncomingEvent[] = [];
  let running: Promise<void> = Promise.resolve();
  return {
    submit(events) { for (const e of events) { const key = eventKey(e); if (!seen.has(key)) { seen.add(key); queue.push(e); } } },
    kick() { const now = queue; queue = []; running = running.then(async () => { for (const e of now) await agent.handle(e as never); }); },
    idle: () => running,
    async tick() { await running; await agent.handle({ kind: "tick" } as never); },
  };
}

/** The relay's two calls to the runtime, answered in process: `context` is the template's refund context read from its store (what /internal/refund-context answered). */
export function inProcessRuntimeClient(runtime: AgentRuntime, context: (receipt: string) => RefundContext | null): RuntimeClient {
  return {
    async context(receipt): Promise<Context> { const found = context(receipt); return found ? { kind: "found", context: found } : { kind: "missing" }; },
    async decided(approval, decision, id) { runtime.submit([{ kind: "approval_decision", approval, decision, id }]); runtime.kick(); await runtime.idle(); return true; },
  };
}

/** The runtime's refund counts over a template's cases (a booking, an order, a fee): what go/internal/runtime countRefunds gave. */
export function countRefunds(cases: Iterable<{ pending: { kind: string }[]; refundIssues?: RefundIssue[] }>): RefundCounts {
  const counts: RefundCounts = { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } };
  for (const c of cases) {
    for (const p of c.pending) { if (p.kind === "guard_hold") counts.waitingForOwner++; else if (p.kind === "refund_retry") counts.beingSentAgain++; }
    for (const issue of c.refundIssues ?? []) { counts.needBuilder[issue.kind] = (counts.needBuilder[issue.kind] ?? 0) + 1; counts.needBuilder.total++; }
  }
  return counts;
}
