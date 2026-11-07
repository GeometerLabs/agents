# Example agents

Fourteen small agents that take consequential actions and are built to act correctly. [Geometer](https://geometer.dev) checks each one against simulated services; you can take one and use it as it is, with your own model key and your own services. They are grouped by domain, one folder each: `examples/<domain>/<name>`. Each has its rules in plain words, one-line mistakes to apply (`broken/`), and a prompt for your coding assistant, all in its own README. These are not the templates people deploy: those are in [../templates/](../templates/README.md).

Try one: `cd examples/payments/refund-desk`, then `geo check .`, then `../../../scripts/try-broken.sh refund-desk skips-approval` (the name is enough; the script finds the folder). The root [README](../README.md) says what `geo check` does. What the checks do not cover is in [../LIMITS.md](../LIMITS.md).

| Folder | Agent | What it does, in one line |
| --- | --- | --- |
| `payments/` | [refund-desk](payments/refund-desk) | Refunds orders once, with an idempotency key and a look-up before any retry; large refunds wait for a person |
| | [lending](payments/lending) | Disburses an approved loan once per application, to the verified account only |
| | [claims](payments/claims) | Pays out an insurance claim at most once; an adjuster approves big ones |
| | [creator-payouts](payments/creator-payouts) | Pays creators what they are owed, once per period, to their registered account only |
| | [purchasing](payments/purchasing) | Buys supplies within a buyer's mandate, one order per request |
| `commerce/` | [item-shop](commerce/item-shop) | Restores lost items once per ticket and sells items for gems; the ticket decides who gets the item |
| | [booking-change](commerce/booking-change) | Moves a traveller to another seat and charges the fee, once, even when a reply is lost |
| `support/` | [support-compensation](support/support-compensation) | Makes a customer whole with a credit or a refund for a ticket, never both |
| | [access-grants](support/access-grants) | Grants a role on request, once; admin roles need approval |
| `games/` | [game-director](games/game-director) | An AI director that spawns resources and adjusts shop prices in a small world economy, each event once, prices within bounds |
| | [game-master](games/game-master) | An AI game master that rewards quest completions in a small economy, once per completion |
| | [liveops-compensation](games/liveops-compensation) | After a server crash eats a raid loadout, restores the items or currency per ticket; big ones wait for a game master |
| | [streamer-giveaways](games/streamer-giveaways) | An AI streamer that gives viewers promo codes from approved campaigns, one per viewer, never an operator tool |
| `science/` | [lab-protocol](science/lab-protocol) | Runs a protocol step on a sample once; a scientist approves discards |
