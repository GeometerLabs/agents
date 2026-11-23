package fees

// The Fees limits as pure checks: the Go twin of templates/education/fees/src/limits.ts (with the shared refund limit of modules/limits/limits.ts checkRefund), word for word,
// because the record keeps their reasons. The two that read the record (no-reminder-once-paid, paid-only-when-recorded) read what the step's record holds now.

import (
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/language"
)

func allow(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "allow", Reason: reason}
}
func block(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "block", Reason: reason}
}
func hold(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "hold_for_owner", Reason: reason}
}

func inr(rupees int64) string    { return language.FormatInrWhole(rupees) }
func inrF(rupees float64) string { return language.FormatInr(rupees) }

// recordedPaidPaise is limits.ts recordedPaidPaise: the confirmed record_payment and owner_marked_paid amounts of this fee. A ref is read with Number() as JavaScript does.
func (a *Agent) recordedPaidPaise(dueID string) float64 {
	var n float64
	for _, action := range []string{"record_payment", ActMarked} {
		for _, v := range a.confirmedRefs(dueID, action, "amountPaise") {
			n += jsNumber(v)
		}
	}
	return n
}

// jsNumber is JavaScript's Number() of a ref (a decimal string; anything else NaN, which makes no sum pass).
func jsNumber(s string) float64 {
	var f float64
	if _, err := fmt.Sscan(s, &f); err != nil {
		return 0
	}
	return f
}

// checkFeeLink is fee-link-matches-record.
func checkFeeLink(amountInr, balanceInr, highestInr int64) Decision {
	const rule = "fee-link-matches-record"
	switch {
	case amountInr < 1:
		return block(rule, "A payment link must be for at least one rupee.")
	case amountInr != balanceInr:
		return block(rule, fmt.Sprintf("A link for %s does not match the record: %s is still owed.", inr(amountInr), inr(balanceInr)))
	case amountInr > highestInr:
		return block(rule, fmt.Sprintf("%s is more than the dearest fee with its late fee, %s.", inr(amountInr), inr(highestInr)))
	}
	return allow(rule, fmt.Sprintf("%s is what the record says is still owed.", inr(amountInr)))
}

// checkNoReminderOncePaid is no-reminder-once-paid.
func (a *Agent) checkNoReminderOncePaid(d *Due, readOK bool) Decision {
	const rule = "no-reminder-once-paid"
	if !readOK {
		return block(rule, "The payment record could not be read just now, so it cannot be known that the fee is unpaid. No reminder goes out.")
	}
	paid := a.recordedPaidPaise(d.ID)
	owed := float64(owedPaise(d))
	if paid >= owed {
		return block(rule, fmt.Sprintf("The payment record shows %s paid, which covers what is owed. No reminder goes out.", inrF(paid/100)))
	}
	return allow(rule, fmt.Sprintf("The payment record shows %s paid of %s, so the fee is not paid.", inrF(paid/100), inrF(owed/100)))
}

// checkReminderCap is reminder-cap.
func checkReminderCap(sent, most int64) Decision {
	if sent >= most {
		return block("reminder-cap", fmt.Sprintf("%d reminders have gone out for this fee this month, which is the most (%d).", sent, most))
	}
	return allow("reminder-cap", fmt.Sprintf("%d of %d reminders have gone out for this fee.", sent, most))
}

// checkWaiver is waiver-limit.
func checkWaiver(amountInr, balanceInr, alreadyWaivedInr, limitInr int64, ownerApproved bool) Decision {
	const rule = "waiver-limit"
	switch {
	case amountInr < 1:
		return block(rule, "A waiver must be at least one rupee.")
	case amountInr > balanceInr:
		return block(rule, fmt.Sprintf("A waiver of %s is more than the %s still owed.", inr(amountInr), inr(balanceInr)))
	case ownerApproved:
		return allow(rule, fmt.Sprintf("The owner approved this waiver of %s.", inr(amountInr)))
	case alreadyWaivedInr+amountInr <= limitInr:
		return allow(rule, fmt.Sprintf("%s waived in all is within your %s limit.", inr(alreadyWaivedInr+amountInr), inr(limitInr)))
	}
	return hold(rule, fmt.Sprintf("%s waived in all is above your %s limit, so the owner has to approve it.", inr(alreadyWaivedInr+amountInr), inr(limitInr)))
}

// checkPaidOnlyWhenRecorded is paid-only-when-recorded.
func (a *Agent) checkPaidOnlyWhenRecorded(d *Due, needsAll bool) Decision {
	const rule = "paid-only-when-recorded"
	paid := a.recordedPaidPaise(d.ID)
	owed := float64(owedPaise(d))
	if paid <= 0 {
		return block(rule, "Not paid yet: the payment record shows no payment for this fee.")
	}
	if needsAll && paid < owed {
		return block(rule, fmt.Sprintf("Not paid in full yet: the payment record shows %s of %s.", inrF(paid/100), inrF(owed/100)))
	}
	return allow(rule, fmt.Sprintf("The payment record shows %s paid for this fee.", inrF(paid/100)))
}

// checkOneRefundPerPayment is one-refund-per-payment.
func checkOneRefundPerPayment(paymentID string, refundedPaise int64) Decision {
	if refundedPaise > 0 {
		return block("one-refund-per-payment", fmt.Sprintf("Payment %s has already been refunded once, and a payment is refunded once.", paymentID))
	}
	return allow("one-refund-per-payment", fmt.Sprintf("Payment %s has no refund yet.", paymentID))
}

// checkRefundLimit is limits.ts checkRefundLimit (checkRefund with owedAutomatically): paidInr < 0 is "not given".
func checkRefundLimit(amountInr, limitInr int64, paidInr float64, ownerApproved bool) Decision {
	const rule = "refund-limit"
	switch {
	case amountInr <= 0:
		return block(rule, "A refund must be more than zero.")
	case paidInr >= 0 && float64(amountInr) > paidInr:
		return block(rule, fmt.Sprintf("A refund of %s is more than the %s that was paid.", inr(amountInr), inrF(paidInr)))
	case ownerApproved:
		return allow(rule, fmt.Sprintf("The owner approved this refund of %s.", inr(amountInr)))
	case amountInr > limitInr:
		return hold(rule, fmt.Sprintf("%s is above your %s refund limit, so the owner has to approve it.", inr(amountInr), inr(limitInr)))
	}
	return allow(rule, fmt.Sprintf("%s is within your %s refund limit.", inr(amountInr), inr(limitInr)))
}

// pausedDecision is agent.ts pausedDecision.
func (a *Agent) pausedDecision() Decision {
	which := "wind-down"
	if a.c.Licence() == "stopped" {
		which = "final stop"
	}
	return block("subscription_suspended", "online fee payment is paused: the centre's licence is in its "+which+", so no new fee link is made, and nothing is kept to do later (the runtime's own check of the lease)")
}
