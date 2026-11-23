package fees

// The credit book's reader (credit_read.go) on the owner's words in the four languages: the kind, the name in the owner's own letters, the amount and the number. The
// black-box cases (an entry written, a number asked for, the list) are the contract's (templates/education/fees/contract/credit.contract.test.ts).

import "testing"

func TestReadCredit(t *testing.T) {
	cases := []struct {
		text, kind, name, phone string
		amount                  int64
		bad                     bool
	}{
		{"Ramesh owes 2,400", "owes", "Ramesh", "", 2400, false},
		{"Ramesh K owes ₹2400", "owes", "Ramesh K", "", 2400, false},
		{"Ramesh 98450 11111 owes 1,00,000", "owes", "Ramesh", "+919845011111", 100000, false},
		{"Suresh +44 7700 900123 owes 500", "owes", "Suresh", "+447700900123", 500, false},
		{"Ramesh paid 1000", "paid", "Ramesh", "", 1000, false},
		{"Ramesh paid 10.50", "paid", "Ramesh", "", 10, true},
		{"रमेश पर 2400 उधार", "owes", "रमेश", "", 2400, false},
		{"रमेश के 2400 बाकी", "owes", "रमेश", "", 2400, false},
		{"the rent is due on Monday 5", "", "the rent due on Monday", "", 5, false},
		{"रमेश ने १००० दिए", "paid", "रमेश", "", 1000, false},
		{"രമേശ് 2400 തരാനുണ്ട്", "owes", "രമേശ്", "", 2400, false},
		{"ರಮೇಶ್ 600 ಕೊಡಬೇಕು", "owes", "ರಮೇಶ್", "", 600, false},
		{"ರಮೇಶ್ 600 ಕೊಟ್ಟರು", "paid", "ರಮೇಶ್", "", 600, false},
		{"who owes", "list", "", "", 0, false},
		{"Who owes what?", "list", "", "", 0, false},
		{"khata", "list", "", "", 0, false},
		{"ask Ramesh", "ask", "Ramesh", "", 0, false},
		{"Ramesh 9845011111", "number", "Ramesh", "+919845011111", 0, false},
		{"9845011111", "number", "", "+919845011111", 0, false},
		{"Ramesh owes 500 and paid 200", "unclear", "Ramesh and", "", 500, false},
		{"approve q-3", "", "approve q", "", 0, false},
		{"order 10 boxes from Ravi Traders", "", "order boxes from Ravi Traders", "", 10, false},
	}
	for _, c := range cases {
		got := readCredit(c.text)
		if got.kind != c.kind || got.phone != c.phone || (c.kind != "" && c.kind != "unclear" && got.name != c.name) || got.amountInr != c.amount || got.badAmount != c.bad {
			t.Errorf("%q: got kind %q name %q phone %q amount %d bad %v; want %q %q %q %d %v", c.text, got.kind, got.name, got.phone, got.amountInr, got.badAmount, c.kind, c.name, c.phone, c.amount, c.bad)
		}
	}
}

// TestCreditTwinsAreWords: every twin is a message the generated words have, in every language, so no credit account's message can fall back to a parent's words.
func TestCreditTwinsAreWords(t *testing.T) {
	for _, lang := range []string{"en", "hi", "ml", "kn"} {
		w := WordsFor(lang)
		for from, to := range creditTwins {
			if _, ok := w.T[from]; !ok {
				t.Errorf("%s: %s is not a Fees message", lang, from)
			}
			if _, ok := w.T[to]; !ok {
				t.Errorf("%s: the twin %s is not in the words", lang, to)
			}
		}
		for _, l := range []string{"creditAsk", "creditBook"} {
			if w.Labels[l] == "" {
				t.Errorf("%s: no label %s", lang, l)
			}
		}
	}
}
