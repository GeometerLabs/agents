package orders

// The Orders limits, as pure checks: the Go twin of templates/commerce/orders/src/limits.ts (and the shared three of modules/limits/limits.ts it wraps: the refund limit and the
// record match; opt-out is say's). Each takes the facts it needs and returns a decision {ruleId, verdict, reason} with the TypeScript's words, so the record a Go step writes
// reads as the TypeScript's:
//
//	price-at-or-above-menu, order-size, within-stock, within-day-cap (the day's and a slot's own), before-cutoff, within-delivery-area, confirm-only-when-recorded,
//	one-advance-per-order, refund-limit
//
// Where Go and JavaScript differ (each said where it happens): areaOf sorts the places by their UTF-16 length, as `b.length - a.length` does, with a stable sort (Array.sort is
// stable); `[^\p{L}\p{N}]+` is the same class in RE2 as in a `u` regular expression; formatInr is language.FormatInr over the JavaScript number.

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// Decision is modules/limits/limits.ts Decision: the shared one say and the record use (messaging.Decision), so no conversion is ever needed.
type Decision = messaging.Decision

func allow(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "allow", Reason: reason}
}
func block(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "block", Reason: reason}
}
func hold(rule, reason string) Decision {
	return Decision{RuleID: rule, Verdict: "hold_for_owner", Reason: reason}
}

func blocked(d Decision) bool { return d.Verdict == "block" }

// inr is format.ts formatInr of whole rupees.
func inr(rupees int64) string { return language.FormatInr(float64(rupees)) }

// checkPriceAtOrAboveMenu: never quote or agree below the menu price (the menu price is the floor).
func checkPriceAtOrAboveMenu(itemName string, listInr, proposedInr int64) Decision {
	if proposedInr < listInr {
		return block("price-at-or-above-menu", fmt.Sprintf("%s is below the menu price: %s is %s. The agent never quotes or agrees to less.", inr(proposedInr), itemName, inr(listInr)))
	}
	return allow("price-at-or-above-menu", fmt.Sprintf("%s is at or above the menu price of %s for %s.", inr(proposedInr), inr(listInr), itemName))
}

// checkOrderSize: an order has at most so many items, counting each one.
func checkOrderSize(items, maxItems int64) Decision {
	if items > maxItems {
		return block("order-size", fmt.Sprintf("%d items is more than one order may have (%d).", items, maxItems))
	}
	if items < 1 {
		return block("order-size", "An order needs at least one item.")
	}
	return allow("order-size", fmt.Sprintf("%d items is within the %d one order may have.", items, maxItems))
}

// checkStock: the day's stock of an item; taken is what the other orders that hold stock already have.
func checkStock(itemName string, wanted, taken, dailyStock int64) Decision {
	left := max(0, dailyStock-taken)
	if wanted > left {
		return block("within-stock", fmt.Sprintf("%d of %s is more than is left for the day: %d of %d.", wanted, itemName, left, dailyStock))
	}
	return allow("within-stock", fmt.Sprintf("%d of %s is within the %d left of %d.", wanted, itemName, left, dailyStock))
}

// checkDayCap: the most orders for one day; ordersOnDay is the orders that hold a place, not counting this one.
func checkDayCap(ordersOnDay int, maxPerDay int64) Decision {
	if int64(ordersOnDay) >= maxPerDay {
		return block("within-day-cap", fmt.Sprintf("%d orders already hold a place for the day, which is the most (%d).", ordersOnDay, maxPerDay))
	}
	return allow("within-day-cap", fmt.Sprintf("%d of %d orders hold a place for the day.", ordersOnDay, maxPerDay))
}

// checkSlotCap: a slot's own most orders (the same rule id as the day's on purpose: limits.ts says why). maxOrders nil: the slot has no limit of its own.
func checkSlotCap(ordersInSlot int, maxOrders *int64) Decision {
	if maxOrders == nil {
		return allow("within-day-cap", "The slot has no limit of its own.")
	}
	if int64(ordersInSlot) >= *maxOrders {
		return block("within-day-cap", fmt.Sprintf("%d orders already hold a place in the slot, which is the most (%d).", ordersInSlot, *maxOrders))
	}
	return allow("within-day-cap", fmt.Sprintf("%d of %d orders hold a place in the slot.", ordersInSlot, *maxOrders))
}

// checkBeforeCutoff: no order once the cut-off for its day and slot has passed; the moment itself is already too late.
func checkBeforeCutoff(nowMs, cutoffMs int64) Decision {
	if nowMs >= cutoffMs {
		return block("before-cutoff", "The cut-off for that day and slot has passed.")
	}
	return allow("before-cutoff", "The cut-off for that day and slot has not passed.")
}

var notLetterOrDigit = regexp.MustCompile(`[^\p{L}\p{N}]+`)

func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

// areaOf is limits.ts areaOf: the place on the shop's list that an address names (whole words, any case), or "". The longest name wins (by UTF-16 length, a stable sort, as
// Array.sort is).
func areaOf(address string, area []string) string {
	text := " " + notLetterOrDigit.ReplaceAllString(language.Canon(address), " ") + " "
	places := append([]string(nil), area...)
	sort.SliceStable(places, func(i, j int) bool { return jsLen(places[i]) > jsLen(places[j]) })
	for _, p := range places {
		if strings.Contains(text, " "+language.TrimJS(notLetterOrDigit.ReplaceAllString(language.Canon(p), " "))+" ") {
			return p
		}
	}
	return ""
}

// checkDeliveryArea: a delivery address must name a place on the shop's list.
func checkDeliveryArea(address string, area []string) Decision {
	place := areaOf(address, area)
	if place == "" {
		return block("within-delivery-area", "The address names no place on the shop's delivery list.")
	}
	return allow("within-delivery-area", fmt.Sprintf("The address names %s, which is on the shop's delivery list.", place))
}

// recordedPaidPaise is limits.ts recordedPaidPaise: what the payment record shows paid on an order (the payments read back from the payments service's list, and on a UPI shop the
// owner's marks), never what a customer said or sent. Number(s) of each ref, summed as JavaScript numbers.
func (a *Agent) recordedPaidPaise(order string) float64 {
	var n float64
	for _, s := range append(a.confirmedRefs(order, "record_payment", "amountPaise"), a.confirmedRefs(order, ActionMarked, "amountPaise")...) {
		n += jsNumber(s)
	}
	return n
}

// checkConfirmOnlyWhenRecorded: say "confirmed" only when the record shows the whole advance for this order.
func (a *Agent) checkConfirmOnlyWhenRecorded(order string, advancePaise int64) Decision {
	paid := a.recordedPaidPaise(order)
	if paid >= float64(advancePaise) {
		return allow("confirm-only-when-recorded", fmt.Sprintf("The payment record shows %s paid, which covers the %s advance.", language.FormatInr(paid/100), language.FormatInr(float64(advancePaise)/100)))
	}
	return block("confirm-only-when-recorded", fmt.Sprintf("Not confirmed yet: the payment record shows %s of the %s advance.", language.FormatInr(paid/100), language.FormatInr(float64(advancePaise)/100)))
}

// checkOneAdvancePerOrder: a second payment on an order that already has its advance is not another advance (the block means "do not count it"; the agent refunds it).
func (a *Agent) checkOneAdvancePerOrder(order, paymentID string) Decision {
	recorded := a.confirmedRefs(order, "record_payment", "paymentId")
	if len(recorded) == 0 {
		return allow("one-advance-per-order", "No advance is recorded for this order yet, so this payment is its advance.")
	}
	if contains(recorded, paymentID) {
		return allow("one-advance-per-order", "This payment is the order's recorded advance.")
	}
	return block("one-advance-per-order", "This order already has its advance, so this second payment is not counted. It is refunded and the owner is told.")
}

// refundAsk is checkRefundLimit's input: paidInr < 0 is "not given"; window false is a cancellation outside the window (the owner decides).
type refundAsk struct {
	amountInr, limitInr, paidInr int64
	ownerApproved                bool
	outsideWindow                bool
}

// checkRefundLimit is limits.ts checkRefundLimit over modules/limits checkRefund, with Orders' words for a late cancellation.
func checkRefundLimit(r refundAsk) Decision {
	switch {
	case r.amountInr <= 0:
		return block("refund-limit", "A refund must be more than zero.")
	case r.paidInr >= 0 && r.amountInr > r.paidInr:
		return block("refund-limit", fmt.Sprintf("A refund of %s is more than the %s that was paid.", inr(r.amountInr), inr(r.paidInr)))
	case r.ownerApproved:
		return allow("refund-limit", fmt.Sprintf("The owner approved this refund of %s.", inr(r.amountInr)))
	case r.outsideWindow:
		return hold("refund-limit", "The order was cancelled too late for an automatic refund, so the owner decides.")
	case r.amountInr > r.limitInr:
		return hold("refund-limit", fmt.Sprintf("%s is above your %s refund limit, so the owner has to approve it.", inr(r.amountInr), inr(r.limitInr)))
	}
	return allow("refund-limit", fmt.Sprintf("%s is within your %s refund limit.", inr(r.amountInr), inr(r.limitInr)))
}
