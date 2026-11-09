# Explanation: the record, its ledger and its daily fingerprint

`record.ts` is the agent's action record: what it did, tried or was stopped from doing. This folder now also turns that record into a **hash-chained ledger anyone can check** (plan B28) and publishes its **daily fingerprint**.

## The ledger is geometer-verify's own format (`ledger.ts`)

The open verifier (`geo-verify`, the geometer-verify repository, Apache-2.0) reads an evidence pack (`geometer.evidence-pack` version 1) and an anchor. This folder writes exactly that, **without any change to geometer-verify**: its `LedgerEntry` takes any `body_type` and any `body` string, and its classical checkpoints are Ed25519, which `node:crypto` signs.

| Piece | What it is | The bytes |
| --- | --- | --- |
| Entry | one record entry, same number (record seq N is ledger seq N) | `sha256("geo-ledger/1\n" + canonical JSON with hash = 64 zeros)`; `prev` is the entry before's hash, absent on entry 1 |
| Key log | one `genesis` event for the shop's signing key | hash `sha256("geo-keylog/1\n" + bytes with sigs [] and hash zeroed)`; signed `Ed25519("geo-keyevent/1\n" + the same bytes)` |
| Checkpoint | "at entry N the head was H", version 1 | `Ed25519("geo-checkpoint/1\n" + canonical JSON with sig "")` |
| Anchor | the checkpoint, the public key and the key-log head | kept somewhere the shop cannot rewrite; `geo-verify pack.json --anchor anchor.json` |

geometer-verify's encoding rules are followed to the letter: canonical JSON (keys sorted, no spaces), `u32` fields (`v`) as JSON numbers and `u64` fields (`seq`, `at_ms`, `count`, `key_log_seq`, `generated_ms`, `from_seq`, `to_seq`) as decimal **strings**, absent optional fields with **no key at all** (`canonicalJson` would write `undefined` as `null`, which the strict decoder refuses, so the ledger's own writer throws on an undefined value or a lone surrogate before it writes anything), `sha256:` digests, `key:` ids, the coverage view with all seven lists.

**How we know it is the same format.** `test/ledger.test.ts` hashes two entries of geometer-verify's own fixture (`crates/geo-verify/tests/fixtures/profile/pack.json`) and gets the hashes it wrote, and verifies the fixture's checkpoint signature over the bytes made here. Then, with the binary built from that repository (`GEO_VERIFY_BIN`), it runs `geo-verify` itself on a pack made here: verified 1 to N against the anchor (the JSON report's `verified` range is checked, not only the exit code, because an older anchor also gives exit 0 with the rest listed as unverifiable), INVALID (1) when one body is edited, UNVERIFIABLE (3) with no anchor, INVALID (1) when the pack is cut short below the anchor, and INVALID (1) with an anchor signed by another key.

**Kinds.** geometer-verify keeps kinds apart: `guard_decision` (what a policy decided), `provider_receipt` (the provider's own confirmation), `approval` (a person's decision). The agent's record is the agent's own account, so it does not claim to be Guard's or a provider's: every entry is `observed_fact`, except the owner's decision (`owner_decision`), which is `approval`. Guard's decisions and the services' own records are theirs to write; the `coverage` notes of every pack say so.

**What an entry's body holds, and what it leaves out.** `body_type` is `geometer.agent-record-entry/1`; the body is the canonical JSON of the entry's own fields **except three**: `conversation` (a customer's number), `notes` (free text, which names a child in a Fees record) and `refs.page` (the secret random folder a report page is served from). Two reasons:

1. **One head for the shop's database and for the bundle's export.** The export hides the number and scrubs names from notes; with those fields out of the chain, the head worked out from either is the same. So the panel can anchor a paper it makes from the export, and the daily fingerprint (made from the shop's own database) matches it. A test in `bundle/test/fees-shop.test.ts` exports a Fees record whose notes name students and checks the three heads agree.
2. **A pack can be handed to an auditor or a payment provider's dispute desk** with no phone number, no name and no secret in it. Two chained fields used to give a person away: the digest of the inputs (for a message, the customer's words, testable by guessing) and a WhatsApp message id (which can carry the sender's number). Since B69 a live runtime writes them with the shop's record key, so what is chained is a keyed digest and a fingerprint (`modules/record/fingerprint.ts`); an older entry keeps the form it was written in, and the export counts how many.

The cost: **those three fields are not chained**. Changing a note, or which number an entry was for, does not change a hash. Everything else is: the time, the action, the outcome, the case id, the fingerprint of the inputs, the limits' decisions and reasons, the language, and every service id and amount in `refs`. Deferred.md says how the number could be chained without being shown (geometer-verify's salted payload commitment).

**The tenant is part of every hash.** geometer-verify's entries name their tenant, and it is hashed. So one shop must always use the same tenant: on a server it is the shop's id (the bundle passes it everywhere: the export job, the daily fingerprint, `report.tenant` in runtime.json, the panel); a template script takes `--tenant` and otherwise uses a slug of the shop's name (`tenantOf`). Two different tenants give two different heads for the same record.

**Deterministic signed parts.** Ed25519 signatures are deterministic, the genesis event's time is the first entry's, and the checkpoint's time is the last entry's. So the same head always gives the same anchor, byte for byte, and an anchor saved a month ago still finds the same key-log head in today's pack.

## The daily fingerprint (`publish.ts`)

Each day, one line per shop: the day, the time, the tenant, the entry count and the head, the signed anchor when the caller had the key, and the sha256 of the line before it. It is appended to a local file that is only ever added to; reading it back refuses a file where a line was edited or removed.

Before anything is appended, the hash the ledger has **now** at the last published entry is compared with what was published. If the record was rewritten, or entries were removed, after a fingerprint went out, nothing is written and the result is an alert: the fingerprint is never moved to fit the record.

**Outside targets are off.** A git repository (the line is added to `fingerprints/<tenant>.jsonl` there, committed, and pushed to the remote the working copy already has) and OpenTimestamps calendars (the line's 32-byte sha256 is sent; the calendar's answer is kept beside the log as `<day>-<tenant>.ots`). Each needs `enabled: true` **and** the owner's yes recorded (`yes: { by, at }`); without both, nothing leaves the machine and the result says which target waits for the yes. They run through a command runner and a fetch the caller hands in, and the tests run them against a local bare repository and a local calendar server only. No blockchain, token or wallet is involved here; an OpenTimestamps calendar is a free public service that does that part on its own side.

What a published line shows anyone who kept it: that on that day the shop's record had N entries and this head. Not what any entry says. It does name the shop's id and how many entries its record has, which is a rough measure of how busy the shop is; Deferred.md has that.

## Size

`ledger.ts` 197 lines, `publish.ts` 145; their tests 300. No dependencies; `node:crypto` only.
