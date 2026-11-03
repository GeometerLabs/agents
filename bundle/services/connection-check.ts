// Runs INSIDE the panel container: `geometer check <shop>` starts it with `docker compose exec -T panel node /app/bundle/services/connection-check.ts <shop>`.
// It does what the panel's own "Run the checks" button does (golive.run: the hand check, then the read-only connection checks through the shop's Guards with the
// panel's own agent token), so what it finds is also what the panel's page shows, and there is one copy of the checks. It is not run anywhere else: only the
// panel container is on the network the Guards' agent ports are on, and only it has the token. It prints one JSON line: the results, nothing secret.
import { configFromEnv } from "../panel/config.ts";
import { createGoLive } from "../panel/golive.ts";
import { createShops } from "../panel/shops.ts";
import { openStores } from "../panel/server.ts";

const shop = process.argv[2] ?? "";
const config = configFromEnv(process.env);
const { store } = openStores(config);
const stored = await createGoLive(config, createShops(config, store), store).run(shop);
console.log(JSON.stringify(stored ? { connections: stored.connections } : { missing: true }));
