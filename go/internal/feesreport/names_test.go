// The vector that students' names never leave the centre as themselves (the owner's rule): every case's settings and record NAME students (the settings list them, the record's notes say
// "the fee for Rohan Mehta, 2026-11, is open"), and nothing this package makes from them may hold a name or a parent's number: not the signed report file, not the page in any
// language, not the owner's text, not the WhatsApp message or its template parameters, not the files written to disk. The test is not vacuous: it first checks that the inputs DO hold
// the names (settings and notes), and that the same scan finds a name when one is put in.
package feesreport

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// words are the parts of a name worth looking for: each word of four letters or more ("Rohan", "Mehta"), and the whole name.
func nameParts(names []string) []string {
	var out []string
	for _, n := range names {
		out = append(out, n)
		for _, w := range strings.Fields(n) {
			if len([]rune(w)) >= 4 {
				out = append(out, w)
			}
		}
	}
	return out
}

func holds(text string, needles []string) string {
	for _, n := range needles {
		if strings.Contains(text, n) {
			return n
		}
	}
	return ""
}

func TestNoStudentNameInAnythingTheReportMakes(t *testing.T) {
	v := vecs(t)
	checkedCases, withNotes := 0, 0
	for i := range v.Cases {
		c := &v.Cases[i]
		if c.Error != "" || len(c.People.Names) == 0 {
			continue
		}
		needles := append(nameParts(c.People.Names), c.People.Numbers...)
		entries := v.entriesOf(t, c.Entries)
		// not vacuous: the record's notes name the students of the busy month
		for _, e := range entries {
			if holds(e.Notes, nameParts(c.People.Names)) != "" {
				withNotes++
				break
			}
		}
		doc, err := BuildFeesReport(c.input(entries))
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		sealed := SealReport(doc, testKey())
		made := map[string]string{"the report file": report.EnvelopeFile(sealed.Envelope)}
		check, err := report.SummaryLinkFor(sealed.Envelope, ReportSummaryFields(doc), testKey())
		if err != nil {
			t.Fatal(err)
		}
		made["the summary link"] = check
		for _, lang := range []string{"en", "hi", "ml", "kn", "both"} {
			page, err := ReportPage(sealed, lang, check)
			if err != nil {
				t.Fatal(err)
			}
			made["the page ("+lang+")"] = page
		}
		for _, lang := range []string{"en", "hi", "ml", "kn"} {
			made["the owner's text ("+lang+")"] = OwnerText(doc, lang)
			if c.PreparedBy == nil || strings.TrimSpace(*c.PreparedBy) == "" {
				continue
			}
			msg, err := MonthlyReportMessage(sealed, lang, "https://reports.example.com/r/x/report.html", check)
			if err != nil {
				t.Fatal(err)
			}
			made["the message ("+lang+")"] = msg.Text + "\n" + strings.Join(msg.Template.Parameters, "\n")
		}
		for what, text := range made {
			if n := holds(text, needles); n != "" {
				t.Errorf("%s: %s names a student or a parent's number (%q)", c.Name, what, n)
			}
		}
		checkedCases++
	}
	if checkedCases < 30 || withNotes < 5 {
		t.Fatalf("the vector is thin: %d cases checked, %d with students named in the notes", checkedCases, withNotes)
	}
}

// TestTheScanFindsAName proves the scan above is not blind: a name put into a page, a message or a file is found.
func TestTheScanFindsAName(t *testing.T) {
	if holds("the fee for Rohan Mehta is open", nameParts([]string{"Rohan Mehta"})) == "" {
		t.Fatal("the scan does not find a name")
	}
	if holds("+919844444444", []string{"+919844444444"}) == "" {
		t.Fatal("the scan does not find a number")
	}
}

func TestFilesOnDiskNameNoStudent(t *testing.T) {
	v := vecs(t)
	c := &v.Cases[0] // the busy month: the record's notes name every student
	out := filepath.Join(t.TempDir(), "report")
	run := Run{Settings: c.Settings, Entries: v.entriesOf(t, c.Entries), Dues: duesOf(c.Dues), Month: "2026-11", Language: "both", Out: out, Source: c.Source, PreparedBy: c.PreparedBy,
		Innovator: c.Innovator, GoLive: finding(c.GoLive), Now: c.MadeAt, Key: testKey(), Tenant: "bright"}
	if _, err := WriteFeesReport(run); err != nil {
		t.Fatal(err)
	}
	needles := append(nameParts(c.People.Names), c.People.Numbers...)
	files, _ := os.ReadDir(out)
	if len(files) < 4 {
		t.Fatalf("only %d files written", len(files))
	}
	for _, f := range files {
		raw, _ := os.ReadFile(filepath.Join(out, f.Name()))
		if n := holds(string(raw), needles); n != "" {
			t.Errorf("%s names a student or a parent's number (%q)", f.Name(), n)
		}
	}
}

// TestEntryDigestLeavesOutTheNoteAndTheNumber holds the two members a digest of the record must not carry: the parent's number (`conversation`) and the note, which can name a child
// (Fees' entryDigest is the stricter of the three templates').
func TestEntryDigestLeavesOutTheNoteAndTheNumber(t *testing.T) {
	booking := "f-1"
	a := accounting.Entry{Seq: 1, Time: "2026-11-02T05:00:00.000Z", Conversation: "919811111111", Booking: &booking, Action: "open_fee", Outcome: "confirmed", Notes: "the fee for Rohan Mehta is open", Refs: map[string]string{"month": "2026-11"}}
	b := a
	b.Conversation, b.Notes = "919822222222", "another note"
	if EntryDigest(a) != EntryDigest(b) {
		t.Error("the digest carries the parent's number or the note")
	}
	b.Refs = map[string]string{"month": "2026-12"}
	if EntryDigest(a) == EntryDigest(b) {
		t.Error("the digest ignores a ref")
	}
}
