package fees

// The Fees runtime's pure rules held to the TypeScript's (23 Nov 2026, stream FG): go/scripts/gen_fees_vectors.ts runs templates/education/fees on Node (joining.ts feeForMonth and
// parseJoined, due.ts's schedule, limits.ts, classes/rules.ts, settings.ts validateSettings) and writes testdata/rules-vectors.json.gz; each test here runs the Go twin on the same
// input and compares. These are the checks the TypeScript unit tests made (family-and-joining, limits, classes, settings) that must outlive the TypeScript runtime.

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"reflect"
	"testing"
)

type rulesVectors struct {
	Fees []struct {
		Rule    string  `json:"rule"`
		Monthly int64   `json:"monthly"`
		Joined  *string `json:"joined"`
		Year    int     `json:"year"`
		Month   int     `json:"month"`
		Out     struct {
			Owed bool           `json:"owed"`
			Fee  int64          `json:"feeInr"`
			Part map[string]any `json:"part"`
		} `json:"out"`
	} `json:"fees"`
	Joined []struct {
		Text string     `json:"text"`
		Out  *LocalDate `json:"out"`
	} `json:"joined"`
	Schedule []struct {
		Name     string         `json:"name"`
		Settings map[string]any `json:"settings"`
		Dates    []struct {
			Date        LocalDate `json:"date"`
			DueMs       int64     `json:"dueMs"`
			Moments     []int64   `json:"moments"`
			LateFeeFrom int64     `json:"lateFeeFrom"`
		} `json:"dates"`
		BackDue []struct {
			NowMs int64 `json:"nowMs"`
			At    int64 `json:"at"`
		} `json:"backDue"`
	} `json:"schedule"`
	Limits []struct {
		Check string         `json:"check"`
		Input map[string]any `json:"input"`
		Out   Decision       `json:"out"`
	} `json:"limits"`
	Grace []struct {
		Fee       snapJSON `json:"fee"`
		GraceDays int64    `json:"graceDays"`
		NowMs     int64    `json:"nowMs"`
		TZ        string   `json:"tz"`
		Out       bool     `json:"out"`
	} `json:"grace"`
	Access []struct {
		Input struct {
			InBatch         bool       `json:"inBatch"`
			Consent         string     `json:"consent"`
			ReadOK          bool       `json:"readOk"`
			Fees            []snapJSON `json:"fees"`
			GraceDays       int64      `json:"graceDays"`
			OldDuesStopLink bool       `json:"oldDuesStopLink"`
			NowMs           int64      `json:"nowMs"`
			TimeZone        string     `json:"timeZone"`
		} `json:"input"`
		Out Decision `json:"out"`
	} `json:"access"`
	Settings []struct {
		Name    string   `json:"name"`
		Text    string   `json:"text"`
		Errors  []string `json:"errors"`
		Checked *struct {
			JoiningMidMonth string                         `json:"joiningMidMonth"`
			Payment         string                         `json:"payment"`
			Due             struct{ Day, GraceDays int64 } `json:"due"`
			Reminders       struct {
				DaysFromDue []int64 `json:"daysFromDue"`
				Hour        int64   `json:"hour"`
				MaxPerMonth int64   `json:"maxPerMonth"`
			} `json:"reminders"`
			LateFeeInr   int64 `json:"lateFeeInr"`
			WaiverInr    int64 `json:"waiverInr"`
			RefundInr    int64 `json:"refundInr"`
			PartPayments struct {
				Allowed bool  `json:"allowed"`
				MinInr  int64 `json:"minInr"`
			} `json:"partPayments"`
			Students []struct {
				Name     string  `json:"name"`
				Batch    string  `json:"batch"`
				Language *string `json:"language"`
				Joined   *string `json:"joined"`
				BackDues []struct {
					Month     string `json:"month"`
					AmountInr int64  `json:"amountInr"`
				} `json:"backDues"`
			} `json:"students"`
			OldDuesStopLink *bool `json:"oldDuesStopLink"`
			Credit          *struct {
				MaxPerPersonInr int64 `json:"maxPerPersonInr"`
				RemindEveryDays int64 `json:"remindEveryDays"`
				People          []struct {
					Name      string `json:"name"`
					Phone     string `json:"phone"`
					AmountInr int64  `json:"amountInr"`
					Language  string `json:"language"`
				} `json:"people"`
			} `json:"credit"`
		} `json:"checked"`
	} `json:"settings"`
}

// snapJSON is classes/rules.ts FeeSnapshot as JSON.
type snapJSON struct {
	State        string    `json:"state"`
	DueDate      LocalDate `json:"dueDate"`
	BalancePaise int64     `json:"balancePaise"`
	BackDue      bool      `json:"backDue"`
}

func (s snapJSON) snap() feeSnap {
	return feeSnap{state: s.State, due: s.DueDate, balance: s.BalancePaise, backDue: s.BackDue}
}

func loadRulesVectors(t *testing.T) rulesVectors {
	t.Helper()
	packed, err := os.ReadFile("testdata/rules-vectors.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(packed))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	var v rulesVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Fees) == 0 || len(v.Schedule) == 0 || len(v.Limits) == 0 || len(v.Access) == 0 || len(v.Settings) == 0 {
		t.Fatal("the vectors are empty: run node go/scripts/gen_fees_vectors.ts")
	}
	return v
}

// TestMonthFeeIsTheTypeScripts: joining.ts feeForMonth under every rule, joining day and month (whole fee, part month, nothing), and parseJoined.
func TestMonthFeeIsTheTypeScripts(t *testing.T) {
	v := loadRulesVectors(t)
	for _, c := range v.Fees {
		var joined *LocalDate
		if c.Joined != nil {
			y, m, d, ok := ParseJoined(*c.Joined)
			if ok {
				joined = &LocalDate{y, m, d}
			}
		}
		owed, fee, part := feeForMonth(c.Rule, c.Monthly, joined, c.Year, c.Month)
		if owed != c.Out.Owed || (owed && fee != c.Out.Fee) {
			t.Errorf("%s ₹%d joined %v %d-%02d: Go owed=%v ₹%d, TypeScript owed=%v ₹%d", c.Rule, c.Monthly, c.Joined, c.Year, c.Month, owed, fee, c.Out.Owed, c.Out.Fee)
		}
		if got, want := roundTrip(t, part), roundTrip(t, c.Out.Part); !reflect.DeepEqual(got, want) {
			t.Errorf("%s ₹%d joined %v %d-%02d: part %v, TypeScript %v", c.Rule, c.Monthly, c.Joined, c.Year, c.Month, got, want)
		}
	}
	for _, c := range v.Joined {
		y, m, d, ok := ParseJoined(c.Text)
		if ok != (c.Out != nil) || (ok && (LocalDate{y, m, d}) != *c.Out) {
			t.Errorf("parseJoined(%q): Go %v %d-%d-%d, TypeScript %v", c.Text, ok, y, m, d, c.Out)
		}
	}
}

// TestScheduleIsTheTypeScripts: due.ts's schedule on the example centres and others (reminder days and hours, grace days, time zones with a daylight-saving change).
func TestScheduleIsTheTypeScripts(t *testing.T) {
	v := loadRulesVectors(t)
	for _, c := range v.Schedule {
		raw, _ := json.Marshal(c.Settings)
		s, errs := ReadSettings(c.Settings, raw)
		if len(errs) > 0 {
			t.Fatalf("%s: %v", c.Name, errs)
		}
		for _, d := range c.Dates {
			if got := dueMsOf(s, d.Date); got != d.DueMs {
				t.Errorf("%s %v: dueMs %d, TypeScript %d", c.Name, d.Date, got, d.DueMs)
			}
			if got := reminderMomentsOf(s, d.Date); !reflect.DeepEqual(got, d.Moments) {
				t.Errorf("%s %v: reminder moments %v, TypeScript %v", c.Name, d.Date, got, d.Moments)
			}
			if got := lateFeeFrom(s, d.Date); got != d.LateFeeFrom {
				t.Errorf("%s %v: late fee from %d, TypeScript %d", c.Name, d.Date, got, d.LateFeeFrom)
			}
		}
		for _, b := range c.BackDue {
			if got := backDueReminderAt(s, b.NowMs); got != b.At {
				t.Errorf("%s now %d: back due reminded at %d, TypeScript %d", c.Name, b.NowMs, got, b.At)
			}
		}
	}
}

// TestLimitsAreTheTypeScripts: limits.ts's checks, verdicts and words.
func TestLimitsAreTheTypeScripts(t *testing.T) {
	v := loadRulesVectors(t)
	n := func(m map[string]any, k string) int64 { f, _ := m[k].(float64); return int64(f) }
	for _, c := range v.Limits {
		in := c.Input
		var got Decision
		switch c.Check {
		case "feeLink":
			got = checkFeeLink(n(in, "amountInr"), n(in, "balanceInr"), n(in, "highestInr"))
		case "reminderCap":
			got = checkReminderCap(n(in, "sent"), n(in, "maxPerMonth"))
		case "waiver":
			got = checkWaiver(n(in, "amountInr"), n(in, "balanceInr"), n(in, "alreadyWaivedInr"), n(in, "limitInr"), in["ownerApproved"] == true)
		case "oneRefund":
			got = checkOneRefundPerPayment(in["paymentId"].(string), n(in, "refundedPaise"))
		case "refundLimit":
			paid := -1.0 // not given
			if p, ok := in["paidInr"].(float64); ok {
				paid = p
			}
			got = checkRefundLimit(n(in, "amountInr"), n(in, "limitInr"), paid, in["ownerApproved"] == true)
		default:
			t.Fatalf("unknown check %q", c.Check)
		}
		if got != c.Out {
			t.Errorf("%s %v:\n Go         %+v\n TypeScript %+v", c.Check, in, got, c.Out)
		}
	}
}

// TestClassAccessIsTheTypeScripts: classes/rules.ts isPastGrace and checkClassAccess (consent, the batch, an unread record, ordinary fees and back dues with and without
// oldDuesStopLink).
func TestClassAccessIsTheTypeScripts(t *testing.T) {
	v := loadRulesVectors(t)
	for _, c := range v.Grace {
		if got := isPastGrace(c.Fee.snap(), c.GraceDays, c.NowMs, c.TZ); got != c.Out {
			t.Errorf("isPastGrace(%+v, %d, %d): Go %v, TypeScript %v", c.Fee, c.GraceDays, c.NowMs, got, c.Out)
		}
	}
	for _, c := range v.Access {
		in := c.Input
		fees := make([]feeSnap, len(in.Fees))
		for i, f := range in.Fees {
			fees[i] = f.snap()
		}
		if got := checkClassAccess(in.InBatch, in.Consent, in.ReadOK, fees, in.GraceDays, in.OldDuesStopLink, in.NowMs, in.TimeZone); got != c.Out {
			t.Errorf("checkClassAccess(%+v):\n Go         %+v\n TypeScript %+v", in, got, c.Out)
		}
	}
}

// TestSettingsAreTheTypeScripts: settings.ts validateSettings on the example centres and on wrong files: every refusal sentence in its order, and the checked values.
func TestSettingsAreTheTypeScripts(t *testing.T) {
	v := loadRulesVectors(t)
	for _, c := range v.Settings {
		var in map[string]any
		if err := json.Unmarshal([]byte(c.Text), &in); err != nil {
			t.Fatal(err)
		}
		s, errs := ReadSettings(in, []byte(c.Text))
		if len(errs) == 0 {
			errs = []string{}
		}
		if !reflect.DeepEqual(errs, c.Errors) {
			t.Errorf("%s:\n Go         %q\n TypeScript %q", c.Name, errs, c.Errors)
			continue
		}
		if c.Checked == nil {
			continue
		}
		w := c.Checked
		if s.JoiningMidMonth != w.JoiningMidMonth || s.Payment.Module != w.Payment || s.Due.Day != w.Due.Day || s.Due.GraceDays != w.Due.GraceDays || s.LateFeeInr != w.LateFeeInr ||
			s.WaiverLimitInr != w.WaiverInr || s.RefundLimitInr != w.RefundInr || s.PartPayments.Allowed != w.PartPayments.Allowed || s.PartPayments.MinInr != w.PartPayments.MinInr ||
			!reflect.DeepEqual(s.Reminders.DaysFromDue, w.Reminders.DaysFromDue) || s.Reminders.Hour != w.Reminders.Hour || s.Reminders.MaxPerMonth != w.Reminders.MaxPerMonth {
			t.Errorf("%s: the checked values differ: Go %+v", c.Name, s)
		}
		if (w.OldDuesStopLink != nil) != (s.Classes != nil) || (s.Classes != nil && s.Classes.OldDuesStopLink != *w.OldDuesStopLink) {
			t.Errorf("%s: oldDuesStopLink differs", c.Name)
		}
		// the credit book: the block as checked (the defaults filled), its people in the file's order
		if (w.Credit != nil) != (s.Credit != nil) {
			t.Errorf("%s: the credit book is there in one runtime only", c.Name)
		} else if w.Credit != nil {
			got := s.Credit
			same := got.MaxPerPersonInr == w.Credit.MaxPerPersonInr && got.RemindEveryDays == w.Credit.RemindEveryDays && len(got.People) == len(w.Credit.People)
			for i := 0; same && i < len(got.People); i++ {
				p, x := got.People[i], w.Credit.People[i]
				same = p.Name == x.Name && p.Phone == x.Phone && p.AmountInr == x.AmountInr && p.Language == x.Language
			}
			if !same {
				t.Errorf("%s: the credit book differs: Go %+v, TypeScript %+v", c.Name, *got, *w.Credit)
			}
		}
		if len(s.Students) != len(w.Students) {
			t.Fatalf("%s: %d students, TypeScript %d", c.Name, len(s.Students), len(w.Students))
		}
		for i, st := range s.Students {
			x := w.Students[i]
			lang, joined := "", ""
			if x.Language != nil {
				lang = *x.Language
			}
			if x.Joined != nil {
				joined = *x.Joined
			}
			if st.Name != x.Name || st.BatchID != x.Batch || st.Language != lang || st.Joined != joined || len(st.BackDues) != len(x.BackDues) {
				t.Errorf("%s: student %d is %+v, TypeScript %+v", c.Name, i, st, x)
				continue
			}
			for j, b := range st.BackDues {
				if b.Month != x.BackDues[j].Month || b.AmountInr != x.BackDues[j].AmountInr {
					t.Errorf("%s: student %d back due %d is %+v, TypeScript %+v", c.Name, i, j, b, x.BackDues[j])
				}
			}
		}
	}
}

// roundTrip reads a value as JSON gives it back (numbers as float64), so a Go map and the vector's compare by value.
func roundTrip(t *testing.T, v any) any {
	t.Helper()
	if m, ok := v.(map[string]any); ok && m == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}
