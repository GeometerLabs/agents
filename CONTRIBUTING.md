# Contributing

Everything in this repository is free to use, change and share under the [Apache-2.0 licence](LICENSE): the pathways, their modules, language packs and sell guides, and the example agents. Contributions are welcome. By sending one you agree it is licensed under Apache-2.0 too (section 5 of the licence).

## What helps most right now

| Contribution | Why it matters |
| --- | --- |
| **A native speaker's review** of the Hindi, Malayalam or Kannada wording | The customer messages, the owner's report and the sell guides are machine-written until a native speaker checks them. Fill in the reviewer column of [REVIEW-ml.md](pathways/bookings/REVIEW-ml.md) or [REVIEW-kn.md](pathways/bookings/REVIEW-kn.md), or open an issue for Hindi. |
| **A language pack** for a pathway (Tamil, Telugu, Bengali, Marathi…) | Shops serve customers in their own language. A pack is the message templates, the date and time words, and the outgoing check (`pathways/bookings/src/language/`). |
| **A crash-test situation** that the hand check doesn't cover yet | The hand check prints what it doesn't test. Turning a line of that list into a situation is the most direct way to make an agent more trustworthy. |
| **A sell guide translation**, or a better answer to a question shop owners actually ask | The people who sell these agents are local. A guide in their language is what gets a shop live. |
| **A new pathway or module** | One consequential job, done carefully. See below. |

## What a pathway must have

A pathway is a complete agent for one consequential job, such as bookings with a deposit. To be accepted it needs:

1. **Settings, not code, for each business:** prices, hours, limits and languages in a settings file a builder fills in.
2. **Limits in plain words**, checked in code before every action, and each one recorded when it decides.
3. **"Done" judged from the services' own records**, never from what the agent said. A write is followed by a read-back.
4. **Messages rendered from the record:** amounts, dates and times come from fixed per-language templates, never from a model.
5. **A record of every action**, with customer message content kept only as a digest.
6. **Crash-test situations and a hand check** that prints "Held N of M", what failed and what wasn't tested.
7. **A sell guide in every language the pathway speaks**, following [pathways/SELL-GUIDE.md](pathways/SELL-GUIDE.md).
8. **Tests that run with `node --test`**, no dependencies, and an `Explanation.md` and `Deferred.md` that say what was built and what wasn't.

[pathways/bookings](pathways/bookings) is the worked example.

## Rules every contribution follows

- **Never say "safe", "guaranteed" or anything like it**, in any language. Say what was checked and what wasn't.
- **No earnings claims.** A sell guide may say how the money flows (the shop pays you, you set your price). It must never say how much anyone will make.
- **No keys, tokens or customer data** in the repository, its tests or its examples.
- **Keep the not-tested list honest.** If you add a situation, remove its line. If you find a gap, add one.

## How to send a contribution

1. Fork the repository and make a branch.
2. Run the tests in the pathway you changed (`npm test` in its folder) and its hand check, if it has one.
3. Open a pull request. Paste the hand check's result line, and say what you changed and what you didn't test.

A contribution is merged when its checks pass and a maintainer has read it. A pathway is listed on [geometer.dev](https://geometer.dev) only after a real business has used it and its record has been measured.
