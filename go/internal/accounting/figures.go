// The money figures of a monthly report, read from the journal instead of summed again from the record by each template (modules/accounting/figures.ts).
//
// What is counted, so it equals what the three reports counted before: `received` is a payment received for a deposit, an advance or a fee, once per payment; a second payment on a link
// ("extra") is owed back at once and never counted as collected. `refunds` is a refund made, once per refund id, not one a person at the server settled by their word. `discounts` and
// `lateFees` each at their own entry. A line the journal could not read because its amount is missing is still counted (count 1, paise 0) and listed under `missing`. The owner's marks (a UPI
// payment, a cash or bank payment, a refund marked sent) are summed only for a shop whose payments module cannot confirm by itself: a report passes ownerMarks false for any other shop. `booksOnly`
// is what the books count and the figures above leave out, so a report can say why its "Money this month" block differs from its own rows.
//
// Where Go differs: ISO times compare as text (as the TypeScript's string comparison does); a refund line's amount borrowed from an earlier line of the same payment
// (`refundAmountFromPayment`) is the TypeScript's `Number(amountPaise)`, and only a whole number of paise can be added here: one that is not (a fractional or enormous text) is read as
// "no amount to borrow", where the TypeScript would add the fraction to a figure that is meant to be whole paise. That is recorded in Deferred.md.
package accounting

// Amount is figures.ts Amount.
type Amount struct {
	Count int   `json:"count"`
	Paise int64 `json:"paise"`
}

// RefundAmount is the refunds figure with where they came from.
type RefundAmount struct {
	Count            int    `json:"count"`
	Paise            int64  `json:"paise"`
	OfDeposits       Amount `json:"ofDeposits"`
	OfSecondPayments Amount `json:"ofSecondPayments"`
}

// Missing counts the lines whose amount could not be read.
type Missing struct {
	DepositAmounts int `json:"depositAmounts"`
	RefundAmounts  int `json:"refundAmounts"`
}

// BooksOnlyAmounts is what the books count and the report's rows leave out.
type BooksOnlyAmounts struct {
	PaidTwice       Amount `json:"paidTwice"`
	MarkedReceived  Amount `json:"markedReceived"`
	MarkedGivenBack Amount `json:"markedGivenBack"`
}

// MonthFigures is figures.ts MonthFigures.
type MonthFigures struct {
	Received  Amount           `json:"received"`
	Refunds   RefundAmount     `json:"refunds"`
	Discounts Amount           `json:"discounts"`
	LateFees  Amount           `json:"lateFees"`
	Missing   Missing          `json:"missing"`
	BooksOnly BooksOnlyAmounts `json:"booksOnly"`
}

// BooksOnly is figures.ts BooksOnly: what the books count and the report's rows leave out, in paise, as a report carries it.
type BooksOnly struct {
	PaidTwicePaise       int64 `json:"paidTwicePaise"`
	MarkedReceivedPaise  int64 `json:"markedReceivedPaise"`
	MarkedGivenBackPaise int64 `json:"markedGivenBackPaise"`
}

// BooksOnlyOf is booksOnlyOf: the month's booksOnly for the report data and its "Money this month" block, or nil when the rows and the books agree.
func BooksOnlyOf(f MonthFigures) *BooksOnly {
	b := BooksOnly{f.BooksOnly.PaidTwice.Paise, f.BooksOnly.MarkedReceived.Paise, f.BooksOnly.MarkedGivenBack.Paise}
	if b.PaidTwicePaise+b.MarkedReceivedPaise+b.MarkedGivenBackPaise > 0 {
		return &b
	}
	return nil
}

func bump(a *Amount, paise int64) { a.Count++; a.Paise += paise }

// receivedFor says what a payment received was for: the new line says so in `refs.for`; an older one is read through the template's map. "" is the TypeScript's undefined.
func receivedFor(e Entry, legacy LegacyMap) string {
	if kind, ok := e.Refs[RefKind]; ok {
		if kind == "received" {
			return e.Refs[RefFor]
		}
		return ""
	}
	for _, x := range legacy.Received {
		if x.Action == e.Action && x.Outcome == e.Outcome {
			return string(x.For)
		}
	}
	return ""
}

// isOwnerMark is a line the journal could not read, but which is the owner's mark (its own evidence, or an older line's action).
func isOwnerMark(e Entry) bool {
	return e.Refs[RefEvidence] == "owner_mark" || e.Action == "owner_marked_paid" || e.Action == "upi_refund_marked_done"
}

func legacyReceives(legacy LegacyMap, e Entry) bool {
	for _, x := range legacy.Received {
		if x.Action == e.Action && x.Outcome == e.Outcome {
			return true
		}
	}
	return false
}

// FigureOptions is figuresOf's options: RefundAmountFromPayment (Orders alone read a refund line that carries no amount as the amount an earlier line of the same payment kept) and
// OwnerMarks (nil: the TypeScript's undefined, which counts them; a pointer to false leaves them out).
type FigureOptions struct {
	RefundAmountFromPayment bool
	OwnerMarks              *bool
}

// FiguresOf is figuresOf: the month's figures over [fromIso, toIso).
func FiguresOf(j *Journal, entries []Entry, legacy LegacyMap, fromIso, toIso string, opt FigureOptions) MonthFigures {
	var out MonthFigures
	// the payments received as a deposit or advance, over the whole record up to the month's end (a refund may come a month after its payment)
	advance := map[string]bool{}
	for _, e := range entries {
		if e.Time >= toIso {
			continue
		}
		lines := j.LinesOf(e.Seq)
		if pid, ok := e.Refs["paymentId"]; len(lines) > 0 && lines[0].Kind == "received" && receivedFor(e, legacy) == "advance" && ok {
			advance[pid] = true
		}
	}
	// the amount an earlier refund line kept for a payment, for a refund line that carries none
	amountOfPayment := map[string]int64{} // only a whole number of paise is kept (see the file comment)
	if opt.RefundAmountFromPayment {
		for _, e := range entries {
			if e.Time < toIso && e.Action == "refund" && e.Refs["paymentId"] != "" && e.Refs["amountPaise"] != "" {
				f := JSNumber(e.Refs["amountPaise"])
				if IsSafeInteger(f) {
					amountOfPayment[e.Refs["paymentId"]] = int64(f)
				} else {
					delete(amountOfPayment, e.Refs["paymentId"]) // the TypeScript keeps a number that is not whole paise; here the later line wins by being unusable
				}
			}
		}
	}
	refundSeen := map[string]bool{} // a refund once, by its id
	problems := map[int]string{}
	for _, p := range j.Problems {
		problems[p.Seq] = p.Why
	}
	for _, e := range entries {
		if e.Time < fromIso || e.Time >= toIso {
			continue
		}
		lines := j.LinesOf(e.Seq)
		if opt.OwnerMarks != nil && !*opt.OwnerMarks {
			mark := false
			if len(lines) > 0 {
				mark = lines[0].Evidence == "owner_mark"
			} else {
				mark = isOwnerMark(e)
			}
			if mark {
				// left out of the report's rows, still in the books: counted here so the report can say so
				var moved int64
				for _, l := range lines {
					moved += l.DebitPaise
				}
				if len(lines) > 0 && lines[0].Kind == "received" {
					bump(&out.BooksOnly.MarkedReceived, moved)
				} else if len(lines) > 0 && lines[0].Kind == "refund_made" {
					bump(&out.BooksOnly.MarkedGivenBack, moved)
				}
				continue
			}
		}
		if len(lines) == 0 {
			// not read as money: only an amount that is missing or wrong is counted (counted, adds nothing, listed as missing)
			why, ok := problems[e.Seq]
			if !ok || len(why) < len("the amount") || why[:len("the amount")] != "the amount" {
				continue
			}
			kind, hasKind := e.Refs[RefKind]
			if kind == "received" || (!hasKind && legacyReceives(legacy, e)) {
				if receivedFor(e, legacy) != "extra" {
					out.Received.Count++
					out.Missing.DepositAmounts++
				}
			} else if kind == "refund_made" || (!hasKind && e.Outcome == "confirmed" && (e.Action == "refund" || e.Action == "upi_refund_marked_done")) {
				_, hasConfirmed := e.Refs["confirmedBy"]
				_, hasRefundID := e.Refs["refundId"]
				byWord := hasConfirmed && !hasRefundID
				key := refundKey(e)
				if byWord || refundSeen[key] {
					continue
				}
				refundSeen[key] = true
				part := &out.Refunds.OfSecondPayments
				if e.Action == "upi_refund_marked_done" || advance[e.Refs["paymentId"]] {
					part = &out.Refunds.OfDeposits
				}
				if fb, ok := amountOfPayment[e.Refs["paymentId"]]; ok {
					bumpRefund(&out.Refunds, fb)
					bump(part, fb)
				} else {
					out.Refunds.Count++
					part.Count++
					out.Missing.RefundAmounts++
				}
			}
			continue
		}
		first := lines[0]
		var total int64 // every entry balances: what it moved is the sum of its debits
		for _, l := range lines {
			total += l.DebitPaise
		}
		switch first.Kind {
		case "received":
			if receivedFor(e, legacy) == "extra" {
				bump(&out.BooksOnly.PaidTwice, total)
			} else {
				bump(&out.Received, total)
			}
		case "refund_made":
			if first.Evidence == "person_word" {
				break
			}
			refundSeen[refundKey(e)] = true
			bumpRefund(&out.Refunds, total)
			if first.Method == "upi" || advance[e.Refs["paymentId"]] {
				bump(&out.Refunds.OfDeposits, total)
			} else {
				bump(&out.Refunds.OfSecondPayments, total)
			}
		case "discount":
			bump(&out.Discounts, total)
		case "late_fee":
			bump(&out.LateFees, total)
		}
	}
	return out
}

// refundKey is `e.refs.refundId ?? "seq-<seq>"`: a missing refund id (not an empty one) falls back to the entry's number.
func refundKey(e Entry) string {
	if id, ok := e.Refs["refundId"]; ok {
		return id
	}
	return "seq-" + itoa(e.Seq)
}

func bumpRefund(a *RefundAmount, paise int64) { a.Count++; a.Paise += paise }
