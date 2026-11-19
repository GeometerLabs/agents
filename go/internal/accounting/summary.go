// The books summary of one period: the small, plain-data figure set that the signed monthly report carries and the open check re-adds (modules/accounting/summary.ts).
//
// It is a pure function of the journal and the record's times, with every figure an integer number of paise (or a count) and every list sorted in a fixed order, so the signed bytes are the
// same each time the same record is read. Where Go differs: ISO times compare as text (the TypeScript's string comparison), the sorts are by code unit (byText: never a locale's; the
// strings here are ASCII), and JavaScript's Maps and Sets that are only summed or sorted afterwards are plain Go maps (their order never shows). `0 - x` is kept where the TypeScript
// writes it to avoid a -0 in the signed bytes: an int64 has no -0, so there it is just the negation.
package accounting

import "sort"

// SummaryAccount is one account's debits and credits in the period.
type SummaryAccount struct {
	Account     string `json:"account"`
	DebitPaise  int64  `json:"debitPaise"`
	CreditPaise int64  `json:"creditPaise"`
}

// SummaryKind is one kind of money fact: how many record entries and how many paise moved.
type SummaryKind struct {
	Kind    string `json:"kind"`
	Entries int    `json:"entries"`
	Paise   int64  `json:"paise"`
}

// SummarySkipped is a range of document numbers that were skipped.
type SummarySkipped struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// SummaryDocuments is, per series and year, the documents issued in the period.
type SummaryDocuments struct {
	Series  Series           `json:"series"`
	FY      string           `json:"fy"`
	First   string           `json:"first"`
	Last    string           `json:"last"`
	Count   int              `json:"count"`
	Skipped []SummarySkipped `json:"skipped"`
}

// SummaryClosing is what is held at the period's end.
type SummaryClosing struct {
	AdvancesPaise    int64 `json:"advancesPaise"`
	RefundsOwedPaise int64 `json:"refundsOwedPaise"`
	ReceivablePaise  int64 `json:"receivablePaise"`
}

// SummaryByWord is the refunds made in the period on a person's word only.
type SummaryByWord struct {
	Entries int   `json:"entries"`
	Paise   int64 `json:"paise"`
}

// AccountingSummary is summary.ts AccountingSummary.
type AccountingSummary struct {
	Accounts  []SummaryAccount   `json:"accounts"`
	ByKind    []SummaryKind      `json:"byKind"`
	Closing   SummaryClosing     `json:"closing"`
	Documents []SummaryDocuments `json:"documents"`
	ByWord    SummaryByWord      `json:"byWord"`
	Problems  int                `json:"problems"`
}

// SummaryOf is accountingSummary: the books of the period [fromIso, toIso).
func SummaryOf(j *Journal, fromIso, toIso string, entries []Entry) AccountingSummary {
	inPeriod := func(at string) bool { return at >= fromIso && at < toIso }

	accounts := map[string]*SummaryAccount{}
	type kindAcc struct {
		seqs  map[int]bool
		paise int64
	}
	kinds := map[string]*kindAcc{}
	byWordSeqs := map[int]bool{}
	var byWordPaise int64
	closing := map[string]int64{} // debits less credits up to the period's end
	for _, l := range j.Lines {
		if l.At >= toIso {
			continue
		}
		closing[l.Account] += l.DebitPaise - l.CreditPaise
		if !inPeriod(l.At) {
			continue
		}
		a := accounts[l.Account]
		if a == nil {
			a = &SummaryAccount{Account: l.Account}
			accounts[l.Account] = a
		}
		a.DebitPaise += l.DebitPaise
		a.CreditPaise += l.CreditPaise
		k := kinds[string(l.Kind)]
		if k == nil {
			k = &kindAcc{seqs: map[int]bool{}}
			kinds[string(l.Kind)] = k
		}
		k.seqs[l.Seq] = true
		k.paise += l.DebitPaise // every entry balances, so what it moved is the sum of its debits
		if l.Kind == "refund_made" && l.Evidence == "person_word" {
			byWordSeqs[l.Seq] = true
			byWordPaise += l.DebitPaise
		}
	}
	held := func(account string) int64 { return closing[account] }

	// documents: by series and year, the numbers issued in the period, and the gaps in the run that this period's documents sit at the end of
	type group struct {
		series    Series
		fy        string
		mine, all []int64
	}
	groups := map[string]*group{}
	for _, d := range j.Documents {
		if d.At >= toIso {
			continue
		}
		key := string(d.Series) + "|" + d.FY
		g := groups[key]
		if g == nil {
			g = &group{series: d.Series, fy: d.FY}
			groups[key] = g
		}
		g.all = append(g.all, d.N)
		if inPeriod(d.At) {
			g.mine = append(g.mine, d.N)
		}
	}
	documents := []SummaryDocuments{}
	for _, key := range sortedKeys(groups) {
		g := groups[key]
		if len(g.mine) == 0 {
			continue
		}
		all := uniqueSorted(g.all)
		mine := map[int64]bool{}
		for _, n := range g.mine {
			mine[n] = true
		}
		skipped := []SummarySkipped{}
		for i := 1; i < len(all); i++ {
			if all[i]-all[i-1] > 1 && mine[all[i]] {
				skipped = append(skipped, SummarySkipped{mustNumber(DocNumber{g.series, g.fy, all[i-1] + 1}), mustNumber(DocNumber{g.series, g.fy, all[i] - 1})})
			}
		}
		sorted := uniqueSorted(g.mine)
		documents = append(documents, SummaryDocuments{Series: g.series, FY: g.fy, First: mustNumber(DocNumber{g.series, g.fy, sorted[0]}), Last: mustNumber(DocNumber{g.series, g.fy, sorted[len(sorted)-1]}), Count: len(g.mine), Skipped: skipped})
	}

	timeOf := map[int]string{}
	for _, e := range entries {
		timeOf[e.Seq] = e.Time
	}
	problems := 0
	for _, p := range j.Problems {
		if t, ok := timeOf[p.Seq]; ok && inPeriod(t) {
			problems++
		}
	}

	accs := make([]SummaryAccount, 0, len(accounts))
	for _, a := range accounts {
		accs = append(accs, *a)
	}
	sort.Slice(accs, func(x, y int) bool { return accs[x].Account < accs[y].Account })
	bk := make([]SummaryKind, 0, len(kinds))
	for k, v := range kinds {
		bk = append(bk, SummaryKind{k, len(v.seqs), v.paise})
	}
	sort.Slice(bk, func(x, y int) bool { return bk[x].Kind < bk[y].Kind })
	return AccountingSummary{
		Accounts:  accs,
		ByKind:    bk,
		Closing:   SummaryClosing{AdvancesPaise: -held(AccAdvances.Code), RefundsOwedPaise: -held(AccRefundsOwed.Code), ReceivablePaise: held(AccReceivable.Code)},
		Documents: documents,
		ByWord:    SummaryByWord{len(byWordSeqs), byWordPaise},
		Problems:  problems,
	}
}

// uniqueSorted is `[...new Set(xs)].sort((x, y) => x - y)`.
func uniqueSorted(xs []int64) []int64 {
	seen := map[int64]bool{}
	out := []int64{}
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a] < out[b] })
	return out
}

// ReportAccountingData is what a template's report data carries as `accounting`: the summary and the template's frozen legacy map (so the open check can read an older line without
// importing a template).
type ReportAccountingData struct {
	Summary AccountingSummary `json:"summary"`
	Legacy  LegacyMap         `json:"legacy"`
}

// ReportAccounting is reportAccounting: nil when the whole record has no money lines at all, so the report then leaves the field out and every report made before keeps its bytes.
func ReportAccounting(entries []Entry, legacy LegacyMap, fromIso, toIso string) *ReportAccountingData {
	j := BuildJournal(entries, legacy)
	if len(j.Lines) == 0 {
		return nil
	}
	return &ReportAccountingData{SummaryOf(j, fromIso, toIso, entries), legacy}
}
