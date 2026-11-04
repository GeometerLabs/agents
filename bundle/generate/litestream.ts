// Litestream's config: it streams ONLY the runtimes' SQLite files. (It must own checkpointing of what it streams, and the runtime never checkpoints by
// hand; Guard's own store is not streamed, it is backed up with Guard's own backup, see backup/jobs.ts.) The file holds the bucket's key, so it is
// written into secrets/litestream/ and not among the generated config files that are checked for secrets.
import type { BackupConfig } from "../lib/server.ts";

export function litestreamConfig(backup: BackupConfig, shops: string[], key: { accessKeyId: string; secretAccessKey: string }): string {
  const q = (s: string) => JSON.stringify(s);
  const base = backup.stream.url.replace(/\/+$/u, "");
  return [
    `# Written by the Geometer deploy bundle. Streams each shop's runtime database to the bucket you chose, about every second.`,
    `dbs:`,
    ...shops.flatMap((shop) => [
      `  - path: ${q(`/data/${shop}/data/agent.db`)}`,
      `    replica:`,
      `      url: ${q(`${base}/${shop}`)}`,
      ...(backup.stream.endpoint ? [`      endpoint: ${q(backup.stream.endpoint)}`] : []),
      ...(backup.stream.region ? [`      region: ${q(backup.stream.region)}`] : []),
      `      access-key-id: ${q(key.accessKeyId)}`,
      `      secret-access-key: ${q(key.secretAccessKey)}`,
    ]),
    ``,
  ].join("\n");
}
