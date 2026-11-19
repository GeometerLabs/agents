// What the books and the monthly report need of the shop's record: its entries to read, and (for the two jobs that write) a way to append one. The record itself is the
// runtime's (internal/runtime keeps and chains it; internal/store holds the rows); this file names only the two small things this package family asks of it, so the Bookings
// runtime hands in an adapter and the books know nothing of how the record is stored. An entry is internal/store's, the same JSON the TypeScript record writes.
package accounting

import "github.com/GeometerLabs/agents/go/internal/store"

// Entry is one line of the record (modules/record/record.ts RecordEntry), read only. Booking is nil for a line that belongs to no case; Refs is chained and never nil.
type Entry = store.Entry

// NewEntry is record.ts NewEntry: what a caller supplies; the record adds the sequence number, the time and the digest. Inputs is digested and never stored.
type NewEntry struct {
	Conversation string
	Booking      *string
	Action       string
	Inputs       any
	Outcome      string
	Language     string
	Notes        string
	Refs         map[string]string
}

// Record is record.ts ActionRecord as the books use it: Entries is the whole record, oldest first, and Append adds one line (the settlements job and the monthly job write).
type Record interface {
	Entries() []Entry
	Append(NewEntry) Entry
}

// Reader is the read-only side (record.ts RecordView's entries), which is all the journal and the accountant's files need.
type Reader interface{ Entries() []Entry }
