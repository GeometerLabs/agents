package razorpay

// Razorpay's webhooks (modules/payments/providers/razorpay/webhook.ts): checking that Razorpay sent one, and reading it into the neutral events (payments.go). Razorpay signs the RAW
// body (header X-Razorpay-Signature is the hex HMAC-SHA256 of it with the webhook secret); the event id is the header x-razorpay-event-id (unique per event; the same event can arrive
// more than once). Razorpay wants an answer within 5 seconds and retries for 24 hours. The agent runtime never holds a webhook secret: the inbox uses these.

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/payments"
)

const (
	SignatureHeader = "x-razorpay-signature"
	EventIDHeader   = "x-razorpay-event-id"
)

// Sign is the signature Razorpay would send for this body: what the stand-in sends.
func Sign(rawBody []byte, secret string) string { return guard.HMACHex(rawBody, secret) }

// Verify: is this body what Razorpay sent? An empty secret never verifies anything; header is nil when the header was absent.
func Verify(rawBody []byte, header *string, secret string) bool {
	if len(secret) == 0 {
		return false
	}
	return guard.SameHex(guard.HMACHex(rawBody, secret), header)
}

// ParseEvent reads a Razorpay webhook (its raw bytes) into a PaymentEvent, or nil for any event the agent does not use (payment_link.expired, payment.failed ...). eventID is the
// x-razorpay-event-id header; without it the id is a digest of the body as JavaScript re-writes it (guard.ReEmit), which a retry repeats exactly. Razorpay's names become the neutral
// ones: payment_link.paid is request.paid, payment.captured is payment.received, refund.processed is refund.done. A real payment.captured names the payment and its order, NOT its
// payment link, so payment.request_id is left out for it; the agent asks the payments service which request the payment paid.
func ParseEvent(raw []byte, eventID string) (*payments.PaymentEvent, error) {
	body, err := guard.Decode(string(raw))
	if err != nil {
		return nil, err
	}
	obj, ok := guard.IsObject(body)
	if !ok {
		return nil, nil
	}
	payload, ok := guard.IsObject(obj["payload"])
	if !ok {
		return nil, nil
	}
	entityOf := func(name string) guard.Object {
		if p, ok := guard.IsObject(payload[name]); ok {
			if e, ok := guard.IsObject(p["entity"]); ok {
				return e
			}
		}
		return nil
	}
	id := eventID
	if id == "" {
		text, err := guard.ReEmit(string(raw))
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256([]byte(text))
		id = "evt_" + hex.EncodeToString(sum[:])[:32]
	}
	createdAt, _ := guard.Int(obj["created_at"])
	str := func(o guard.Object, k string) string { s, _ := guard.Str(o[k]); return s }

	switch obj["event"] {
	case "payment_link.paid":
		link, payment := entityOf("payment_link"), entityOf("payment")
		linkID := str(link, "id")
		if linkID == "" {
			return nil, nil
		}
		ev := &payments.PaymentEvent{ID: id, Event: payments.EventRequestPaid, CreatedAt: createdAt, Payload: payments.EventPayload{Request: &payments.EventRequest{ID: linkID, ReferenceID: str(link, "reference_id")}}}
		if pid := str(payment, "id"); pid != "" {
			ev.Payload.Payment = &payments.EventPayment{ID: pid, RequestID: linkID}
		}
		return ev, nil
	case "payment.captured":
		if pid := str(entityOf("payment"), "id"); pid != "" {
			return &payments.PaymentEvent{ID: id, Event: payments.EventPaymentReceived, CreatedAt: createdAt, Payload: payments.EventPayload{Payment: &payments.EventPayment{ID: pid}}}, nil
		}
	case "refund.processed":
		refund := entityOf("refund")
		rid, pid := str(refund, "id"), str(refund, "payment_id")
		if rid != "" && pid != "" {
			return &payments.PaymentEvent{ID: id, Event: payments.EventRefundDone, CreatedAt: createdAt, Payload: payments.EventPayload{Refund: &payments.EventRefund{ID: rid, PaymentID: pid}}}, nil
		}
	}
	return nil, nil
}
