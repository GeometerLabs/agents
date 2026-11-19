// Date.parse for the ISO forms (moved here from internal/access with ParseJSDate, which the directory now shares): what V8 reads, and what it calls NaN.
package language

import (
	"testing"
	"time"
)

func TestParseJSDateReadsWhatV8Reads(t *testing.T) {
	// each value is what Node 26's Date.parse gave for the same text (the date-only and Z forms do not depend on the zone)
	for text, want := range map[string]int64{
		"2026-11-19T04:00:00.000Z": 1795060800000, "2026-11-19": 1795046400000, "2026-11": 1793491200000, "2026": 1767225600000,
		"2026-02-30": 1772409600000, "2026-11-19T04:00Z": 1795060800000, "2026-11-19T04:00:00.123456Z": 1795060800123, "2026-11-19T04:00:00.1Z": 1795060800100,
		"2026-11-19T24:00:00Z": 1795132800000, "2026-11-19t04:00:00z": 1795060800000, "2026-11-19 04:00:00Z": 1795060800000, "+002026-11-19T04:00:00Z": 1795060800000,
		"2026-11-19T04:00:00+05:30": 1795041000000, "2026-11-19T04:00:00+0530": 1795041000000, "2026-11-31T00:00:00Z": 1796083200000,
	} {
		if got, ok := ParseJSDate(text); !ok || got != want {
			t.Errorf("%q: %d %v, want %d", text, got, ok, want)
		}
	}
	for _, text := range []string{"2026-11-19T24:00:01Z", "2026-13-01", "2026-11-19T04:60:00Z", "2026-11-19T04:00:00.Z", "2026-11-19T4:00:00Z", "-000000-01-01T00:00:00Z", "+999999-01-01T00:00:00Z", "", "soon"} {
		if got, ok := ParseJSDate(text); ok {
			t.Errorf("%q read as %d; Date.parse says NaN", text, got)
		}
	}
	// a date and a time with no offset is the machine's local time, as in JavaScript
	was := time.Local
	time.Local = time.FixedZone("IST", 5*3600+1800)
	defer func() { time.Local = was }()
	if got, _ := ParseJSDate("2026-11-19T04:00:00"); got != 1795041000000 {
		t.Errorf("local time: %d", got)
	}
}
