package upi

// The UPI link against what the TypeScript made (testdata/upi-vectors.json): the same problems in the same words, the same amounts, the same `upi://pay` bytes. Amounts that are not whole
// paise (150.5) cannot be given to the Go function, so those vectors are skipped by name.

import (
	"encoding/json"
	"os"
	"testing"
)

type out struct {
	OK    *string `json:"ok"`
	Error *string `json:"error"`
}

func TestUpiVectors(t *testing.T) {
	b, err := os.ReadFile("testdata/upi-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Vpa []struct {
			V       string  `json:"v"`
			Problem *string `json:"problem"`
			Normal  string  `json:"normal"`
		} `json:"vpa"`
		Payee []struct {
			N       string  `json:"n"`
			Problem *string `json:"problem"`
		} `json:"payee"`
		Amount []struct {
			A   float64 `json:"a"`
			Out out     `json:"out"`
		} `json:"amount"`
		Link []struct {
			Vpa         string  `json:"vpa"`
			Payee       string  `json:"payee"`
			AmountPaise float64 `json:"amountPaise"`
			Note        string  `json:"note"`
			Out         out     `json:"out"`
		} `json:"link"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	for _, c := range v.Vpa {
		if got := VpaProblem(c.V); got != str(c.Problem) {
			t.Errorf("VpaProblem(%q) = %q, TypeScript %q", c.V, got, str(c.Problem))
		}
		if got := NormaliseVpa(c.V); got != c.Normal {
			t.Errorf("NormaliseVpa(%q) = %q, TypeScript %q", c.V, got, c.Normal)
		}
	}
	for _, c := range v.Payee {
		if got := PayeeProblem(c.N); got != str(c.Problem) {
			t.Errorf("PayeeProblem(%q) = %q, TypeScript %q", c.N, got, str(c.Problem))
		}
	}
	for _, c := range v.Amount {
		if c.A != float64(int64(c.A)) {
			continue // a fraction of a paisa is not representable here
		}
		got, err := AmountText(int64(c.A))
		if c.Out.OK != nil && (err != nil || got != *c.Out.OK) || c.Out.Error != nil && (err == nil || err.Error() != *c.Out.Error) {
			t.Errorf("AmountText(%v) = %q, %v; TypeScript %+v", c.A, got, err, c.Out)
		}
	}
	for _, c := range v.Link {
		if c.AmountPaise != float64(int64(c.AmountPaise)) {
			continue
		}
		got, err := PayLink(Request{Vpa: c.Vpa, Payee: c.Payee, AmountPaise: int64(c.AmountPaise), Note: c.Note})
		if c.Out.OK != nil && (err != nil || got != *c.Out.OK) || c.Out.Error != nil && (err == nil || err.Error() != *c.Out.Error) {
			t.Errorf("PayLink(%+v) = %q, %v; TypeScript %+v", c, got, err, c.Out)
		}
	}
}
