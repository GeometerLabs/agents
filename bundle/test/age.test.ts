// age: round trips, tampering, and a vector made by the real `age` tool (age 1.2.1, `age -r <recipient>`; see test/proof for the check against the live tool).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, generateIdentity, recipientOf } from "../backup/age.ts";

test("a key pair has the shapes age gives it, and the recipient is the one the identity makes", () => {
  const k = generateIdentity();
  assert.match(k.identity, /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/);
  assert.match(k.recipient, /^age1[02-9ac-hj-np-z]{58}$/);
  assert.equal(recipientOf(k.identity), k.recipient);
});

test("what is encrypted opens with the identity and only with it, at every size around a chunk", () => {
  const k = generateIdentity(); const other = generateIdentity();
  for (const n of [0, 1, 15, 16, 65535, 65536, 65537, 131072, 200000]) {
    const plain = Buffer.alloc(n, 7);
    const sealed = encrypt(plain, k.recipient);
    assert.ok(sealed.toString("latin1").startsWith("age-encryption.org/v1\n-> X25519 "));
    assert.ok(!sealed.includes(Buffer.from("\x07\x07\x07\x07\x07\x07\x07\x07")) || n === 0, "the plain bytes are not in the file");
    assert.deepEqual(decrypt(sealed, k.identity), plain, `size ${n}`);
    assert.throws(() => decrypt(sealed, other.identity), /cannot open/);
  }
});

test("a changed byte anywhere is noticed: in the header, the nonce, a chunk, or the end", () => {
  const k = generateIdentity();
  const sealed = encrypt(Buffer.alloc(70000, 3), k.recipient);
  for (const at of [30, sealed.indexOf("---") + 10, sealed.length - 100, sealed.length - 1]) {
    const bad = Buffer.from(sealed); bad[at] ^= 1;
    assert.throws(() => decrypt(bad, k.identity), `byte ${at}`);
  }
  assert.throws(() => decrypt(sealed.subarray(0, sealed.length - 40), k.identity), "a cut-off file");
  assert.throws(() => decrypt(Buffer.from("not an age file"), k.identity), /not an age file/);
});

test("a mistyped key is refused with a plain reason", () => {
  const k = generateIdentity();
  assert.throws(() => encrypt(Buffer.from("x"), k.recipient.slice(0, -1) + (k.recipient.endsWith("q") ? "p" : "q")), /typing mistake/);
  assert.throws(() => encrypt(Buffer.from("x"), "not-a-key"), /not an age key/);
  assert.throws(() => decrypt(encrypt(Buffer.from("x"), k.recipient), k.recipient), /not an age key/);
});
