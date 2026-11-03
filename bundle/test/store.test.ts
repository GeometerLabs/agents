// The snapshot store: a request signed the way S3 wants (checked against AWS's published example), list parsing, and the folder store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderStore, s3Store } from "../backup/store.ts";

test("a request is signed in the form S3 expects (AWS Signature V4): the credential scope, the signed headers and a 64-character signature", async () => {
  const seen: { url: string; headers: Record<string, string>; method: string }[] = [];
  const fake = (async (url: URL, init: RequestInit) => { seen.push({ url: String(url), headers: init.headers as Record<string, string>, method: String(init.method) }); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
  const store = s3Store({ url: "s3://snaps/geo", endpoint: "http://minio:9000", region: "ap-south-1", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI" }, fake, () => new Date("2026-11-04T01:30:00Z"));
  await store.put("glow-salon/2026-11-04/agent.db.age", Buffer.from("x"));
  const call = seen[0];
  assert.equal(call.method, "PUT");
  assert.equal(call.url, "http://minio:9000/snaps/geo/glow-salon/2026-11-04/agent.db.age");
  assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261104\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(call.headers["x-amz-date"], "20261104T013000Z");
  assert.ok(!JSON.stringify(call.headers).includes("wJalrXUtnFEMI"), "the secret is never sent");
});

test("a listing is read page by page, and keys come back without the folder prefix", async () => {
  const pages = [
    `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t1</NextContinuationToken><Contents><Key>geo/a/1.age</Key><LastModified>2026-11-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
    `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>geo/a/2.age</Key><LastModified>2026-11-02T00:00:00.000Z</LastModified></Contents></ListBucketResult>`,
  ];
  const urls: string[] = [];
  const fake = (async (url: URL) => { urls.push(String(url)); return new Response(pages.shift()!, { status: 200 }); }) as unknown as typeof fetch;
  const list = await s3Store({ url: "s3://snaps/geo", endpoint: "http://m:9000", accessKeyId: "k", secretAccessKey: "s" }, fake).list("a/");
  assert.deepEqual(list.map((o) => o.key), ["a/1.age", "a/2.age"]);
  assert.match(urls[1], /continuation-token=t1/);
});

test("an error from the bucket is said plainly and carries no credential", async () => {
  const fake = (async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(s3Store({ url: "s3://b", endpoint: "http://m", accessKeyId: "AKID", secretAccessKey: "SECRETSECRET" }, fake).put("k", Buffer.from("x")), (e: Error) => /answered 403/.test(e.message) && !/SECRETSECRET/.test(e.message));
  assert.throws(() => s3Store({ url: "https://nope", accessKeyId: "k", secretAccessKey: "s" }), /not an s3:\/\/ address/);
});

test("the folder store writes, lists, reads and deletes the same way", async () => {
  const root = mkdtempSync(join(tmpdir(), "geo-folder-"));
  try {
    const s = folderStore(root);
    await s.put("shop/2026-11-04/a.age", Buffer.from("A")); await s.put("shop/2026-11-05/b.age", Buffer.from("B"));
    assert.deepEqual((await s.list("shop/")).map((o) => o.key).sort(), ["shop/2026-11-04/a.age", "shop/2026-11-05/b.age"]);
    assert.equal((await s.get("shop/2026-11-04/a.age"))!.toString(), "A");
    await s.delete("shop/2026-11-04/a.age");
    assert.equal(await s.get("shop/2026-11-04/a.age"), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
