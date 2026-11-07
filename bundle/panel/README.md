# Geometer panel

One open panel, two ways to run it: a builder runs it beside their shops (`PANEL_MODE=own`), and Geometer runs the same one for the partners' shops (`PANEL_MODE=hosted`, which will not start without `PANEL_DATA_KEY_FILE`).
Start it with `PANEL_SERVER_DIR=<server folder> node bundle/panel/main.ts`; make an invitation with `... main.ts invite --role partner`. Plain HTML pages, no JavaScript, no dependencies; tests: `cd bundle/panel && node --test test/`.
It writes desired state (`shops/<shop>/`), secrets (`secrets-inbox/`) and a stop request, and reads `status/<shop>.json` and each runtime's `/status`; it never has the Docker socket. The file shapes are in `contract.ts`, the settings in `config.ts`.
Words are in English, Hindi, Malayalam and Kannada (`words*.ts`); the last three are machine-written, marked as such, and listed in section 7 of `templates/commerce/bookings/REVIEW-ml.md` and `REVIEW-kn.md`.
Also: the "To do" tab (`PANEL_APPROVAL_WAIT_HOURS`, default 12, is how long an owner's answer may wait), a shop's download (`/shops/<shop>/export`) and "Move this shop" (`/shops/<shop>/handover`); `main.ts export <shop> --json` is what `geometer export` asks the panel container for.
The monthly cost line uses `../prices/<date>.json`, a dated price list that is never edited after it is committed. More in `Explanation.md` and `Deferred.md`.
