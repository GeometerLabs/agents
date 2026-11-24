// A parent's page reminder whose private link holds the fee's own reference: the Fees hand check's one-in-a-few-hundred hold (25 Nov 2026). A page link ends in a random
// handle (newHandle, 32 characters of base64url), and about one handle in 4,000 holds "f-5" in some case. The outgoing check masked the record's references before it read the
// links, which cut the record's own link in two: the reminder was held back (message-matches-record) and the owner was told, outside their window, under a template name
// WhatsApp does not have. The check now reads the record's own links whole first (internal/language/check.go); this holds it on the real words in every language.
package fees

import (
	"testing"
	"time"
)

func TestPageReminderWithTheReferenceInsideItsLinkIsNotHeld(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	due := time.Date(2026, 11, 10, 0, 0, 0, 0, loc).UnixMilli()
	for _, lang := range []string{"en", "hi", "ml", "kn"} {
		for _, handle := range []string{"Qm9vbGVhbnNhcmVmdW5ub3RyZWFsbHk1", "Qm9vbGVhbnNhcmVmdW5uF-5yZWFsbHk1", "f-5Vbm5vdHJlYWxseWFzdHJpbmdhYmM"} {
			f := &MessageFacts{
				Language: lang, Loc: loc, BusinessName: "Bright Tuition Centre", StudentName: S("Rohan Mehta"), BatchName: S("Class 10"), MonthLabel: S(monthLabel("2026-11", lang)),
				FeeInr: N(1500), BalanceInr: N(1500), DueMs: N(due), Link: S("https://pay.example/req_5"), DueRef: S("f-5"), CustomerPhone: S("+919844444444"),
				PageLink: S("https://pages.example/hand-check/f/" + handle),
			}
			text, err := Render("fee_reminder_page", f)
			if err != nil {
				t.Fatalf("%s: %v", lang, err)
			}
			if d := matches(text, f); d.Verdict != "allow" {
				t.Errorf("%s, handle %s: %s", lang, handle, d.Reason)
			}
		}
	}
}
