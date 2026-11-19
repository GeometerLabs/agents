package guard

// The one way the live clients talk HTTP (the Go twin of modules/core/http.ts). They hold no keys: no Authorization header goes out unless an agent token file was given (the credential a
// Guard asks of the AGENT, which Guard removes before it forwards). Each client points at a base URL, which in production is a Guard in front of that one service and in a test is a
// stand-in; the same code runs against all of them.
//
// What a failure means (the agent looks before it retries, so the difference matters):
//   - no reply (timeout, a connection cut after the request went out): the call MAY have happened, a TimeoutError;
//   - the connection was refused or the host is unknown: nothing was sent, a NotSentError;
//   - an answer with a `guard` object: GUARD decided, never the service's reply whatever its status (a held call is a 202). It becomes a GuardError in ONE place, Classify;
//   - a 2xx with `Guard-Replayed: true`: the service's first reply, from Guard's record, marked Replayed;
//   - anything else is the service's own reply, passed through: the client reads it, and any other non-2xx is its to turn into an ApiError.

import (
	"context"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// DefaultTimeoutMs is http.ts DEFAULT_TIMEOUT_MS.
const DefaultTimeoutMs = 10_000

// Reply is what the service answered (http.ts HttpReply). Body is nil when the reply had no body; a body that was not JSON on a non-2xx is {"raw": the first 200 characters}.
type Reply struct {
	Status int
	Body   any
	// Replayed: Guard answered from its record instead of sending again (`Guard-Replayed: true`).
	Replayed bool
}

// Options is http.ts HttpRequestOptions. At most one of Body, RawBody and Form is used, in that order (the TypeScript's order).
type Options struct {
	Query []Param
	// Body is serialised with JSText. A nil Body sends none.
	Body any
	// RawBody are the exact bytes to send, for a call Guard held: it is sent again with the bytes it was held with.
	RawBody *string
	// Form is sent as application/x-www-form-urlencoded (Gupshup's self-serve API).
	Form []Param
	// Headers are words for Guard itself (Geo-Requested-By, which Guard strips before it forwards); never a key of the service. authorization, host, content-type, content-length and
	// accept are ignored, as the TypeScript ignores them.
	Headers map[string]string
}

// Http is what a service client calls; tests and stand-ins can implement it.
type Http interface {
	Request(ctx context.Context, method, path string, o Options) (Reply, error)
}

var reservedHeader = regexp.MustCompile(`(?i)^(authorization|host|content-type|content-length|accept)$`)

// Client is the live Http: net/http, the Guard's base URL, an optional agent token.
type Client struct {
	BaseURL    string
	What       string
	Timeout    time.Duration
	AgentToken string
	HTTP       *http.Client
}

// New is createHttp: a base URL that holds a password or key is refused (keys belong to Guard, not to the runtime). timeoutMs <= 0 is the default of 10 seconds.
func New(baseURL, what string, timeoutMs int, agentToken string) (*Client, error) {
	if err := CheckBaseURL(baseURL, what); err != nil {
		return nil, err
	}
	if timeoutMs <= 0 {
		timeoutMs = DefaultTimeoutMs
	}
	// no keep-alive: net/http would quietly send a GET again on a cut connection, and a call that may have happened must be seen to have failed once
	return &Client{BaseURL: baseURL, What: what, Timeout: time.Duration(timeoutMs) * time.Millisecond, AgentToken: agentToken, HTTP: &http.Client{Transport: &http.Transport{DisableCompression: true, DisableKeepAlives: true, Proxy: nil}}}, nil
}

// CheckBaseURL is http.ts checkBaseUrl.
func CheckBaseURL(baseURL, what string) error {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme == "" || u.Host == "" && u.Scheme != "http" && u.Scheme != "https" {
		return errors.New(what + ": \"" + baseURL + "\" is not a web address.")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New(what + ": the base URL must start with http:// or https://.")
	}
	if u.User != nil {
		return errors.New(what + ": the base URL must not hold a user name or password. Keys belong to Guard, not to the runtime.")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return errors.New(what + ": the base URL must not have a query or fragment.")
	}
	return nil
}

// JoinURL is http.ts joinUrl: plain concatenation, so a path prefix on the base (http://localhost:8790/razorpay) is kept.
func JoinURL(baseURL, path string, query []Param) string {
	qs := QueryString(query)
	if qs != "" {
		qs = "?" + qs
	}
	return strings.TrimRight(baseURL, "/") + path + qs
}

// Request sends one call and classifies the answer. The timeout covers the whole call, the body read included (AbortSignal.timeout does).
func (c *Client) Request(ctx context.Context, method, path string, o Options) (Reply, error) {
	target := JoinURL(c.BaseURL, path, o.Query)
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	headers := [][2]string{{"accept", "application/json"}}
	for k, v := range o.Headers {
		if !reservedHeader.MatchString(k) {
			headers = append(headers, [2]string{strings.ToLower(k), v})
		}
	}
	if c.AgentToken != "" {
		headers = append(headers, [2]string{"authorization", "Bearer " + c.AgentToken})
	}
	var body string
	hasBody := false
	switch {
	case o.RawBody != nil:
		body, hasBody = *o.RawBody, true
		headers = append(headers, [2]string{"content-type", "application/json"})
	case o.Body != nil:
		s, err := JSText(o.Body)
		if err != nil {
			return Reply{}, err
		}
		body, hasBody = s, true
		headers = append(headers, [2]string{"content-type", "application/json"})
	case o.Form != nil:
		body, hasBody = QueryString(o.Form), true
		headers = append(headers, [2]string{"content-type", "application/x-www-form-urlencoded"})
	}
	var rd io.Reader
	if hasBody {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, rd)
	if err != nil {
		return Reply{}, &NotSentError{Message: c.What + ": could not connect (ERR_INVALID_URL).", Code: "ERR_INVALID_URL"}
	}
	for _, h := range headers {
		req.Header.Set(h[0], h[1])
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if code := notSentCode(err, ctx); code != "" {
			return Reply{}, &NotSentError{Message: c.What + ": could not connect (" + code + ").", Code: code}
		}
		return Reply{}, &TimeoutError{What: c.What} // timed out, or the connection was cut after the request left: it may have happened
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return Reply{}, &TimeoutError{What: c.What} // the reply broke off half way
	}
	text := string(raw)
	var parsed any
	if len(text) > 0 {
		v, perr := Decode(text)
		switch {
		case perr == nil:
			parsed = v
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return Reply{}, &TimeoutError{What: c.What} // a 2xx we cannot read is a lost reply
		default:
			parsed = map[string]any{"raw": language.UTF16Slice(text, 200)}
		}
	}
	call := SentCall{Method: method, Path: path, Body: body, HasBody: hasBody}
	if decided := Classify(resp.StatusCode, resp.Header, parsed, call); decided != nil {
		return Reply{}, decided // Guard's decision, before any client reads the body
	}
	replayed := resp.StatusCode >= 200 && resp.StatusCode < 300 && strings.EqualFold(resp.Header.Get("guard-replayed"), "true")
	return Reply{Status: resp.StatusCode, Body: parsed, Replayed: replayed}, nil
}

// notSentCode is the Node network error code of a failure that happened before anything was sent ("" for any other failure, which is a lost reply).
func notSentCode(err error, ctx context.Context) string {
	if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
		return ""
	}
	var op *net.OpError
	if !errors.As(err, &op) || op.Op != "dial" {
		return ""
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		if dns.IsNotFound {
			return "ENOTFOUND"
		}
		return "EAI_AGAIN"
	}
	var errno syscall.Errno
	var se *os.SyscallError
	if errors.As(err, &se) && errors.As(se.Err, &errno) || errors.As(err, &errno) {
		switch errno {
		case syscall.ECONNREFUSED:
			return "ECONNREFUSED"
		case syscall.EHOSTUNREACH:
			return "EHOSTUNREACH"
		case syscall.ENETUNREACH:
			return "ENETUNREACH"
		}
	}
	return ""
}

// ---- Guard's answers, told apart in one place ----------------------------------------------------------------------------------------

// GuardObject is the `guard` object of a body, if it is Guard's. Both `decision` and `code` must be words: a service's own body that happens to have a `guard` key is not Guard.
func GuardObject(body any) (GuardInfo, bool) {
	g, ok := IsObject(Get(body, "guard"))
	if !ok {
		return GuardInfo{}, false
	}
	decision, ok1 := Str(g["decision"])
	code, ok2 := Str(g["code"])
	if !ok1 || !ok2 {
		return GuardInfo{}, false
	}
	info := GuardInfo{Decision: decision, Code: code, Sent: "no", Retry: "no"}
	if s, ok := Str(g["sent"]); ok {
		info.Sent = s
	}
	if s, ok := Str(g["retry"]); ok {
		info.Retry = s
	}
	info.ReasonCode, _ = Str(g["reason_code"])
	info.Reason, info.HasReason = Str(g["reason"])
	if d, present := g["detail"]; present {
		info.Detail, info.HasDetail = d, true
	}
	return info, true
}

// milliseconds reads a number or a string of 1 to 16 digits as a whole number of milliseconds >= 0, else nil.
func milliseconds(v any) *int64 {
	if s, ok := v.(string); ok {
		if len(s) < 1 || len(s) > 16 {
			return nil
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return nil
			}
		}
		var n int64
		for _, c := range s {
			n = n*10 + int64(c-'0')
		}
		return &n
	}
	if n, ok := Int(v); ok && n >= 0 {
		return &n
	}
	return nil
}

// A limit's refusal and a rule's are the same status and the same code; only the words of the reason tell them apart ("limit <id> would be exceeded ...").
var (
	limitReason = regexp.MustCompile(`(?i)^limit[` + language.JSSpace + `]+([^` + language.JSSpace + `]+)[` + language.JSSpace + `]+would be exceeded`)
	ruleReason  = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9._:/@+-]*):[` + language.JSSpace + `]`)
)

func refusalKind(reason string) (kind, ruleID string) {
	if m := limitReason.FindStringSubmatch(reason); m != nil {
		return "limit", m[1]
	}
	if m := ruleReason.FindStringSubmatch(reason); m != nil {
		return "rule", m[1]
	}
	return "rule", ""
}

// detailObject is the `detail` of a Guard answer as an object, or an empty one.
func detailObject(g GuardInfo) Object {
	if o, ok := IsObject(g.Detail); ok {
		return o
	}
	return Object{}
}

// cut is `.slice(0, n)` of a string in UTF-16 units.
func cut(s string, n int) string { return language.UTF16Slice(s, n) }

// Classify is http.ts classify: is this answer Guard's decision, and if so which? Returns the error, or nil when the answer is the service's own (a replay too). Pure. Anything with
// a `guard` object this code does not know is still a GuardError: a decision Guard made is never read as a success.
func Classify(status int, headers http.Header, body any, call SentCall) *GuardError {
	g, ok := GuardObject(body)
	if !ok {
		return nil
	}
	words := "Guard answered " + Itoa(int64(status)) + "."
	if s, ok := Str(Get(body, "error")); ok {
		words = s
	} else if g.HasReason {
		words = g.Reason
	}
	reason := words
	if g.HasReason {
		reason = g.Reason
	}
	base := GuardError{Status: status, Message: words, Guard: g, Call: call}
	e := base
	switch {
	case g.Decision == "hold" || g.Code == "held_for_approval":
		d := detailObject(g)
		e.Kind = KindHeld
		held := language.TrimJS(headers.Get("guard-held"))
		if a, ok := Str(d["approval"]); ok && len(a) > 0 {
			e.Approval = &a
		} else if held != "" {
			e.Approval = &held
		}
		e.ExpiresAtMs = milliseconds(d["expires_at_ms"])
	case g.Code == "subscription_suspended" || g.ReasonCode == "subscription_suspended":
		e.Kind = KindSuspended
		d := detailObject(g)
		if s, ok := Str(d["state"]); ok && len(s) > 0 {
			e.State = cut(s, 40)
		}
		if s, ok := Str(d["operation"]); ok && len(s) > 0 {
			e.Operation = cut(s, 80)
		}
	case g.Code == "outcome_unknown" || g.Decision == "unknown" || strings.EqualFold(headers.Get("guard-outcome"), "unknown"):
		e.Kind = KindOutcomeUnknown
	case g.Code == "guard_unavailable" || g.Code == "busy" || g.Code == "provider_unreachable":
		e.Kind = KindUnavailable
		if h := language.TrimJS(headers.Get("retry-after")); h != "" {
			if f, ok := parseNumber(h); ok && f >= 0 {
				e.RetryAfterSeconds = &f
			}
		}
	case g.Code == "unauthenticated":
		e.Kind = KindUnauthenticated
	case g.Code == "conflict" && g.ReasonCode == "already_done":
		e.Kind = KindAlreadyDone
		d := detailObject(g)
		if s, ok := Str(d["confirmed_by"]); ok && len(s) > 0 {
			e.ConfirmedBy = cut(s, 200)
		}
		if s, ok := Str(d["intent"]); ok && len(s) > 0 {
			e.Intent = cut(s, 200)
		}
	case g.Code == "conflict":
		e.Kind = KindConflict
	case g.Code == "refused_by_policy" && g.ReasonCode == "denied_by_approver":
		e.Kind = KindDenied
		e.RefusalKind = "rule"
		d := detailObject(g)
		if s, ok := Str(d["approval"]); ok && len(s) > 0 {
			e.DeniedApproval = cut(s, 200)
		}
		if n, ok := Int(d["denied_at_ms"]); ok {
			e.DeniedAtMs = &n
		}
		if n, ok := Int(d["until_ms"]); ok {
			e.UntilMs = &n
		}
	case g.Code == "refused_by_policy":
		e.Kind = KindRefused
		e.RefusalKind, e.RuleID = refusalKind(reason)
	default:
		e.Kind = KindGeneric
	}
	return &e
}

// parseNumber is JavaScript's Number(text) for a finite result.
func parseNumber(text string) (float64, bool) {
	f, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return 0, false
	}
	return f, true
}
