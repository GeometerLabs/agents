# internal/stock: not done, and why

* `ownerRows`' and `lowLines`' callers outside the Stock page (the morning line's "running low" count is the runtime's own loop over `Lines`, as before).
* A count per day or per place, importing counts, barcode scanning: not built in TypeScript either (`modules/Deferred.md`).
