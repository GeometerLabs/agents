// Where snapshots go: an S3-compatible bucket (Google Cloud Storage's interoperability API, Backblaze, R2, MinIO) or a folder on this machine. One small
// interface, and a signed-request client with node:crypto: put, get, list and delete are all a snapshot needs. Credentials are passed in, never logged.
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ObjectStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  /** Keys under a prefix, with when each was last written. */
  list(prefix: string): Promise<{ key: string; modified: number }[]>;
  delete(key: string): Promise<void>;
}

export interface S3Target { url: string; endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string }

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function s3Store(t: S3Target, fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()): ObjectStore {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/u.exec(t.url);
  if (!m) throw new Error(`"${t.url}" is not an s3:// address (s3://bucket/optional/folder).`);
  const [, bucket, folder] = m;
  const base = (t.endpoint ?? `https://s3.${t.region ?? "us-east-1"}.amazonaws.com`).replace(/\/+$/u, "");
  const region = t.region ?? "us-east-1";
  const prefix = folder.replace(/\/+$/u, "");
  const full = (key: string) => (prefix ? `${prefix}/${key}` : key);

  async function call(method: string, key: string, query: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const path = `/${bucket}${key ? `/${key.split("/").map(encode).join("/")}` : ""}`;
    const qs = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
    const url = new URL(base + path + (qs ? `?${qs}` : ""));
    const stamp = now().toISOString().replace(/[-:]|\.\d{3}/gu, "");
    const payload = sha256(body ?? "");
    const headers = { host: url.host, "x-amz-content-sha256": payload, "x-amz-date": stamp };
    const signed = Object.keys(headers).sort().join(";");
    const canonical = [method, url.pathname, qs, ...Object.keys(headers).sort().map((h) => `${h}:${headers[h as keyof typeof headers]}`), "", signed, payload].join("\n");
    const scope = `${stamp.slice(0, 8)}/${region}/s3/aws4_request`;
    const signature = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${t.secretAccessKey}`, stamp.slice(0, 8)), region), "s3"), "aws4_request")).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`).digest("hex");
    return fetchFn(url, { method, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` }, ...(body ? { body } : {}), signal: AbortSignal.timeout(60_000) });
  }
  const fail = async (what: string, r: Response) => { const text = (await r.text().catch(() => "")).replace(/\s+/gu, " ").slice(0, 200); return new Error(`${what}: the bucket answered ${r.status}${text ? ` (${text})` : ""}`); };

  return {
    async put(key, data) { const r = await call("PUT", full(key), {}, data); if (!r.ok) throw await fail(`could not write ${key}`, r); await r.arrayBuffer(); },
    async get(key) { const r = await call("GET", full(key)); if (r.status === 404) { await r.arrayBuffer(); return undefined; } if (!r.ok) throw await fail(`could not read ${key}`, r); return Buffer.from(await r.arrayBuffer()); },
    async delete(key) { const r = await call("DELETE", full(key)); if (!r.ok && r.status !== 404) throw await fail(`could not delete ${key}`, r); await r.arrayBuffer(); },
    async list(p) {
      const out: { key: string; modified: number }[] = [];
      let token: string | undefined;
      do {
        const r = await call("GET", "", { "list-type": "2", prefix: full(p), ...(token ? { "continuation-token": token } : {}) });
        if (!r.ok) throw await fail("could not list the bucket", r);
        const xml = await r.text();
        for (const c of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
          const key = /<Key>([\s\S]*?)<\/Key>/u.exec(c[1])?.[1], when = /<LastModified>([\s\S]*?)<\/LastModified>/u.exec(c[1])?.[1];
          if (key) out.push({ key: prefix ? key.slice(prefix.length + 1) : key, modified: when ? Date.parse(when) : 0 });
        }
        token = /<IsTruncated>true<\/IsTruncated>/u.test(xml) ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/u.exec(xml)?.[1] : undefined;
      } while (token);
      return out;
    },
  };
}

/** A folder on this machine, with the same interface. */
export function folderStore(root: string): ObjectStore {
  const walk = (dir: string, rel = ""): { key: string; modified: number }[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name), `${rel}${e.name}/`) : [{ key: `${rel}${e.name}`, modified: statSync(join(dir, e.name)).mtimeMs }]);
  return {
    async put(key, data) { const p = join(root, key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); },
    async get(key) { try { return readFileSync(join(root, key)); } catch { return undefined; } },
    async delete(key) { rmSync(join(root, key), { force: true }); },
    async list(p) { try { return walk(root).filter((o) => o.key.startsWith(p)); } catch { return []; } },
  };
}
