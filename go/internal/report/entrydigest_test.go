// The one record-entry fingerprint every template's report uses (report.EntryDigest): it leaves out the number and the note and holds everything else. The TypeScript side of the same
// rule is each template's report test ("an entry's fingerprint leaves out the number and the note"); the byte-for-byte digests are in each report package's vectors.
package report

import (
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
)

func TestEntryDigestLeavesOutTheNoteAndTheNumber(t *testing.T) {
	booking := "f-1"
	a := accounting.Entry{Seq: 1, Time: "2026-11-02T05:00:00.000Z", Conversation: "919811111111", Booking: &booking, Action: "open_fee", Outcome: "confirmed", Notes: "the fee for Rohan Mehta is open", Refs: map[string]string{"month": "2026-11"}}
	b := a
	b.Conversation, b.Notes = "919822222222", "another note"
	if EntryDigest(a) != EntryDigest(b) {
		t.Error("the digest carries the number or the note")
	}
	b.Notes = ""
	if EntryDigest(a) != EntryDigest(b) {
		t.Error("an empty note changes the digest")
	}
	b.Refs = map[string]string{"month": "2026-12"}
	if EntryDigest(a) == EntryDigest(b) {
		t.Error("the digest ignores a ref")
	}
	b = a
	b.Outcome = "blocked"
	if EntryDigest(a) == EntryDigest(b) {
		t.Error("the digest ignores the outcome")
	}
}
