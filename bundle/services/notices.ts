// The courier for "my feed changed" notices (block S phase B2, specs/shop-feed.md "My feed changed"). A shop's runtime sits alone on its own internal network and cannot call out, so it
// cannot tell the directory its feed changed. The inbox can: it is the one service on both the network the runtimes' doors are on and the network the directory is on (generate/compose.ts),
// and it already holds each shop's internal token. So the inbox ASKS each runtime "is a notice due?" and carries the answer across. No network rule changes, and the runtime still only answers.
//
//   every pass, for each shop:  GET  <runtime>/internal/feed-notice   204: nothing due.   200 {notice, fingerprint}: a signed notice (the shop's own key made it; this file only carries it)
//                               POST <directory>/feed-changed <notice>  202: taken.       429 or 5xx: try again next pass.   another refusal: not taken, and not repeated
//                               POST <runtime>/internal/feed-notice {fingerprint}   tells the runtime it was delivered (it then waits a minute and sends the next only for a real change)
//
// A notice is only a hint: the directory takes nothing from it but "read the feed again", and checks the feed's own signature. So the worst a lost or repeated notice does is one extra or one
// late read; the directory re-reads every feed every six hours anyway. The directory limits notices to 20 a minute per address and every shop's arrives from the inbox's one address, so
// this sends at most 15 a minute in all and leaves the rest for the next pass (the runtime keeps each notice pending until it is acknowledged). Nothing about a buyer is ever in a notice, and
// nothing is logged but the shop's name and the status.
export interface CourierShop { name: string; /** The shop's runtime, as the inbox reaches it (http://door-<shop>:8780). */ runtimeUrl: string; /** The shop's internal token (never logged). */ token: string }

export interface CourierOptions {
  shops: CourierShop[];
  /** The directory service, http://directory:8799. */
  directoryUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  /** The most notices sent in any minute, across all shops. */
  perMinute?: number;
}

export interface PassResult { sent: number; refused: number; waiting: number; down: number }

export function createCourier(o: CourierOptions) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => undefined);
  const perMinute = o.perMinute ?? 15;
  const sentAt: number[] = [];
  const timeout = () => AbortSignal.timeout(5_000);
  const runtime = (s: CourierShop, init: RequestInit = {}) => fetchImpl(`${s.runtimeUrl.replace(/\/+$/u, "")}/internal/feed-notice`, { ...init, headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, signal: timeout() });

  return {
    /** One pass over every shop. Never throws: a shop or the directory that does not answer is counted and tried again next pass. */
    async pass(): Promise<PassResult> {
      const result: PassResult = { sent: 0, refused: 0, waiting: 0, down: 0 };
      for (const shop of o.shops) {
        const t = now();
        while (sentAt.length > 0 && t - sentAt[0] >= 60_000) sentAt.shift();
        if (sentAt.length >= perMinute) { result.waiting++; continue; }
        try {
          const due = await runtime(shop);
          if (due.status === 204) continue;
          if (due.status !== 200) { result.down++; continue; }
          const { notice, fingerprint } = await due.json() as { notice?: unknown; fingerprint?: unknown };
          if (typeof notice !== "object" || notice === null || typeof fingerprint !== "string") { result.down++; continue; }
          const sent = await fetchImpl(`${o.directoryUrl.replace(/\/+$/u, "")}/feed-changed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(notice), signal: timeout() });
          sentAt.push(now());
          // the directory said wait (429), or is down or failing (5xx): the notice stays pending in the runtime and is offered again next pass (the directory learns a new shop only from a notice
          // or its own list, so a notice must not be dropped because the directory was restarting)
          if (sent.status === 429 || sent.status >= 500) { result.waiting++; continue; }
          if (sent.status === 202 || sent.status === 200) result.sent++;
          else { result.refused++; log(`feed notice: the directory did not take ${shop.name}'s notice (${sent.status}); it will not be sent again until the feed changes`); }
          // taken, or refused for a reason that sending the same notice again cannot change: either way the runtime is told, so it does not offer the same one every pass
          await runtime(shop, { method: "POST", body: JSON.stringify({ fingerprint }) });
        } catch (e) { result.down++; log(`feed notice: ${shop.name}: ${(e as Error).name}`); }
      }
      return result;
    },
  };
}
export type Courier = ReturnType<typeof createCourier>;
