# Contributing

Everything in this repository is free to use, change and share under the [Apache-2.0 licence](LICENSE): the templates, their modules, language packs and sell guides, and the example agents. Contributions are welcome. By sending one you agree it is licensed under Apache-2.0 too (section 5 of the licence).

## What helps most right now

| Contribution | Why it matters |
| --- | --- |
| **A native speaker's review** of the Hindi, Malayalam or Kannada wording | The customer messages, the owner's report and the sell guides are machine-written until a native speaker checks them. Fill in the reviewer column of [REVIEW-ml.md](templates/commerce/bookings/REVIEW-ml.md) or [REVIEW-kn.md](templates/commerce/bookings/REVIEW-kn.md), or open an issue for Hindi. |
| **A language pack** for a template (Tamil, Telugu, Bengali, Marathi…) | Shops serve customers in their own language. A pack is the message templates, the date and time words, and the outgoing check (`templates/commerce/bookings/src/language/`). |
| **A crash-test situation** that the hand check doesn't cover yet | The hand check prints what it doesn't test. Turning a line of that list into a situation is the most direct way to make an agent more trustworthy. |
| **A sell guide translation**, or a better answer to a question shop owners actually ask | The people who sell these agents are local. A guide in their language is what gets a shop live. |
| **A new template or module** | One consequential job, done carefully. See below. |
| **Comments on a planned community template** | Self-help group savings, community and committee funds, and meeting follow-through are specs, not code. If you know such a group, tell us where the spec is wrong: [templates/community](templates/community/README.md), in GitHub Discussions. |

## What a template must have

A template is a complete agent for one consequential job, such as bookings with a deposit. It lives in `templates/<domain>/<name>` (for example `templates/commerce/bookings`); put it in the domain folder it belongs to, and say in the pull request if it needs a new one. To be accepted it needs:

1. **Settings, not code, for each business:** prices, hours, limits and languages in a settings file a builder fills in.
2. **Limits in plain words**, checked in code before every action, and each one recorded when it decides.
3. **"Done" judged from the services' own records**, never from what the agent said. A write is followed by a read-back.
4. **Messages rendered from the record:** amounts, dates and times come from fixed per-language templates, never from a model.
5. **A record of every action**, with customer message content kept only as a digest.
6. **Crash-test situations and a hand check** that prints "Held N of M", what failed and what wasn't tested.
7. **A sell guide in every language the template speaks**, following [templates/SELL-GUIDE.md](templates/SELL-GUIDE.md).
8. **Tests that run with `node --test`**, no dependencies, and an `Explanation.md` and `Deferred.md` that say what was built and what wasn't.

[templates/commerce/bookings](templates/commerce/bookings) is the worked example. An example agent for Geometer to check (a small agent with its rules and a one-line mistake) is not a template: it goes in `examples/<domain>/<name>`, see [examples/README.md](examples/README.md).

**A new kind of customer for a template that exists** (for example equipment rental on Bookings) is not a new template. Add a settings example, run the hand check on it (`node templates/commerce/bookings/scripts/hand-check.ts --settings <your file>`), and write a **variant** sell guide that covers only what differs (see "Variants" in [templates/SELL-GUIDE.md](templates/SELL-GUIDE.md)). List what the template can't do for that customer in the template's `Deferred.md`.

**Community and village templates.** Anything that handles money or records that many people share (a savings group, a fund, a committee) must also: never hold, pool, lend or move money itself; judge "paid" from the provider's record, or from a named person's marked entry labelled as such; give every member a statement of their own entries; keep a member's detail private from other members; and name the laws to check (chit funds, money lending, data protection) with "get legal review before launch". The specs in [templates/community](templates/community/README.md) show the shape.

## Rules every contribution follows

- **Never say "safe", "guaranteed" or anything like it**, in any language. Say what was checked and what wasn't.
- **No earnings claims.** A sell guide may say how the money flows (the shop pays you, you set your price). It must never say how much anyone will make.
- **No keys, tokens or customer data** in the repository, its tests or its examples.
- **Keep the not-tested list honest.** If you add a situation, remove its line. If you find a gap, add one.

## How to send a contribution

1. Fork the repository and make a branch.
2. Run the tests in the template you changed (`npm test` in its folder) and its hand check, if it has one. A price is changed only in `prices/`, as a new dated file: then run `node prices/render.ts` and `npm test` in `prices/`.
3. Open a pull request. Paste the hand check's result line, and say what you changed and what you didn't test.

A contribution is merged when its checks pass and a maintainer has read it. A template is listed on [geometer.dev](https://geometer.dev) only after a real business has used it and its record has been measured.
