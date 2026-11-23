// What must hold of a shop's books after anything at all has happened (modules/accounting/invariants.ts): the checks the templates' crash tests run on every world they make, so a fault in how
// a template posts money shows up as a named fault and not as a wrong figure on an owner's page months later. An empty list is the books holding. The sentences are the TypeScript's, word for
// word, and each check fails exactly where the TypeScript's does.
//
// Where Go differs: a Map's insertion order (the entries' sides, the document runs) is kept in order slices, because the faults are listed in that order; a record entry's refs are a Go map,
// which has no insertion order, so the privacy check visits an entry's refs in the order of their keys, as the TypeScript does since 22 Nov (it visited them in the order they were
// written; the keys are ASCII, so sort.Strings and JavaScript's code-unit comparison agree).
// `.trim().length` is JavaScript's (language.TrimJS and UTF16Len), `\D` is any character but 0-9.
package accounting

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

var alreadyCounted = regexp.MustCompile(`already counted`)
var nonDigits = regexp.MustCompile(`[^0-9]`)

// phonesOf is the phone numbers of the record's conversations, each with and without its country code (an Indian number's last 10 digits).
func phonesOf(entries []Entry) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, e := range entries {
		digits := nonDigits.ReplaceAllString(e.Conversation, "")
		if len(digits) < 10 {
			continue
		}
		for _, p := range []string{digits, digits[len(digits)-10:]} {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// BooksFaults is booksFaults: the faults of the books of this record. privateText are names that must never appear in refs (a Fees student's name).
func BooksFaults(entries []Entry, legacy LegacyMap, privateText []string) []string {
	j := BuildJournal(entries, legacy)
	faults := []string{}

	for _, p := range j.Problems {
		if !alreadyCounted.MatchString(p.Why) {
			faults = append(faults, fmt.Sprintf("entry %d could not be read as money: %s", p.Seq, p.Why))
		}
	}

	type side struct{ d, c int64 }
	sides := map[int]*side{}
	sideOrder := []int{}
	for _, l := range j.Lines {
		s := sides[l.Seq]
		if s == nil {
			s = &side{}
			sides[l.Seq] = s
			sideOrder = append(sideOrder, l.Seq)
		}
		s.d += l.DebitPaise
		s.c += l.CreditPaise
	}
	for _, seq := range sideOrder {
		if s := sides[seq]; s.d != s.c {
			faults = append(faults, fmt.Sprintf("entry %d: debits %d paise, credits %d paise", seq, s.d, s.c))
		}
	}

	// once: the money identities of the entries that posted
	once := map[string]int{}
	for _, e := range entries {
		if len(j.LinesOf(e.Seq)) == 0 {
			continue
		}
		kind, hasKind := e.Refs[RefKind]
		var id string
		var has bool
		if hasKind && kind == "received" {
			id, has = e.Refs[RefPaymentID]
		} else if hasKind && kind == "refund_made" {
			id, has = e.Refs[RefRefundID]
		}
		if !has {
			continue
		}
		key := kind + ":" + id
		if first, ok := once[key]; ok {
			faults = append(faults, fmt.Sprintf("%s is counted twice (entries %d and %d)", key, first, e.Seq))
		} else {
			once[key] = e.Seq
		}
	}

	var owedAccount int64
	for _, l := range j.Lines {
		if l.Account == AccRefundsOwed.Code {
			owedAccount += l.DebitPaise - l.CreditPaise
		}
	}
	owedAccount = 0 - owedAccount
	var owedOpen int64
	for _, x := range j.OwedList() {
		owedOpen += x.Paise
	}
	if owedAccount != owedOpen {
		faults = append(faults, fmt.Sprintf("refunds owed holds %d paise, but the open refunds add up to %d", owedAccount, owedOpen))
	}
	if owedAccount < 0 {
		faults = append(faults, fmt.Sprintf("refunds owed is below nothing (%d paise)", owedAccount))
	}

	// numbers: unique, and no gap a restore does not explain
	restores := []int{}
	for _, e := range entries {
		if e.Action == RestoredAction {
			restores = append(restores, e.Seq)
		}
	}
	type run struct {
		n      int64
		seq    int
		number string
	}
	runs := map[string][]run{}
	runOrder := []string{}
	for _, d := range j.Documents {
		k := string(d.Series) + "/" + d.FY
		if _, ok := runs[k]; !ok {
			runOrder = append(runOrder, k)
		}
		runs[k] = append(runs[k], run{d.N, d.Seq, d.Number})
	}
	for _, k := range runOrder {
		docs := runs[k]
		sort.SliceStable(docs, func(a, b int) bool { return docs[a].n < docs[b].n })
		prevN, prevSeq := int64(0), 0
		for _, d := range docs {
			if d.n == prevN {
				faults = append(faults, fmt.Sprintf("%s is used twice", d.number))
			} else if d.n > prevN+1 {
				explained := false
				for _, r := range restores {
					if r > prevSeq && r < d.seq {
						explained = true
					}
				}
				if !explained {
					faults = append(faults, fmt.Sprintf("%s: numbers %d to %d are missing and no restore explains it", k, prevN+1, d.n-1))
				}
			}
			if d.seq < prevSeq {
				faults = append(faults, fmt.Sprintf("%s was issued before a lower number", d.number))
			}
			prevN, prevSeq = d.n, d.seq
		}
	}

	secrets := []string{}
	for _, t := range privateText {
		if language.UTF16Len(language.TrimJS(t)) >= 3 {
			secrets = append(secrets, t)
		}
	}
	phones := phonesOf(entries)
	for _, e := range entries {
		for _, k := range sortedKeys(e.Refs) {
			v := e.Refs[k]
			for _, p := range phones {
				if strings.Contains(v, p) {
					faults = append(faults, fmt.Sprintf("entry %d: refs.%s carries a customer's phone number", e.Seq, k))
					break
				}
			}
			for _, t := range secrets {
				if strings.Contains(v, t) {
					faults = append(faults, fmt.Sprintf("entry %d: refs.%s carries a private name", e.Seq, k))
				}
			}
		}
	}
	return faults
}

// FiguresFaults is figuresFaults: the report's rows against its "Money this month" block, over the whole record: received in the books = received + paidTwice + markedReceived, and refunds
// made (less a person's word) = refunds + markedGivenBack, with the owner's marks counted and left out.
func FiguresFaults(entries []Entry, legacy LegacyMap, refundAmountFromPayment bool) []string {
	const from, to = "1970-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z"
	j := BuildJournal(entries, legacy)
	s := SummaryOf(j, from, to, entries)
	books := func(kind string) int64 {
		for _, k := range s.ByKind {
			if k.Kind == kind {
				return k.Paise
			}
		}
		return 0
	}
	out := []string{}
	for _, ownerMarks := range []bool{true, false} {
		om := ownerMarks
		f := FiguresOf(j, entries, legacy, from, to, FigureOptions{RefundAmountFromPayment: refundAmountFromPayment, OwnerMarks: &om})
		b := f.BooksOnly
		word := "left out"
		if ownerMarks {
			word = "counted"
		}
		rows := f.Received.Paise + b.PaidTwice.Paise + b.MarkedReceived.Paise
		if books("received") != rows {
			out = append(out, fmt.Sprintf("owner marks %s: the books received %d, the rows and booksOnly %d", word, books("received"), rows))
		}
		back := f.Refunds.Paise + b.MarkedGivenBack.Paise
		if books("refund_made")-s.ByWord.Paise != back {
			out = append(out, fmt.Sprintf("owner marks %s: the books gave back %d, the rows and booksOnly %d", word, books("refund_made")-s.ByWord.Paise, back))
		}
	}
	return out
}
