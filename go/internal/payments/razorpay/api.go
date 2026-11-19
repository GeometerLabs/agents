// Package razorpay is Payments over Razorpay's wire format (Payment Links API v1, Payments, Refunds), the Go twin of modules/payments/providers/razorpay/api.ts and webhook.ts. No key,
// no Authorization header of Razorpay's: the base URL is a Guard in front of https://api.razorpay.com (or a stand-in), so paths start at /v1/....
//
// Wire facts (Razorpay's own docs, as api.ts records them): create POST /v1/payment_links (amount in paise, reference_id up to 40 characters); fetch GET /v1/payment_links/{id} whose
// `payments` items are thin ({payment_id, amount, status "captured"}); list GET /v1/payment_links?reference_id=&payment_id= (its payments are never relied on); cancel POST
// .../cancel; payment GET /v1/payments/{id} (amount_refunded lives there); refund POST /v1/payments/{id}/refund {amount, receipt} (the receipt is an idempotency key); refunds GET
// /v1/payments/{id}/refunds?count=100; recon GET /v1/settlements/recon/combined (never run against a real account, as the TypeScript says). A missing id is HTTP 400 "The id provided
// does not exist", not 404.
//
// Every request's bytes are what the TypeScript sends: the body keys in the TypeScript literal's order, and `receipt` left out when none was given. Money is integer paise.
package razorpay

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/payments"
)

// Config is RazorpayConfig: the Guard's address, a timeout (0: ten seconds) and the credential Guard asks of this agent (never a Razorpay key; "" sends no Authorization header).
type Config struct {
	BaseURL    string
	TimeoutMs  int
	AgentToken string
}

// Capabilities is razorpay/index.ts: Razorpay's own record says when money arrives, refunds go through it behind Guard, a link can stay open for a part payment and be cancelled.
var Capabilities = payments.Capabilities{ConfirmsAutomatically: true, RefundsAutomatically: true, TakesPartPayments: true, Cancels: true, ReadsBack: true, ReadsSettlements: true}

// ---- wire -> our types (pure) ----------------------------------------------------------------------------------------------------

// DescribeError is Razorpay's words for what went wrong, or a plain sentence when the body is not theirs.
func DescribeError(r guard.Reply) string {
	if e, ok := guard.IsObject(guard.Get(r.Body, "error")); ok {
		if d, ok := guard.Str(e["description"]); ok {
			return d
		}
	}
	return "Razorpay answered " + guard.Itoa(int64(r.Status)) + "."
}

var missingWords = regexp.MustCompile(`(?i)does not exist`)

func isMissing(r guard.Reply) bool {
	return (r.Status == 400 || r.Status == 404) && missingWords.MatchString(DescribeError(r))
}

func expectOK(r guard.Reply) (guard.Object, error) {
	if r.Status < 200 || r.Status >= 300 {
		return nil, &guard.ApiError{Status: r.Status, Message: DescribeError(r)}
	}
	o, ok := guard.IsObject(r.Body)
	if !ok {
		return nil, &guard.ApiError{Status: 502, Message: "Razorpay answered with something that is not a record."}
	}
	return o, nil
}

func needNum(v any, what string) (int64, error) {
	n, ok := guard.Int(v)
	if !ok {
		return 0, &guard.ApiError{Status: 502, Message: "Razorpay's record has no " + what + "."}
	}
	return n, nil
}

func needStr(v any, what string) (string, error) {
	s, ok := guard.Str(v)
	if !ok {
		return "", &guard.ApiError{Status: 502, Message: "Razorpay's record has no " + what + "."}
	}
	return s, nil
}

func needINR(v any) error {
	if s, ok := v.(string); ok && s == "INR" {
		return nil
	}
	return &guard.ApiError{Status: 502, Message: "Razorpay's record is in " + jsString(v) + ", and only INR is handled."}
}

// absent marks a member the reply did not have (JavaScript's undefined), so String(v) can say "undefined" for it and "null" for a JSON null.
type absent struct{}

// field reads a member of a decoded object, absent{} when it is not there.
func field(o guard.Object, key string) any {
	if v, ok := o[key]; ok {
		return v
	}
	return absent{}
}

// jsString is String(v) for a decoded JSON value, as the TypeScript's template literal writes it.
func jsString(v any) string {
	switch x := v.(type) {
	case absent:
		return "undefined"
	case nil:
		return "null"
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case json.Number:
		if i, ok := guard.Int(v); ok {
			return guard.Itoa(i)
		}
		return string(x)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// ToPayment reads a payment as Razorpay's payments record holds it. A refunded payment keeps captured: true (its status turns "refunded"), so it still counts as captured; a payment
// that was only authorised, or failed, is not a deposit and is nil.
func ToPayment(raw guard.Object, linkID string) (*payments.Payment, error) {
	status, _ := raw["status"].(string)
	if !(raw["captured"] == true || status == "captured" || status == "refunded") {
		return nil, nil
	}
	id, err := needStr(raw["id"], "payment id")
	if err != nil {
		return nil, err
	}
	amount, err := needNum(raw["amount"], "payment amount")
	if err != nil {
		return nil, err
	}
	if err := needINR(field(raw, "currency")); err != nil {
		return nil, err
	}
	refunded, _ := guard.Int(raw["amount_refunded"])
	created, err := needNum(raw["created_at"], "payment time")
	if err != nil {
		return nil, err
	}
	return &payments.Payment{ID: id, RequestID: linkID, Amount: amount, Currency: "INR", Status: "received", AmountRefunded: refunded, CreatedAt: created}, nil
}

// embeddedPayment reads the thin `payments` items inside a payment link: no refunds on them.
func embeddedPayment(raw guard.Object, linkID string) (*payments.Payment, error) {
	if st, present := raw["status"]; present && st != "captured" { // `status !== undefined && status !== "captured"`; a JSON null is not captured either
		return nil, nil
	}
	id, err := needStr(raw["payment_id"], "payment id")
	if err != nil {
		return nil, err
	}
	amount, err := needNum(raw["amount"], "payment amount")
	if err != nil {
		return nil, err
	}
	created, _ := guard.Int(raw["created_at"])
	return &payments.Payment{ID: id, RequestID: linkID, Amount: amount, Currency: "INR", Status: "received", CreatedAt: created}, nil
}

// linkStatus: Razorpay's link statuses are created, partially_paid, expired, cancelled, paid. An expired link can no longer be paid, so it reads as cancelled.
func linkStatus(raw any) (string, error) {
	if s, ok := raw.(string); ok {
		switch s {
		case "created", "partially_paid", "paid":
			return s, nil
		case "cancelled", "expired":
			return "cancelled", nil
		}
	}
	return "", &guard.ApiError{Status: 502, Message: "Razorpay's record has a link status this code does not know: " + jsString(raw) + "."}
}

// ToPaymentRequest maps a payment link plus its payments into the provider-neutral PaymentRequest; a missing or wrong-typed field is an error rather than a default, so a changed
// reply is noticed.
func ToPaymentRequest(raw guard.Object, paid []payments.Payment) (payments.PaymentRequest, error) {
	var out payments.PaymentRequest
	var err error
	if out.ID, err = needStr(raw["id"], "link id"); err != nil {
		return out, err
	}
	out.ReferenceID, _ = guard.Str(raw["reference_id"])
	if out.Amount, err = needNum(raw["amount"], "link amount"); err != nil {
		return out, err
	}
	if err = needINR(field(raw, "currency")); err != nil {
		return out, err
	}
	out.Currency = "INR"
	out.Description, _ = guard.Str(raw["description"])
	if out.Status, err = linkStatus(field(raw, "status")); err != nil {
		return out, err
	}
	if out.PayURL, err = needStr(raw["short_url"], "short_url"); err != nil {
		return out, err
	}
	out.AmountPaid, _ = guard.Int(raw["amount_paid"])
	if paid == nil {
		paid = []payments.Payment{}
	}
	out.Payments = paid
	if out.CreatedAt, err = needNum(raw["created_at"], "link time"); err != nil {
		return out, err
	}
	if raw["accept_partial"] == true {
		min, _ := guard.Int(raw["first_min_partial_amount"])
		out.PartPayments, out.MinFirstPayment = true, &min
	}
	return out, nil
}

// ToRefund reads a refund; nil for one that failed (Razorpay lists failed refunds too, but no money moved).
func ToRefund(raw guard.Object) (*payments.Refund, error) {
	if raw["status"] == "failed" {
		return nil, nil
	}
	var r payments.Refund
	var err error
	if r.ID, err = needStr(raw["id"], "refund id"); err != nil {
		return nil, err
	}
	if r.PaymentID, err = needStr(raw["payment_id"], "refund payment id"); err != nil {
		return nil, err
	}
	if r.Amount, err = needNum(raw["amount"], "refund amount"); err != nil {
		return nil, err
	}
	r.Status = "processed"
	if raw["status"] == "pending" {
		r.Status = "pending"
	}
	if s, ok := guard.Str(raw["receipt"]); ok {
		r.Receipt = &s
	}
	if r.CreatedAt, err = needNum(raw["created_at"], "refund time"); err != nil {
		return nil, err
	}
	return &r, nil
}

const (
	reconPage     = 100 // Razorpay's rows per page of the recon: 1 to 1000
	reconMaxPages = 200 // a day of one shop is nowhere near this many pages; a reply that never ends is a fault to say, not a loop
)

// ToSettlementRow reads one recon row. A type the docs do not list is "other", never an error (one odd row would fail the whole day's read); a row in another currency is.
func ToSettlementRow(raw guard.Object) (payments.SettlementRow, error) {
	var row payments.SettlementRow
	typ, _ := raw["type"].(string)
	switch typ {
	case "payment", "refund", "transfer", "adjustment":
	default:
		typ = "other"
	}
	if c, present := raw["currency"]; present && c != nil {
		if err := needINR(c); err != nil {
			return row, err
		}
	}
	entity, err := needStr(raw["entity_id"], "settlement row id")
	if err != nil {
		return row, err
	}
	row.EntityID, row.Type = entity, typ
	if s, ok := guard.Str(raw["payment_id"]); ok {
		row.PaymentID = &s
	} else if typ == "payment" {
		if s, ok := guard.Str(raw["entity_id"]); ok {
			row.PaymentID = &s
		}
	}
	row.Amount, _ = guard.Int(raw["amount"])
	row.Fee, _ = guard.Int(raw["fee"])
	row.Tax, _ = guard.Int(raw["tax"])
	row.Debit, _ = guard.Int(raw["debit"])
	row.Credit, _ = guard.Int(raw["credit"])
	row.OnHold = raw["on_hold"] == true
	row.Settled = raw["settled"] == true
	if s, ok := guard.Str(raw["settlement_id"]); ok {
		row.SettlementID = &s
	}
	if s, ok := guard.Str(raw["settlement_utr"]); ok {
		row.UTR = &s
	}
	if n, ok := guard.Int(raw["settled_at"]); ok {
		row.SettledAt = &n
	}
	return row, nil
}

// ---- the client --------------------------------------------------------------------------------------------------------------------

// Client is the live adapter: all calls go through guard.Http with no key of Razorpay's, because the Guard in front adds the credential.
type Client struct{ http guard.Http }

// New is createRazorpayPayments.
func New(c Config) (*Client, error) {
	h, err := guard.New(c.BaseURL, "Razorpay", c.TimeoutMs, c.AgentToken)
	if err != nil {
		return nil, err
	}
	return &Client{http: h}, nil
}

// NewWithHTTP builds the client over any guard.Http (a test's, or a stand-in's).
func NewWithHTTP(h guard.Http) *Client { return &Client{http: h} }

var _ payments.Payments = (*Client)(nil)
var _ payments.SettlementReader = (*Client)(nil)

// paymentsOf: a link's payments come from the payments record, so their refunds are known. A payment that cannot be read keeps what the link says; a Guard that refuses or cannot
// answer is not "cannot be read": that is raised.
func (c *Client) paymentsOf(ctx context.Context, link guard.Object) ([]payments.Payment, error) {
	out := []payments.Payment{}
	linkID := jsString(field(link, "id"))
	for _, item := range guard.AsArray(link["payments"]) {
		o, ok := guard.IsObject(item)
		if !ok {
			continue
		}
		thin, err := embeddedPayment(o, linkID)
		if err != nil {
			return nil, err
		}
		if thin == nil {
			continue
		}
		full, err := c.fetchPaymentRecord(ctx, thin.ID)
		if err != nil {
			if _, isGuard := guard.AsGuard(err); isGuard {
				return nil, err
			}
			full = nil
		}
		if full != nil {
			f := *full
			f.RequestID = thin.RequestID
			out = append(out, f)
		} else {
			out = append(out, *thin)
		}
	}
	return out, nil
}

// fetchPaymentRecord: a payment record does not name the link it paid (link_id is ""); nil when Razorpay has no such payment or it never captured.
func (c *Client) fetchPaymentRecord(ctx context.Context, id string) (*payments.Payment, error) {
	reply, err := c.http.Request(ctx, "GET", "/v1/payments/"+guard.EncodeURIComponent(id), guard.Options{})
	if err != nil {
		return nil, err
	}
	if isMissing(reply) {
		return nil, nil
	}
	raw, err := expectOK(reply)
	if err != nil {
		return nil, err
	}
	return ToPayment(raw, "")
}

func refundPath(paymentID string) string {
	return "/v1/payments/" + guard.EncodeURIComponent(paymentID) + "/refund"
}

func refundReply(reply guard.Reply) (payments.Refund, error) {
	if isMissing(reply) {
		return payments.Refund{}, &guard.ApiError{Status: 404, Message: "No such payment."}
	}
	raw, err := expectOK(reply)
	if err != nil {
		return payments.Refund{}, err
	}
	r, err := ToRefund(raw)
	if err != nil {
		return payments.Refund{}, err
	}
	if r == nil {
		return payments.Refund{}, &guard.ApiError{Status: 502, Message: "Razorpay accepted the refund but reports it as failed."}
	}
	if reply.Replayed {
		r.Replayed = true
	}
	return *r, nil
}

// linkBody is the body of POST /v1/payment_links, the keys in the TypeScript literal's order.
type linkBody struct {
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	ReferenceID    string `json:"reference_id"`
	Description    string `json:"description"`
	AcceptPartial  bool   `json:"accept_partial"`
	FirstMinPart   *int64 `json:"first_min_partial_amount,omitempty"`
	Notify         notify `json:"notify"`
	ReminderEnable bool   `json:"reminder_enable"`
}
type notify struct {
	SMS   bool `json:"sms"`
	Email bool `json:"email"`
}

// refundBody is the body of a refund: `receipt` is left out when none was given.
type refundBody struct {
	Amount  int64   `json:"amount"`
	Receipt *string `json:"receipt,omitempty"`
}

func (c *Client) CreateRequest(ctx context.Context, r payments.NewPaymentRequest) (payments.PaymentRequest, error) {
	b := linkBody{Amount: r.Amount, Currency: "INR", ReferenceID: r.ReferenceID, Description: r.Description, AcceptPartial: r.PartPayments}
	if r.PartPayments {
		min := int64(100)
		if r.MinFirstPayment != nil {
			min = *r.MinFirstPayment
		}
		b.FirstMinPart = &min
	}
	reply, err := c.http.Request(ctx, "POST", "/v1/payment_links", guard.Options{Body: b})
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	// A reference_id used before answers 400 "payment link creation with reference ID already attempted": an ApiError, and the agent looks the link up before it tries again.
	raw, err := expectOK(reply)
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	return ToPaymentRequest(raw, nil)
}

func (c *Client) FetchRequest(ctx context.Context, id string) (*payments.PaymentRequest, error) {
	reply, err := c.http.Request(ctx, "GET", "/v1/payment_links/"+guard.EncodeURIComponent(id), guard.Options{})
	if err != nil {
		return nil, err
	}
	if isMissing(reply) {
		return nil, nil
	}
	raw, err := expectOK(reply)
	if err != nil {
		return nil, err
	}
	paid, err := c.paymentsOf(ctx, raw)
	if err != nil {
		return nil, err
	}
	pr, err := ToPaymentRequest(raw, paid)
	if err != nil {
		return nil, err
	}
	return &pr, nil
}

func (c *Client) ListRequests(ctx context.Context, q payments.ListQuery) ([]payments.PaymentRequest, error) {
	var query []guard.Param
	if q.ReferenceID != "" {
		query = append(query, guard.Param{Key: "reference_id", Value: q.ReferenceID})
	}
	if q.PaymentID != "" {
		query = append(query, guard.Param{Key: "payment_id", Value: q.PaymentID})
	}
	reply, err := c.http.Request(ctx, "GET", "/v1/payment_links", guard.Options{Query: query})
	if err != nil {
		return nil, err
	}
	raw, err := expectOK(reply)
	if err != nil {
		return nil, err
	}
	// Payments inside a list are as thin as the docs show them (often empty): they are passed on without refund figures. FetchRequest has the full record.
	out := []payments.PaymentRequest{}
	for _, item := range guard.AsArray(raw["payment_links"]) {
		l, ok := guard.IsObject(item)
		if !ok {
			continue
		}
		var paid []payments.Payment
		for _, pi := range guard.AsArray(l["payments"]) {
			po, ok := guard.IsObject(pi)
			if !ok {
				continue
			}
			p, err := embeddedPayment(po, jsString(field(l, "id")))
			if err != nil {
				return nil, err
			}
			if p != nil {
				paid = append(paid, *p)
			}
		}
		pr, err := ToPaymentRequest(l, paid)
		if err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	return out, nil
}

func (c *Client) CancelRequest(ctx context.Context, id string) (payments.PaymentRequest, error) {
	reply, err := c.http.Request(ctx, "POST", "/v1/payment_links/"+guard.EncodeURIComponent(id)+"/cancel", guard.Options{})
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	if isMissing(reply) {
		return payments.PaymentRequest{}, &guard.ApiError{Status: 404, Message: "No such payment link."}
	}
	raw, err := expectOK(reply)
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	paid, err := c.paymentsOf(ctx, raw)
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	return ToPaymentRequest(raw, paid)
}

func (c *Client) FetchPayment(ctx context.Context, id string) (*payments.Payment, error) {
	return c.fetchPaymentRecord(ctx, id)
}

func askedBy(ids []string) map[string]string {
	if len(ids) == 0 {
		return nil
	}
	joined := ""
	for i, id := range ids {
		if i > 0 {
			joined += ","
		}
		joined += id
	}
	return map[string]string{"Geo-Requested-By": joined}
}

// Refund asks for a refund. B37: who asked for it goes for Guard alone (it strips the header and keeps it out of the call's digest); the body is the same bytes either way.
func (c *Client) Refund(ctx context.Context, paymentID string, r payments.RefundRequest) (payments.Refund, error) {
	b := refundBody{Amount: r.Amount}
	if r.HasReceipt {
		b.Receipt = &r.Receipt
	}
	reply, err := c.http.Request(ctx, "POST", refundPath(paymentID), guard.Options{Body: b, Headers: askedBy(r.RequestedBy)})
	if err != nil {
		return payments.Refund{}, err
	}
	return refundReply(reply)
}

// ResendRefund sends the bytes of a call Guard held, exactly as they were: Guard releases a call only if it is the same call.
func (c *Client) ResendRefund(ctx context.Context, paymentID, body string, requestedBy []string) (payments.Refund, error) {
	reply, err := c.http.Request(ctx, "POST", refundPath(paymentID), guard.Options{RawBody: &body, Headers: askedBy(requestedBy)})
	if err != nil {
		return payments.Refund{}, err
	}
	return refundReply(reply)
}

func (c *Client) ListRefunds(ctx context.Context, paymentID string) ([]payments.Refund, error) {
	reply, err := c.http.Request(ctx, "GET", "/v1/payments/"+guard.EncodeURIComponent(paymentID)+"/refunds", guard.Options{Query: []guard.Param{{Key: "count", Value: "100"}}})
	if err != nil {
		return nil, err
	}
	if isMissing(reply) {
		return []payments.Refund{}, nil
	}
	raw, err := expectOK(reply)
	if err != nil {
		return nil, err
	}
	out := []payments.Refund{}
	for _, item := range guard.AsArray(raw["items"]) {
		o, ok := guard.IsObject(item)
		if !ok {
			continue
		}
		r, err := ToRefund(o)
		if err != nil {
			return nil, err
		}
		if r != nil {
			out = append(out, *r)
		}
	}
	return out, nil
}

// ReadSettlements reads the whole day's recon rows, page by page (count and skip), through Guard's read-only route. A page that fails is raised: the caller reads the day again, never
// guesses.
func (c *Client) ReadSettlements(ctx context.Context, day payments.Day, pageSize int) ([]payments.SettlementRow, error) {
	count := pageSize
	if count <= 0 {
		count = reconPage
	}
	rows := []payments.SettlementRow{}
	for page := 0; page < reconMaxPages; page++ {
		reply, err := c.http.Request(ctx, "GET", "/v1/settlements/recon/combined", guard.Options{Query: []guard.Param{
			{Key: "year", Value: guard.Itoa(int64(day.Year))}, {Key: "month", Value: guard.Itoa(int64(day.Month))}, {Key: "day", Value: guard.Itoa(int64(day.Day))},
			{Key: "count", Value: guard.Itoa(int64(count))}, {Key: "skip", Value: guard.Itoa(int64(page * count))}}})
		if err != nil {
			return nil, err
		}
		raw, err := expectOK(reply)
		if err != nil {
			return nil, err
		}
		n := 0
		for _, item := range guard.AsArray(raw["items"]) {
			o, ok := guard.IsObject(item)
			if !ok {
				continue
			}
			n++
			row, err := ToSettlementRow(o)
			if err != nil {
				return nil, err
			}
			rows = append(rows, row)
		}
		if n < count {
			return rows, nil
		}
	}
	return nil, &guard.ApiError{Status: 502, Message: "Razorpay's settlement rows for one day did not end."}
}
