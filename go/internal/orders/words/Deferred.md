# words: what was left, and why

- **intentFromReply** (a tap becomes an Intent) is the Orders runtime's (another helper's piece); the ids it reads are here (`ButtonID`, `ItemRowID`, `SlotRowID`).
- **Image headers** on WhatsApp templates: no Orders template has one (the generator refuses one if added, as Bookings does), so the submissions write a body only.
- **Whole rupees only**: `MessageFacts` amounts are `*int64`. The Orders settings and records are whole rupees; the owner-mark button takes a float because a UPI amount may have paise.
- **Hindi, Malayalam and Kannada** are the TypeScript's machine-written words; they carry the same "a native speaker must read them" note (REVIEW sheets) and are not changed here.
- **The order of the listed template ids** (`TemplateIDs`) is a map's: the TypeScript's own order is kept only for the WhatsApp templates (`MetaTemplates`).
