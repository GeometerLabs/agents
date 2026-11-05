# Templates

A **template** is a ready, tested agent for one job a local business already pays for, tailored by a settings file. People deploy these (with the [deploy bundle](../bundle/README.md)); the example agents Geometer checks are in [../examples/](../examples/README.md). Templates are grouped by domain, one folder each: `templates/<domain>/<name>`. The name is also the pin a shop holds, for example `bookings@0.1.0` in its `pathway.lock`.

| Folder | What it is |
| --- | --- |
| [commerce/bookings](commerce/bookings/README.md) | Bookings with a deposit on WhatsApp (salons, studios, home services; also village equipment hiring as a variant). Built and checked against stand-in services; no business is live |
| [education/fees](education/fees/README.md) | Monthly fee reminders with a payment link, sent to parents of a tuition or coaching centre's students. Built and checked against stand-in services; no centre is live |
| [community/](community/README.md) | Specs for village and group templates: [self-help-group](community/self-help-group/README.md), [community-fund](community/community-fund/README.md), [meeting-follow-through](community/meeting-follow-through/README.md). Not runnable: nothing here has been built |

[SELL-GUIDE.md](SELL-GUIDE.md) is the spec every template follows for its guide to pitching and selling it locally; a template is not ready to sell until its guide is. How to add a template is in [../CONTRIBUTING.md](../CONTRIBUTING.md). The features templates share are in [../modules/](../modules/README.md).

Each built template has the same shape: `package.json` (its version is the version a shop is pinned to), `README.md`, `Explanation.md`, `Deferred.md`, the `settings/` examples, `src/`, `crash-test/`, `report/`, `sell/` and `test/`; a template the panel can set up also has a `template.json`. Run its tests with `node --test test/` in its folder.
