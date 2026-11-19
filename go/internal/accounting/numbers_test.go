// Tests of numbers, periods, accounts and the JavaScript number helpers against what the TypeScript gives (testdata/numbers.json), and of JSNumber / JSNumberString on their own.
package accounting

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

type numVectors struct {
	FY []struct {
		TZ    string `json:"tz"`
		Ms    int64  `json:"ms"`
		FY    string `json:"fy"`
		Start int64  `json:"start"`
	} `json:"fy"`
	Formats []struct {
		In struct {
			Series string
			FY     string  `json:"fy"`
			N      float64 `json:"n"`
		} `json:"in"`
		Out outcome[string] `json:"out"`
	} `json:"formats"`
	Parses []struct {
		Text string          `json:"text"`
		Out  json.RawMessage `json:"out"`
	} `json:"parses"`
	Periods []struct {
		TZ     string          `json:"tz"`
		Period string          `json:"period"`
		Range  json.RawMessage `json:"range"`
	} `json:"periods"`
	Days []struct {
		TZ    string `json:"tz"`
		Ms    int64  `json:"ms"`
		Day   Range  `json:"day"`
		Month string `json:"month"`
	} `json:"days"`
	Months []struct {
		TZ    string `json:"tz"`
		Y, M  int
		Range Range `json:"range"`
	} `json:"months"`
	Previous []struct{ P, Out string } `json:"previous"`
	Export   []struct {
		P   string                                      `json:"p"`
		Out struct{ ThisMonth, LastMonth, Year string } `json:"out"`
	} `json:"exportPeriods"`
	NextRecord []struct {
		Seq    int     `json:"seq"`
		Time   string  `json:"time"`
		Action string  `json:"action"`
		Doc    *string `json:"doc"`
	} `json:"nextRecord"`
	Next []struct {
		UpTo   int    `json:"upTo"`
		Series string `json:"series"`
		FY     string `json:"fy"`
		Next   struct {
			Series string `json:"series"`
			FY     string `json:"fy"`
			N      int64  `json:"n"`
		} `json:"next"`
	} `json:"next"`
	JS []struct {
		Text      string `json:"text"`
		Str       string `json:"str"`
		NegZero   bool   `json:"negZero"`
		Safe      bool   `json:"safe"`
		Canonical bool   `json:"canonical"`
	} `json:"js"`
	Floats []struct {
		F   float64 `json:"f"`
		Str string  `json:"str"`
	} `json:"floats"`
	Rounds []struct {
		Inr float64 `json:"inr"`
		P   float64 `json:"p"`
	} `json:"rounds"`
	Accounts struct {
		Fixed  []struct{ Code, Kind, Accountant string } `json:"fixed"`
		Method map[string]string                         `json:"method"`
		Names  []struct {
			Code  string `json:"code"`
			Is    bool   `json:"is"`
			Name  string `json:"name"`
			Kind  string `json:"kind"`
			Group string `json:"group"`
		} `json:"names"`
		Services []struct {
			S   string          `json:"s"`
			Out outcome[string] `json:"out"`
		} `json:"services"`
	} `json:"accounts"`
}

func TestNumbersAndPeriods(t *testing.T) {
	var v numVectors
	loadVec(t, "numbers", &v)
	for _, c := range v.FY {
		if got := FYOf(c.Ms, c.TZ); got != c.FY {
			t.Errorf("FYOf(%d,%s) = %s, ts %s", c.Ms, c.TZ, got, c.FY)
		}
		if got := FYStartMs(c.FY, c.TZ); got != c.Start {
			t.Errorf("FYStartMs(%s,%s) = %d, ts %d", c.FY, c.TZ, got, c.Start)
		}
	}
	for _, c := range v.Formats {
		got, err := FormatNumber(DocNumber{Series(c.In.Series), c.In.FY, int64(c.In.N)})
		if c.In.N != math.Trunc(c.In.N) {
			continue // a fractional n cannot be an int64; the TypeScript refuses it too (not a safe integer) and the Go type cannot hold it
		}
		switch {
		case c.Out.Error != nil && (err == nil || err.Error() != *c.Out.Error):
			t.Errorf("FormatNumber(%+v) = %q, %v; ts error %q", c.In, got, err, *c.Out.Error)
		case c.Out.Value != nil && (err != nil || got != *c.Out.Value):
			t.Errorf("FormatNumber(%+v) = %q, %v; ts %q", c.In, got, err, *c.Out.Value)
		}
	}
	for _, c := range v.Parses {
		d, ok := ParseNumber(c.Text)
		if string(c.Out) == "null" {
			if ok {
				t.Errorf("ParseNumber(%q) = %+v, ts null", c.Text, d)
			}
			continue
		}
		sameJSON(t, "ParseNumber("+c.Text+")", map[string]any{"series": d.Series, "fy": d.FY, "n": d.N}, c.Out)
	}
	for _, c := range v.Periods {
		r, ok := PeriodRange(c.Period, c.TZ)
		if string(c.Range) == "null" {
			if ok {
				t.Errorf("PeriodRange(%q,%s) = %+v, ts null", c.Period, c.TZ, r)
			}
			continue
		}
		sameJSON(t, "PeriodRange("+c.Period+")", map[string]any{"fromMs": r.FromMs, "toMs": r.ToMs}, c.Range)
	}
	for _, c := range v.Days {
		if got := DayRange(c.Ms, c.TZ); got != c.Day {
			t.Errorf("DayRange(%d,%s) = %+v, ts %+v", c.Ms, c.TZ, got, c.Day)
		}
		if got := MonthPeriodOf(c.Ms, c.TZ); got != c.Month {
			t.Errorf("MonthPeriodOf(%d,%s) = %s, ts %s", c.Ms, c.TZ, got, c.Month)
		}
	}
	for _, c := range v.Months {
		if got := MonthRange(c.Y, c.M, c.TZ); got != c.Range {
			t.Errorf("MonthRange(%d,%d,%s) = %+v, ts %+v", c.Y, c.M, c.TZ, got, c.Range)
		}
	}
	for _, c := range v.Previous {
		if got := PreviousMonth(c.P); got != c.Out {
			t.Errorf("PreviousMonth(%s) = %s, ts %s", c.P, got, c.Out)
		}
	}
	for _, c := range v.Export {
		if got := ExportPeriods(c.P); got != ExportPeriodSet(c.Out) {
			t.Errorf("ExportPeriods(%s) = %+v, ts %+v", c.P, got, c.Out)
		}
	}
	// nextNumber over the record the generator made (its entries, rebuilt here from the vector's own list)
	entries := make([]Entry, len(v.NextRecord))
	for i, e := range v.NextRecord {
		refs := map[string]string{}
		if e.Doc != nil {
			refs["doc"] = *e.Doc
		}
		entries[i] = Entry{Seq: e.Seq, Time: e.Time, Action: e.Action, Refs: refs}
	}
	for _, c := range v.Next {
		got := NextNumber(entries[:c.UpTo], Series(c.Series), c.FY, FYStartMs(c.FY, "Asia/Kolkata"))
		if string(got.Series) != c.Next.Series || got.FY != c.Next.FY || got.N != c.Next.N {
			t.Errorf("NextNumber(%d entries,%s,%s) = %+v, ts %+v", c.UpTo, c.Series, c.FY, got, c.Next)
		}
	}
}

func TestAccounts(t *testing.T) {
	var v numVectors
	loadVec(t, "numbers", &v)
	if len(v.Accounts.Fixed) != len(AllAccounts) {
		t.Fatalf("%d accounts, ts %d", len(AllAccounts), len(v.Accounts.Fixed))
	}
	for i, a := range v.Accounts.Fixed {
		if g := AllAccounts[i]; g.Code != a.Code || string(g.Kind) != a.Kind || g.Accountant != a.Accountant {
			t.Errorf("account %d: go %+v, ts %+v", i, g, a)
		}
	}
	for m, code := range v.Accounts.Method {
		if got := MethodAccount(Method(m)); got != code {
			t.Errorf("MethodAccount(%s) = %s, ts %s", m, got, code)
		}
	}
	for _, c := range v.Accounts.Names {
		if IsAccount(c.Code) != c.Is || AccountantName(c.Code) != c.Name || string(KindOfAccount(c.Code)) != c.Kind || TallyGroupOf(c.Code) != c.Group {
			t.Errorf("code %q: go is=%v name=%q kind=%s group=%s; ts %+v", c.Code, IsAccount(c.Code), AccountantName(c.Code), KindOfAccount(c.Code), TallyGroupOf(c.Code), c)
		}
	}
	for _, c := range v.Accounts.Services {
		got, err := ServiceAccount(c.S)
		switch {
		case c.Out.Error != nil && (err == nil || err.Error() != *c.Out.Error):
			t.Errorf("ServiceAccount(%q) = %q, %v; ts error %q", c.S, got, err, *c.Out.Error)
		case c.Out.Value != nil && (err != nil || got != *c.Out.Value):
			t.Errorf("ServiceAccount(%q) = %q, %v; ts %q", c.S, got, err, *c.Out.Value)
		}
	}
}

// TestJSNumberVectors holds the helpers to what Node prints, over the texts and floats the generator tried (including the toPaise rounding of every k/100 up to 200 rupees).
func TestJSNumberVectors(t *testing.T) {
	var v numVectors
	loadVec(t, "numbers", &v)
	for _, c := range v.JS {
		f := JSNumber(c.Text)
		if got := JSNumberString(f); got != c.Str {
			t.Errorf("String(Number(%q)) = %s, ts %s", c.Text, got, c.Str)
		}
		if got := math.Signbit(f) && f == 0; got != c.NegZero {
			t.Errorf("Number(%q) negative zero = %v, ts %v", c.Text, got, c.NegZero)
		}
		if IsSafeInteger(f) != c.Safe {
			t.Errorf("isSafeInteger(Number(%q)) = %v, ts %v", c.Text, IsSafeInteger(f), c.Safe)
		}
		if _, ok := canonicalInt(c.Text); ok != c.Canonical {
			t.Errorf("canonical(%q) = %v, ts %v", c.Text, ok, c.Canonical)
		}
	}
	for _, c := range v.Floats {
		if got := JSNumberString(c.F); got != c.Str {
			t.Errorf("String(%v) = %s, ts %s", c.F, got, c.Str)
		}
	}
	for _, c := range v.Rounds {
		// the production path (owner-money's toPaise), not a multiplication written in the test: the compiler may fuse a multiply with the next add or subtract unless the product is
		// converted explicitly, and toPaise does that
		if got := toPaise(c.Inr); float64(got) != c.P {
			t.Errorf("Math.round(%v * 100) = %v, ts %v", c.Inr, got, c.P)
		}
	}
}

// TestJSNumber holds StringToNumber and Number::toString to what JavaScript gives for the texts a ref could hold (the expected values are what Node 26 prints; the generator's own vectors
// hold the same on the TypeScript side in testdata/jsnumber.json).
func TestJSNumber(t *testing.T) {
	cases := []struct {
		text string
		want string // String(Number(text))
	}{
		{"", "0"}, {" ", "0"}, {"5", "5"}, {" 5 ", "5"}, {"\t5\n", "5"}, {"+5", "5"}, {"-5", "-5"}, {"05", "5"}, {"5.", "5"}, {".5", "0.5"}, {"1e3", "1000"}, {"1E3", "1000"}, {"1e-3", "0.001"},
		{"0x10", "16"}, {"0X1f", "31"}, {"0o17", "15"}, {"0b101", "5"}, {"+0x10", "NaN"}, {"-0x10", "NaN"}, {"0x", "NaN"}, {"1_000", "NaN"}, {"1,5", "NaN"}, {"abc", "NaN"}, {"1e", "NaN"},
		{"Infinity", "Infinity"}, {"-Infinity", "-Infinity"}, {"+Infinity", "Infinity"}, {"infinity", "NaN"}, {"1e999", "Infinity"}, {"-0", "0"}, {"1.5", "1.5"}, {"9007199254740993", "9007199254740992"},
		{"123456789012345678901", "123456789012345680000"}, {"1e21", "1e+21"}, {"1.5e300", "1.5e+300"}, {"1e-7", "1e-7"}, {"0.000001", "0.000001"}, {"\u00a05\u00a0", "5"}, {"5 5", "NaN"}, {"٥", "NaN"},
	}
	for _, c := range cases {
		if got := JSNumberString(JSNumber(c.text)); got != c.want {
			t.Errorf("String(Number(%q)) = %s, want %s", c.text, got, c.want)
		}
	}
	for _, c := range []struct {
		f    float64
		want string
	}{{1e21, "1e+21"}, {123e-20, "1.23e-18"}, {100, "100"}, {5e-324, "5e-324"}, {1.7976931348623157e308, "1.7976931348623157e+308"}, {-1.5, "-1.5"}, {1234567890123456800000, "1.2345678901234568e+21"}} {
		if got := JSNumberString(c.f); got != c.want {
			t.Errorf("String(%v) = %s, want %s", c.f, got, c.want)
		}
	}
	for _, c := range []struct {
		text string
		n    int64
		ok   bool
	}{{"5", 5, true}, {"0", 0, true}, {"05", 0, false}, {" 5", 0, false}, {"+5", 0, false}, {"1e3", 0, false}, {"0x10", 0, false}, {"-0", 0, false}, {"-5", -5, true}, {"9007199254740991", 9007199254740991, true}, {"9007199254740992", 0, false}, {"5.0", 0, false}, {"", 0, false}} {
		n, ok := canonicalInt(c.text)
		if ok != c.ok || (ok && n != c.n) {
			t.Errorf("canonicalInt(%q) = %d, %v; want %d, %v", c.text, n, ok, c.n, c.ok)
		}
	}
	if RoundHalfUp(2.5) != 3 || RoundHalfUp(-2.5) != -2 || RoundHalfUp(0.49999999999999994) != 0 || RoundHalfUp(-0.5) != 0 || RoundHalfUp(1.4999999999999998) != 1 {
		t.Error("RoundHalfUp is not Math.round")
	}
	_ = zone.Date{}
}
