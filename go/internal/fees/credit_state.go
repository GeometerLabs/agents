package fees

// The credit book's part of the saved state: the store's `credit` member (templates/education/fees/src/credit/state.ts is its shape, which the panel and the bundle read). It
// holds who is in the book, their numbers (given by the owner, kept only on the shop's server) and where each first question stands. What each person owes is NOT here: it is
// the Fees store's own fees (one open fee per person, batch "credit"), so the payment record, the owner's marks, the books and the report are Fees' own: no second ledger.
//
// Only this runtime writes the member, so it is typed whole (no TypeScript runtime writes fields this one would have to carry).

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// Consent states of a credit account (state.ts CreditAccount.consent): not asked (nothing has gone to them), asked (after the owner's tap), yes (reminders may go). STOP is the
// customer's own optedOut, kept on the Fees customer as for every parent.
const (
	ConsentNone  = ""
	ConsentAsked = "asked"
	ConsentYes   = "yes"
)

// CreditAccount is state.ts CreditAccount.
type CreditAccount struct {
	Ref          string `json:"ref"`
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	Consent      string `json:"consent"`
	AskedAtMs    *int64 `json:"askedAtMs,omitempty"`
	YesAtMs      *int64 `json:"yesAtMs,omitempty"`
	RemindMonth  string `json:"remindMonth,omitempty"`
	RemindCount  int64  `json:"remindCount,omitempty"`
	FromSettings bool   `json:"fromSettings,omitempty"`
}

// CreditWaiting is state.ts CreditWaiting: an entry for a name the book does not know, waiting for that person's number.
type CreditWaiting struct {
	Name      string `json:"name"`
	AmountInr int64  `json:"amountInr"`
	AtMs      int64  `json:"atMs"`
}

// CreditState is state.ts CreditState.
type CreditState struct {
	People  []*CreditAccount `json:"people"`
	NextRef int64            `json:"nextRef"`
	Waiting *CreditWaiting   `json:"waiting,omitempty"`
}

// creditOf is `credit`, typed on first use (create: made when left out); nil when the saved member cannot be read and create is false.
func (s *Store) creditOf(create bool) *CreditState {
	if s.credit == nil && s.Credit != nil {
		var c CreditState
		if json.Unmarshal(s.Credit, &c) == nil {
			if c.NextRef < 1 {
				c.NextRef = 1
			}
			s.credit = &c
		}
	}
	if s.credit == nil && create {
		s.credit = &CreditState{People: []*CreditAccount{}, NextRef: 1}
	}
	return s.credit
}

// nameKey is how two names are the same name: white space collapsed (JavaScript's), lower case (toLowerCase).
func nameKey(name string) string { return language.LowerJS(creditName(name)) }

// byPhone is the account of this number, or nil.
func (c *CreditState) byPhone(phone string) *CreditAccount {
	if c == nil {
		return nil
	}
	for _, p := range c.People {
		if p.Phone == phone {
			return p
		}
	}
	return nil
}

// byRef is the account "c-3", or nil.
func (c *CreditState) byRef(ref string) *CreditAccount {
	if c == nil {
		return nil
	}
	for _, p := range c.People {
		if p.Ref == ref {
			return p
		}
	}
	return nil
}

// byName is the account the owner means by this name: the same name, else the only account whose first word is it ("Ramesh" for "Ramesh K" when there is one Ramesh). Two
// accounts that could both be meant are neither: the owner is told the name is not in the book and writes the whole name.
func (c *CreditState) byName(name string) *CreditAccount {
	if c == nil {
		return nil
	}
	key := nameKey(name)
	if key == "" {
		return nil
	}
	var first []*CreditAccount
	for _, p := range c.People {
		k := nameKey(p.Name)
		if k == key {
			return p
		}
		if w := strings.SplitN(k, " ", 2); len(w) > 1 && w[0] == key {
			first = append(first, p)
		}
	}
	if len(first) == 1 {
		return first[0]
	}
	return nil
}

// add makes an account ("c-N").
func (c *CreditState) add(name, phone string, fromSettings bool) *CreditAccount {
	acc := &CreditAccount{Ref: fmt.Sprintf("c-%d", c.NextRef), Name: creditName(name), Phone: phone, FromSettings: fromSettings}
	c.NextRef++
	c.People = append(c.People, acc)
	return acc
}
