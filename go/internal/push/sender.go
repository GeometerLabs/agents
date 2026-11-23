package push

// Sending the waiting pushes (modules/push/sender.ts, plan item 11h, decision 45): each one encrypted for its phone (RFC 8291) and signed with the shop's VAPID key (RFC 8292) here, on the
// shop's runtime, then handed to the shop's push Guard as a small JSON (Call). Guard checks the push service's host against its exact list and counts the push against the shop's daily
// caps; only then does the server's push sender make the real request. So every push goes out through a Guard, and nothing on the way can read what it says.
//
// It runs outside the shop's steps, on its own short timer and when a push is queued (Kick), because an alert must never hold a step up, and a push service that is down must not fail
// one. What came of each push is kept in the store: sent, gone (the phone dropped the subscription: it is forgotten), refused (Guard's rules or a daily count: never tried again), or tried
// again later with a growing wait. TypeScript's `fetch` with a 20 s timeout is net/http's client with the same timeout.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Guard is where the shop's push Guard is and the credential this runtime presents to it (runtime.json services.push).
type Guard struct{ BaseURL, AgentToken string }

// Relay is how a shop reaches the Streetlist app's phones (W3): the shop's name on its server, which the relay checks, and its address name on the pages domain (from its pages file).
type Relay struct {
	Shop string
	Slug func() string
}

// Payload is what a phone's service worker receives, inside the encryption: the words and a tag. The worker opens its own page when tapped; no address travels.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Tag   string `json:"tag"`
	Slug  string `json:"slug,omitempty"`
}

// How long a push service may keep an owner's alert (a day: the owner's app lists everything anyway) and a customer's (12 hours).
const (
	OwnerTTL    = 24 * 60 * 60
	CustomerTTL = 12 * 60 * 60
)

// spaces is what JavaScript's `\s` matches (Go's `\s` is ASCII only and leaves out \v).
var spaces = regexp.MustCompile(`[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+`)

// FitNotification cuts the words to fit a phone's notification (sender.ts fitNotification): one line, at most `max` letters, an ellipsis when cut. `[...one].length` counts code points, as []rune does.
func FitNotification(text string, max int) string {
	one := strings.TrimFunc(spaces.ReplaceAllString(text, " "), func(r rune) bool { return r == ' ' })
	if utf8.RuneCountInString(one) <= max {
		return one
	}
	return string([]rune(one)[:max-1]) + "…"
}

// SenderOptions are what the sender needs.
type SenderOptions struct {
	Store   *Store
	Guard   *Guard // nil: no push Guard, nothing is sent (pushes wait)
	Subject func() string
	Now     func() int64
	Relay   *Relay
	Log     func(string)
	Client  *http.Client
	Every   time.Duration
	// OnPanic, when set, is told of a panic in a pass instead of the panic ending the process (the shared host charges it to the shop). Unset: the panic propagates as before.
	OnPanic func(any)
}

// Sender drains the store's queue to the Guard.
type Sender struct {
	o       SenderOptions
	mu      sync.Mutex // one pass at a time
	kick    chan struct{}
	stop    chan struct{}
	done    chan struct{}
	started bool
}

// NewSender makes a sender; Start runs its timer.
func NewSender(o SenderOptions) *Sender {
	if o.Log == nil {
		o.Log = func(string) {}
	}
	if o.Client == nil {
		o.Client = guard.HTTPClient(nil, 20*time.Second) // held to this machine in the hand check's shop (guard/loopback.go)
	}
	if o.Every == 0 {
		o.Every = 15 * time.Second
	}
	return &Sender{o: o, kick: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
}

var reasonCode = regexp.MustCompile(`"reason_code"\s*:\s*"([a-z_]+)"`)

// guardRefusal says whether a 403's body is the push Guard's own and, if so, what to log. Guard marks every answer with a `guard` object whose `decision` and `code` are words (a rule
// refusal is {decision: deny, code: refused_by_policy} with no reason_code; a limit adds reason_code limit_exceeded). The push service's own 403 has neither, so only that one drops
// the subscription. The `reason_code` text alone still counts, as before (modules/push/sender.ts guardRefusal does the same).
func guardRefusal(text []byte) (string, bool) {
	var body any
	if json.Unmarshal(text, &body) == nil {
		if g, ok := guard.GuardObject(body); ok {
			if g.ReasonCode != "" {
				return g.ReasonCode, true
			}
			return g.Code, true
		}
	}
	if m := reasonCode.FindSubmatch(text); m != nil {
		return string(m[1]), true
	}
	return "", false
}

// one sends one push through the Guard. The Guard's own answers (403 refused, 502 provider unreachable) and the push service's (201, 404, 410, 413, 429) are told apart.
func (s *Sender) one(w Waiting) {
	st, o := s.o.Store, s.o
	now := o.Now()
	var subject string
	if o.Subject != nil {
		subject = o.Subject()
	}
	// a phone of the Streetlist app is signed by Streetlist's relay, not here (the shop never holds that key); a shop with no relay cannot reach it at all
	relayed := w.Sub.Signer == "streetlist"
	if relayed && o.Relay == nil {
		o.Log("A push for a Streetlist app phone was not sent: this shop has no relay.")
		_ = st.Settle(w.ID, "refused", now, 0)
		return
	}
	if o.Guard == nil || (!relayed && subject == "") {
		_ = st.Settle(w.ID, "later", now, 0)
		return
	}
	payload := Payload{Title: w.Title, Body: w.Body, Tag: w.Tag}
	if relayed {
		payload.Slug = o.Relay.Slug()
	}
	var pb bytes.Buffer
	enc := json.NewEncoder(&pb) // JSON.stringify does not escape < > &
	enc.SetEscapeHTML(false)
	_ = enc.Encode(payload)
	body, err := EncryptPush(bytes.TrimRight(pb.Bytes(), "\n"), w.Sub.P256dh, w.Sub.Auth, 128)
	if err != nil {
		o.Log("A push could not be encrypted (" + err.Error() + "); the phone's subscription is dropped.")
		_ = st.Drop(w.Sub.ID, "bad_keys", now)
		return
	}
	call := Call{Host: w.Sub.Host, Path: w.Sub.Path, Sub: w.Sub.ID, TTL: CustomerTTL, Urgency: "normal", Topic: w.Kind + "-" + w.Sub.ID, Body: b64u.EncodeToString(body)}
	if w.Kind == "owner" {
		call.TTL, call.Urgency = OwnerTTL, "high" // one topic per phone and kind: a phone that was offline gets the newest alert, not a pile
	}
	if relayed {
		call.Relay = o.Relay.Shop
	} else {
		keys, err := st.Vapid()
		if err == nil {
			call.Vapid, err = VapidHeader(keys, "https://"+w.Sub.Host, subject, now/1000)
		}
		if err != nil {
			o.Log("A push could not be signed (" + err.Error() + ").")
			_ = st.Settle(w.ID, "later", now, 0)
			return
		}
	}
	status, reason, refusedByGuard := 0, "", false
	var cb bytes.Buffer
	cenc := json.NewEncoder(&cb)
	cenc.SetEscapeHTML(false)
	_ = cenc.Encode(call)
	payloadJSON := bytes.TrimRight(cb.Bytes(), "\n")
	req, err := http.NewRequest("POST", strings.TrimRight(o.Guard.BaseURL, "/")+Routes[w.Kind], bytes.NewReader(payloadJSON))
	if err == nil {
		req.Header.Set("content-type", "application/json")
		if o.Guard.AgentToken != "" {
			req.Header.Set("authorization", "Bearer "+o.Guard.AgentToken)
		}
		if resp, err := o.Client.Do(req); err == nil {
			status = resp.StatusCode
			text, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
			resp.Body.Close()
			reason, refusedByGuard = guardRefusal(text)
		}
	}
	at := o.Now()
	switch {
	case status >= 200 && status < 300:
		_ = st.Settle(w.ID, "sent", at, status)
	case status == 404 || status == 410:
		_ = st.Drop(w.Sub.ID, "gone", at)
		_ = st.Settle(w.ID, "gone", at, status)
	case status == 403 && refusedByGuard:
		// Guard's refusal (its answer carries Guard's `guard` object, with or without a reason_code): its rules or a daily count. Not tried again (the count is the point); the owner's app still lists what waits.
		o.Log("A push was refused by the push Guard (" + reason + ").")
		_ = st.Settle(w.ID, "refused", at, status)
	case status == 401 || status == 403:
		// the push service's own 401 or 403: the subscription was made for another key (the shop's server restored, or set up again). The phone subscribes again when its page is
		// opened next; this one is forgotten
		_ = st.Drop(w.Sub.ID, "key", at)
		_ = st.Settle(w.ID, "gone", at, status)
	case status == 400 || status == 413:
		_ = st.Settle(w.ID, "failed", at, status)
	default:
		_ = st.Settle(w.ID, "later", at, status)
	}
}

// Pass sends what is due, one at a time (a shop has few phones), then tidies. Never two passes at once: one asked while another runs waits for it.
func (s *Sender) Pass() {
	s.mu.Lock()
	defer s.mu.Unlock()
	due, err := s.o.Store.Due(s.o.Now(), 20)
	if err != nil {
		s.o.Log("The push sender stopped a pass: " + err.Error())
		return
	}
	for _, w := range due {
		s.one(w)
	}
	if err := s.o.Store.Tidy(s.o.Now()); err != nil {
		s.o.Log("The push sender stopped a pass: " + err.Error())
	}
}

// Kick asks for a pass soon (after a push is queued).
func (s *Sender) Kick() {
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// Start runs the passes on a timer and on Kick, until Stop. A pass asked for while the sender is not started waits for Start.
func (s *Sender) Start() {
	if s.started {
		return
	}
	s.started = true
	go func() {
		defer close(s.done)
		t := time.NewTicker(s.o.Every)
		defer t.Stop()
		s.safePass() // what was queued when the last process stopped
		for {
			select {
			case <-s.stop:
				return
			case <-s.kick:
				s.safePass()
			case <-t.C:
				s.safePass()
			}
		}
	}()
}

// safePass is Pass with the panic contained when the host asked for that (OnPanic): the loop goes on to the next pass.
func (s *Sender) safePass() {
	if s.o.OnPanic != nil {
		defer func() {
			if p := recover(); p != nil {
				s.o.OnPanic(p)
			}
		}()
	}
	s.Pass()
}

// Stop finishes the pass in hand and stops the timer.
func (s *Sender) Stop() {
	if !s.started {
		return
	}
	close(s.stop)
	<-s.done
	s.started = false
}
