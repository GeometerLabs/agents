# signing: canonical JSON and Ed25519 signatures

## What it is for

A shop publishes what it has (its **feed**), answers "do you still have these?" (a **check answer**), and tells directories "my feed changed"
(a **notice**). Each of those is a small JSON record that other programs read. This module is how a record is **signed by the shop** and
how anyone **checks** it, so a cache, a mirror or another directory can pass a record on and nobody along the way can change a price.

It has no dependency: Node's `node:crypto` only. The formats are in [`specs/`](../../specs/README.md); this module is the code that signs
and checks them.

## Architecture

```
  canonical.ts   pure: a value -> the one canonical text (RFC 8785)        imports nothing
       |
       v
  keys.ts        Ed25519 keys: make, save as text, key id           node:crypto
       |
       v
  sign.ts        sign / check a feed, a check answer, a notice       node:crypto
  jws.ts         sign / check an A2A Agent Card (a JWS)              node:crypto
```

`canonical.ts` is on its own so that a program that must not touch the disk or the network (an agent's own import graph, which the browser
demo is built from) can use it.

## What a signature is

1. Take the record **without** its signature.
2. Write it as canonical JSON ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)): member names sorted by UTF-16 code units, no spaces,
   strings escaped the JSON way, numbers written plainly.
3. Sign those UTF-8 bytes with Ed25519. `sig` is the 64-byte signature as base64url with no padding (86 characters).
4. The public key is written as SPKI DER in base64url. Its **key id** is the base64url SHA-256 of the raw 32-byte key (43 characters).

Our formats have **no floating-point numbers** (money is a decimal string such as `"8000.00"`), so the canonical writer accepts only safe
integers and **throws** for a float, `NaN`, an `undefined` member, a `Date`, a `Map` or a string with a lone surrogate. A loud refusal is
better than two programs signing different bytes.

## The three shapes

| Record | Where the signature sits | Carries the public key? | Function pair |
|---|---|---|---|
| Feed (`shop-feed/1`) | `signature: { alg, keyId, key, sig }` | yes, so a reader can check it the first time it sees the shop | `signFeed` / `verifyDocument` |
| Check answer (`shop-check/1`) | `signature: { alg, keyId, sig }` | no: the asker already pinned the key | `signAnswer` / `verifyDocument(doc, pinnedKey)` |
| Notice (`shop-feed-changed/1`) | `keyId` and `sig` members of the notice | no | `signNotice` / `verifyNotice` |
| A2A Agent Card | `signatures: [{ protected, signature }]` (a JWS, `alg: "EdDSA"`) | no (the `kid` names it) | `signCard` / `verifyCard` |

The Agent Card follows the A2A specification's section 8.4 (version 1.0.1): JWS over the RFC 8785 form of the card without `signatures`.

## What a signature does and does not say

A valid signature says: *the holder of this key wrote exactly these bytes.* It does **not** say the key is the shop's. Which key a shop may
use is the reader's decision: a directory **pins the first key it saw** for a shop page and holds back a feed signed with another key
(see `modules/discovery/`, "Keys"). `verifyDocument(doc, pinnedKey)` therefore also refuses a feed that carries a different key than the pinned one.

## Security notes

- The private key is text (`privateText`, PKCS#8 DER base64url). The caller keeps it where it keeps secrets. A shop's runtime keeps its key in its own database (`modules/runtime/shop-key.ts`, so it is in the shop's backup) and signs there; the directory keeps its own in a 0600 file in its own folder. Anyone who reads
  it can sign as the shop. Nothing in this module writes it anywhere.
- Checking never throws on bad input: a malformed key, a short signature, a non-canonical base64url form or a value with no canonical form all return "not valid".
- No key rotation yet: see "Not built".

## Use it

```ts
import { generateSigningKey, signFeed, verifyDocument, privateText, signingKeyFromText } from "../signing/index.ts";

const key = generateSigningKey();                 // once, then keep privateText(key) in the shop's own folder
const feed = signFeed({ format: "shop-feed/1", items: [] }, key);
verifyDocument(feed);                             // { ok: true, keyId }   (first sight: uses the key inside)
verifyDocument(feed, pinnedPublicKey);            // checks against the key you already hold
const again = signingKeyFromText(privateText(key));
```

## Test

```
cd modules && node --test signing/test/signing.test.ts
```

The tests include the RFC 8785 examples (its section 3.2.3 sorting data and Appendix C's record), so the writer is checked against the specification.

## Extend

A new signed record gets a function pair in `sign.ts` that signs "the record without its signature" through `signValue`. Do not write a second
way to turn a value into bytes.

## Not built

- **Key rotation signed by the old key.** A shop that loses its folder gets a new key; a directory then holds its items and lists the change for a
  person (see `modules/Deferred.md`).
- **Floats.** On purpose: the formats have none.
- **Other algorithms.** Ed25519 only.
