package bookings

// What a customer can mean in a booking conversation (src/adapters/model.ts Intent), the check that what a parser or a model returned is really one (coerceIntent: a model's answer
// is untrusted input, decoded to `any` and checked by hand), and how a tapped button or list row becomes an Intent with no model (src/language/interactive.ts intentFromReply).

import (
	"math"
	"regexp"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// IntentKinds is model.ts KINDS, in its order.
var IntentKinds = []string{"book", "cancel", "reschedule", "yes", "no", "stop", "greeting", "owner", "keep", "paid", "unknown"}

// Intent is model.ts Intent; Date and Time are kept as the checked objects they came as (coerceIntent copies them whole), nil when absent.
type Intent struct {
	Kind            string         `json:"kind"`
	Language        string         `json:"language,omitempty"`
	ServiceID       string         `json:"serviceId,omitempty"`
	OfferInr        *int64         `json:"offerInr,omitempty"`
	Date            map[string]any `json:"date,omitempty"`
	Time            map[string]any `json:"time,omitempty"`
	OverrideAttempt *bool          `json:"overrideAttempt,omitempty"`
	Ask             *bool          `json:"ask,omitempty"`
}

func wholeIn(v any, lo, hi float64) bool {
	n, ok := v.(float64)
	return ok && n == math.Trunc(n) && n >= lo && n <= hi
}

// CoerceIntent is model.ts coerceIntent: nil for anything that is not an Intent of this shop (an unknown kind, a service it does not have, an hour of 99, a negative price).
func CoerceIntent(raw any, s *Settings) *Intent {
	m, ok := raw.(map[string]any)
	kind, _ := m["kind"].(string)
	if !ok || !contains(IntentKinds, kind) {
		return nil
	}
	in := &Intent{Kind: kind}
	if v, given := m["language"]; given {
		l, _ := v.(string)
		if !contains(runtime.LANGUAGES, l) {
			return nil
		}
		in.Language = l
	}
	if v, given := m["serviceId"]; given {
		id, _ := v.(string)
		if s.ServiceByID(id) == nil {
			return nil
		}
		in.ServiceID = id
	}
	if v, given := m["offerInr"]; given {
		if !wholeIn(v, 0, math.MaxFloat64) {
			return nil
		}
		n := int64(v.(float64))
		in.OfferInr = &n
	}
	if v, given := m["date"]; given {
		d, isObj := v.(map[string]any)
		ok := isObj && ((d["kind"] == "relative" && (d["offsetDays"] == 0.0 || d["offsetDays"] == 1.0 || d["offsetDays"] == 2.0)) ||
			(d["kind"] == "weekday" && wholeIn(d["weekday"], 0, 6) && (d["which"] == "next" || d["which"] == "this" || d["which"] == "plain")) ||
			(d["kind"] == "calendar" && wholeIn(d["day"], 1, 31) && wholeIn(d["month"], 1, 12)))
		if !ok {
			return nil
		}
		in.Date = d
	}
	if v, given := m["time"]; given {
		t, isObj := v.(map[string]any)
		p, hasPeriod := t["period"]
		ok := isObj && wholeIn(t["hour"], 0, 23) && wholeIn(t["minute"], 0, 59) &&
			(!hasPeriod || ((p == "am" || p == "pm") && wholeIn(t["hour"], 1, 12))) // "18:00 pm" would be hour 30
		if !ok {
			return nil
		}
		in.Time = t
	}
	if v, given := m["overrideAttempt"]; given {
		b := v == true
		in.OverrideAttempt = &b
	}
	if v, given := m["ask"]; given {
		b := v == true
		in.Ask = &b
	}
	return in
}

var (
	replyService = regexp.MustCompile(`^svc:([a-z0-9-]{1,60})$`)
	replySlot    = regexp.MustCompile(`^slot:(\d{1,15})$`)
)

// IntentFromReply is interactive.ts intentFromReply: the ids the shop's own buttons and rows carry; nil for any other id (a tap of something never offered).
func IntentFromReply(id string, s *Settings) *Intent {
	yes := true
	switch id {
	case "yes", "no", "keep", "owner", "paid":
		return &Intent{Kind: id}
	case "cancel":
		return &Intent{Kind: "cancel", Ask: &yes}
	case "cancel_yes":
		return &Intent{Kind: "cancel"}
	case "menu":
		return &Intent{Kind: "greeting"}
	}
	if m := replyService.FindStringSubmatch(id); m != nil {
		if s.ServiceByID(m[1]) == nil {
			return nil
		}
		return &Intent{Kind: "book", ServiceID: m[1]}
	}
	if m := replySlot.FindStringSubmatch(id); m != nil {
		ms, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil || ms > 9007199254740991 {
			return nil
		}
		p := zone.LocalParts(ms, s.Timezone)
		hour, period := p.Hour%12, "am"
		if hour == 0 {
			hour = 12
		}
		if p.Hour >= 12 {
			period = "pm"
		}
		// the very minute, as a calendar date and a time with am/pm, so nothing is left to read back or to guess
		return &Intent{Kind: "book", Date: map[string]any{"kind": "calendar", "day": p.Day, "month": p.Month}, Time: map[string]any{"hour": hour, "minute": p.Minute, "period": period}}
	}
	return nil
}
