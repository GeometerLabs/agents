// What a pool worker thread imports (modules/runtime/shared-worker.ts): ONE listings-only shop's start, as a plain function of the shop's paths, so it can run inside a worker. It is
// `startClient` (the same code a shop run alone uses, start.ts) given this shop's own folder and token FILES; the worker has already put it on the loopback address, port 0.
import type { HeldShop, ShopPaths } from "../../../../modules/runtime/shared.ts";
import { startClient } from "./start.ts";

export async function start(p: ShopPaths, listen: { host: string; port: number }, log: (line: string) => void): Promise<HeldShop> {
  return await startClient({ clientFolder: p.clientFolder, tokenFile: p.tokenFile, channelTokenFile: p.channelTokenFile, recordKeyFile: p.recordKeyFile, listen, log: (line) => log(`[${p.name}] ${line}`) });
}
