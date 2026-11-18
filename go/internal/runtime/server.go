package runtime

// The runtime's HTTP face (modules/runtime/http.ts): the routes the shop's front, the directory's inbox and the deployer call, each checked against its own token. It takes the
// event, saves it, and only then says 200, so a caller that gets anything else sends it again and nothing is lost and nothing is believed unsaved. Bind to 127.0.0.1 or a private
// network, never the open internet.
//
//	GET  /healthz /readyz                    the process is up / the store can be read and the queue is going (no token)
//	GET  /status                             counts only (the internal token)
//	GET  /internal/owner-session             204 when x-owner-session is good (the internal token): the approvals relay asks, so it never takes the front's word for who the owner is
//	GET/POST /internal/feed-notice           the signed "my feed changed" notice to carry to the directory (the internal token)
//	/internal/channel/...                    the channel token: events (an owner_message, an owner_action, an owner_signin), offer, listings, listing-photo, shop-feed,
//	                                         shop-check, shop-card, owner (the talk-and-cards page), owner-listing, owner-stock, owner-photo, owner-signin, owner-passkey,
//	                                         owner-phones, owner-signout, owner-limits, owner-file, push
//	GET/POST /internal/limit-changes         the deployer's word about a limit change (the internal token)
//
// The owner routes (owner-signin, owner-passkey, owner-phones, owner-signout, the owner's credential on every owner route, /status's lock, owner-session, and the owner's side of
// push) check everything in owner.go, under the owner lock, in the order modules/runtime/http.ts checks it.
//
// The routes of other kinds of shop (a chat, bookings, orders, fees, voice) are not this shop's: they answer 404.

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/signing"
)

// Server serves one shop.
type Server struct {
	rt      *Runtime
	token   [32]byte
	channel *[32]byte
	http    *http.Server
	URL     string
}

type httpError struct {
	status  int
	msg     string
	headers map[string]string
}

func (e httpError) Error() string { return e.msg }

func send(w http.ResponseWriter, status int, v any, extra ...string) {
	b, err := signing.Marshal(v)
	if err != nil {
		status, b = 500, []byte(`{"error":"The runtime could not write its answer."}`)
	}
	h := w.Header()
	h.Set("content-type", "application/json; charset=utf-8")
	h.Set("cache-control", "no-store")
	h.Set("x-content-type-options", "nosniff")
	for i := 0; i+1 < len(extra); i += 2 {
		h.Set(extra[i], extra[i+1])
	}
	h.Set("content-length", fmt.Sprint(len(b)))
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func errBody(msg string) map[string]any { return map[string]any{"error": msg} }

var bearer = regexp.MustCompile(`(?i)^bearer\s+(\S+)$`)

func bearerOf(r *http.Request) (string, bool) {
	m := bearer.FindStringSubmatch(r.Header.Get("authorization"))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// authorised hashes both sides first, so the comparison is the same length and takes the same time for every guess.
func authorised(r *http.Request, want *[32]byte) bool {
	given, ok := bearerOf(r)
	if !ok || want == nil {
		return false
	}
	h := sha256.Sum256([]byte(given))
	return subtle.ConstantTimeCompare(h[:], want[:]) == 1
}

// readBody reads at most max bytes, or fails with 413.
func readBody(r *http.Request, max int64) ([]byte, error) {
	if r.ContentLength > max {
		return nil, httpError{413, fmt.Sprintf("That request is bigger than the %d bytes this endpoint takes.", max), map[string]string{"connection": "close"}}
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, httpError{413, fmt.Sprintf("That request is bigger than the %d bytes this endpoint takes.", max), map[string]string{"connection": "close"}}
	}
	return b, nil
}

// readJSON reads a JSON body; it answers 400 for bad JSON itself and says so with ok=false.
func readJSON(w http.ResponseWriter, r *http.Request, max int64) (any, bool) {
	b, err := readBody(r, max)
	if err != nil {
		var he httpError
		if errors.As(err, &he) {
			send(w, he.status, errBody(he.msg), "connection", "close")
		} else {
			send(w, 400, errBody("The body must be JSON."))
		}
		return nil, false
	}
	var v any
	if json.Unmarshal(b, &v) != nil {
		send(w, 400, errBody("The body must be JSON."))
		return nil, false
	}
	return v, true
}

// NewServer is one shop's HTTP face without a listener: the shared host (internal/shared) routes to Handler() itself. Listen is this plus a listener of its own.
func NewServer(rt *Runtime, token string, channelToken string) *Server {
	s := &Server{rt: rt, token: sha256.Sum256([]byte(token))}
	if channelToken != "" {
		c := sha256.Sum256([]byte(channelToken))
		s.channel = &c
	}
	return s
}

// Handler is the shop's routes as an http.Handler (with the per-request panic recovery).
func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serve) }

// Listen starts serving on host:port (port 0 picks a free one).
func Listen(rt *Runtime, token string, channelToken string, host string, port int) (*Server, error) {
	s := NewServer(rt, token, channelToken)
	ln, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if err != nil {
		if strings.Contains(err.Error(), "address already in use") {
			return nil, fmt.Errorf("Port %d is already in use. Set a different \"port\" in runtime.json.", port)
		}
		return nil, err
	}
	s.URL = "http://" + ln.Addr().String()
	s.http = &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 64 << 10}
	go func() { _ = s.http.Serve(ln) }()
	return s, nil
}

// Close stops listening and waits for the requests in hand.
func (s *Server) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if s.http.Shutdown(ctx) != nil {
		_ = s.http.Close()
	}
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if p := recover(); p != nil {
			s.rt.panicked("request", p)
			send(w, 500, errBody("The runtime could not handle that. Send it again."))
		}
	}()
	if err := s.route(w, r); err != nil {
		var he httpError
		if errors.As(err, &he) {
			send(w, he.status, errBody(he.msg), flat(he.headers)...)
			return
		}
		s.rt.o.Log("Request failed: " + err.Error())
		send(w, 500, errBody("The runtime could not handle that. Send it again."))
	}
}

func flat(m map[string]string) []string {
	var out []string
	for k, v := range m {
		out = append(out, k, v)
	}
	return out
}

func only(r *http.Request, method string) error {
	if r.Method != method {
		return httpError{405, "Use " + method + " here.", map[string]string{"allow": method}}
	}
	return nil
}

func unauthorised(w http.ResponseWriter) {
	send(w, 401, errBody("A bearer token is needed."), "www-authenticate", "Bearer", "connection", "close")
}

var nothing = httpError{404, "There is nothing here.", nil}

func (s *Server) route(w http.ResponseWriter, r *http.Request) error {
	path := r.URL.Path
	if strings.HasPrefix(path, "/internal/channel/") {
		return s.channelRoute(w, r, path)
	}
	switch path {
	case "/healthz":
		if err := only(r, "GET"); err != nil {
			return err
		}
		send(w, 200, map[string]any{"ok": true})
	case "/readyz":
		if err := only(r, "GET"); err != nil {
			return err
		}
		if ok, why := s.rt.Ready(); ok {
			send(w, 200, map[string]any{"ok": true})
		} else {
			send(w, 503, map[string]any{"ok": false, "reason": why})
		}
	case "/status":
		if err := only(r, "GET"); err != nil {
			return err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return nil
		}
		st, err := s.rt.Status()
		if err != nil {
			return err
		}
		// how the owner can sign in and hear (counts only), for the panel's go-live; and (owner control) whether the shop is locked and the Operator's pending request, for the
		// panel to SHOW: the runtime has already decided both, whatever the panel does
		oa, err := s.rt.OwnerAccessStatus()
		if err != nil {
			return err
		}
		st["ownerAccess"] = oa
		send(w, 200, st)
	case "/internal/owner-session":
		if err := only(r, "GET"); err != nil {
			return err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return nil
		}
		if sess, sent := header(r, access.OwnerSessionHeader); sent && s.rt.SessionOK(sess) {
			w.Header().Set("cache-control", "no-store")
			w.WriteHeader(204)
		} else {
			send(w, 403, errBody("That session is not good (it may have ended)."))
		}
	case "/internal/feed-notice":
		return s.feedNotice(w, r)
	case "/internal/limit-changes":
		return s.limitChangesRoute(w, r)
	case "/internal/events":
		if err := only(r, "POST"); err != nil {
			return err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return nil
		}
		send(w, 400, errBody("A listings-only shop takes no events from the inbox: it has no WhatsApp and no payments."))
	default:
		return nothing
	}
	return nil
}

func (s *Server) feedNotice(w http.ResponseWriter, r *http.Request) error {
	if !authorised(r, &s.token) {
		unauthorised(w)
		return nil
	}
	page, _, ok := s.rt.PagesURL()
	if page == "" || !ok {
		w.Header().Set("cache-control", "no-store")
		w.WriteHeader(204)
		return nil
	}
	if r.Method == "GET" {
		notice, fp, err := s.rt.Proto().Notice(page)
		if err != nil {
			return err
		}
		if notice == nil {
			w.Header().Set("cache-control", "no-store")
			w.WriteHeader(204)
			return nil
		}
		send(w, 200, map[string]any{"notice": notice, "fingerprint": fp})
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	body, ok := readJSON(w, r, 1024)
	if !ok {
		return nil
	}
	fp, _ := body.(map[string]any)["fingerprint"].(string)
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(fp) {
		send(w, 400, errBody("fingerprint is the one the notice came with."))
		return nil
	}
	s.rt.Proto().Delivered(fp)
	send(w, 200, map[string]any{"ok": true})
	return nil
}

// header is a request header as Node hands it to http.ts: sent or not, and when sent more than once its values joined with ", " (so a doubled credential header reads as no
// credential at all, the same refusal as TypeScript's, rather than as its first value).
func header(r *http.Request, name string) (string, bool) {
	v := r.Header.Values(name)
	if len(v) == 0 {
		return "", false
	}
	return strings.Join(v, ", "), true
}

// ownerAuthorised: the owner, from the front: the panel-made link against the hash the folder holds now, or a session this runtime made and still holds good (the owner as the
// lock says, the address unchanged, not ended by the panel's sign-out). Both are checked HERE.
func (s *Server) ownerAuthorised(r *http.Request) bool {
	link, _ := header(r, access.OwnerLinkHeader)
	if s.rt.OwnerLinkOK(link) {
		return true
	}
	sess, sent := header(r, access.OwnerSessionHeader)
	return sent && s.rt.SessionOK(sess)
}

var ownerRefused = "The owner's link is not valid (it may have been revoked)."

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

func (s *Server) channelRoute(w http.ResponseWriter, r *http.Request, path string) error {
	if s.channel == nil {
		return nothing
	}
	if !authorised(r, s.channel) {
		unauthorised(w)
		return nil
	}
	rt := s.rt
	switch path {
	case "/internal/channel/events":
		return s.events(w, r)
	case "/internal/channel/offer":
		if err := only(r, "GET"); err != nil {
			return err
		}
		send(w, 200, rt.Offer())
	case "/internal/channel/listings":
		if err := only(r, "GET"); err != nil {
			return err
		}
		send(w, 200, rt.PublicRead())
	case "/internal/channel/listing-photo":
		if err := only(r, "GET"); err != nil {
			return err
		}
		id := r.URL.Query().Get("id")
		if !listings.PhotoID.MatchString(id) {
			send(w, 400, errBody("id is a photo id: ph- and 12 hex digits."))
			return nil
		}
		row, err := rt.Photo(id, s.ownerAuthorised(r))
		if err != nil {
			return err
		}
		if row == nil {
			return nothing
		}
		h := w.Header()
		h.Set("content-type", row.Type)
		h.Set("content-length", fmt.Sprint(len(row.Bytes)))
		h.Set("x-content-type-options", "nosniff")
		h.Set("cache-control", "private, max-age=3600")
		_, _ = w.Write(row.Bytes)
	case "/internal/channel/shop-feed", "/internal/channel/shop-check", "/internal/channel/shop-card":
		return s.signed(w, r, path)
	case "/internal/channel/owner":
		if err := only(r, "GET"); err != nil {
			return err
		}
		if !s.ownerAuthorised(r) {
			send(w, 403, errBody(ownerRefused))
			return nil
		}
		send(w, 200, rt.OwnerPage())
	case "/internal/channel/owner-listing":
		return s.ownerListing(w, r)
	case "/internal/channel/owner-stock":
		return s.ownerStockRoute(w, r)
	case "/internal/channel/owner-photo":
		return s.ownerPhoto(w, r)
	case "/internal/channel/owner-signin":
		return s.ownerSignin(w, r)
	case "/internal/channel/owner-passkey":
		return s.ownerPasskey(w, r)
	case "/internal/channel/owner-phones":
		return s.ownerPhones(w, r)
	case "/internal/channel/owner-limits":
		return s.ownerLimitsRoute(w, r)
	case "/internal/channel/owner-file":
		return s.ownerFileRoute(w, r)
	case "/internal/channel/push":
		return s.pushRoute(w, r)
	case "/internal/channel/owner-signout":
		if err := only(r, "POST"); err != nil {
			return err
		}
		sess, _ := header(r, access.OwnerSessionHeader)
		ended := rt.EndSession(sess)
		if ended != "" {
			rt.RecordAccess("signed_out", ended, "", "")
		}
		send(w, 200, map[string]any{"ended": ended != ""})
	default:
		return nothing
	}
	return nil
}

var requestID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// events: 1 to 10 channel events. This shop takes the owner's talk box (an owner_message) and a press of "send me a link" (an owner_signin).
func (s *Server) events(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	body, ok := readJSON(w, r, 16*1024)
	if !ok {
		return nil
	}
	obj, _ := body.(map[string]any)
	list, isList := obj["events"].([]any)
	if !isList || len(list) == 0 || len(list) > 10 {
		send(w, 400, errBody(`Send {"events": [...]} with 1 to 10 channel events.`))
		return nil
	}
	var events []map[string]any
	for _, raw := range list {
		e, _ := raw.(map[string]any)
		id, _ := e["id"].(string)
		if !requestID.MatchString(id) {
			send(w, 400, errBody("An event needs an id: 1 to 64 letters, digits or dashes."))
			return nil
		}
		switch e["kind"] {
		case "owner_message":
			t, _ := e["text"].(string)
			t = strings.TrimFunc(t, isSpace)
			if t == "" || utf16Len(t) > 900 {
				send(w, 400, errBody("An owner_message carries the owner's words: 1 to 900 characters."))
				return nil
			}
			// the owner's link is checked HERE, at the runtime, against its own file: the front cannot act for the owner without it
			if !s.ownerAuthorised(r) {
				send(w, 403, errBody("The owner's link is not valid (it may have been revoked)."))
				return nil
			}
			events = append(events, map[string]any{"kind": "owner_message", "id": id, "text": t})
		case "owner_signin":
			events = append(events, map[string]any{"kind": "owner_signin", "id": id})
		case "owner_action":
			ev, msg := checkOwnerAction(e, id)
			if msg != "" {
				send(w, 400, errBody(msg))
				return nil
			}
			if !s.ownerAuthorised(r) {
				send(w, 403, errBody(ownerRefused))
				return nil
			}
			events = append(events, ev)
		default:
			send(w, 400, errBody(`A listings-only shop takes the owner's "owner_message", "owner_action" and "owner_signin" here.`))
			return nil
		}
	}
	saved, dup, err := s.rt.Submit(events)
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"saved": saved, "duplicates": dup})
	s.rt.Kick()
	return nil
}

var (
	ownerActions = []string{"received", "refunded", "kept", "approve", "deny", "retry", "card_yes", "card_no", "send_link", "revoke_link", "cash", "bank", "present", "absent", "answered", "got_it", "send_again", "try_now", "cancel_order"}
	caseID       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`)
	cardID       = regexp.MustCompile(`^c-\d{1,9}$`)
	digest32     = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// checkOwnerAction is events.ts `checkChannelEvent` for an owner_action: every action name is accepted and saved (the ones a listings-only shop has no use for are ignored in the step), a
// card's answer must name a card ("c-3") and carry the digest it was shown, and the shape is checked BEFORE the owner is (a bad shape is 400, then 403).
func checkOwnerAction(e map[string]any, id string) (map[string]any, string) {
	action, _ := e["action"].(string)
	if !contains(ownerActions, action) {
		return nil, "An owner_action's action is one of " + strings.Join(ownerActions, ", ") + "."
	}
	cs, _ := e["case"].(string)
	if !caseID.MatchString(cs) {
		return nil, `An owner_action names its case ("b-3").`
	}
	if (action == "card_yes" || action == "card_no") && !cardID.MatchString(cs) {
		return nil, `A card's answer names the card ("c-3").`
	}
	digest, _ := e["digest"].(string)
	if !digest32.MatchString(digest) {
		return nil, "An owner_action carries the digest of the action as it was shown (32 hex digits)."
	}
	ev := map[string]any{"kind": "owner_action", "id": id, "action": action, "case": cs, "digest": digest}
	if _, given := e["amountPaise"]; given && (action == "cash" || action == "bank") {
		n, ok := e["amountPaise"].(float64)
		if !ok || n != float64(int64(n)) || n < 100 || n > 10_000_000_00 || int64(n)%100 != 0 {
			return nil, "A part marked received is a whole number of rupees, at least 1."
		}
		ev["amountPaise"] = int64(n)
	}
	return ev, ""
}

func isSpace(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func (s *Server) ownerListing(w http.ResponseWriter, r *http.Request) error {
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	if r.Method == "GET" {
		send(w, 200, s.rt.OwnerView())
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	body, ok := readJSON(w, r, 8*1024)
	if !ok {
		return nil
	}
	id, op, why := listings.CheckOwnerListing(body)
	if why != "" {
		send(w, 400, errBody(why))
		return nil
	}
	// the same rules the step will apply, asked now, so the page can say why before anything is saved (the step checks again)
	if f := s.rt.Check(op); f != "" {
		send(w, 422, map[string]any{"why": string(f), "error": fmt.Sprintf("The shop's rules refuse that (%s).", f)})
		return nil
	}
	saved, dup, err := s.rt.Submit([]map[string]any{op.Event(id)})
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"saved": saved, "duplicates": dup})
	s.rt.Kick()
	return nil
}

var imageType = regexp.MustCompile(`(?i)^image/(jpeg|webp)\b`)

func (s *Server) ownerPhoto(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	// the type the phone says is not trusted (CheckPhoto reads the bytes); only photo kinds get as far as being read
	if !imageType.MatchString(r.Header.Get("content-type")) {
		send(w, 415, errBody("Send the photo as image/jpeg or image/webp."))
		return nil
	}
	if s.rt.UploadsLeft() <= 0 {
		send(w, 429, map[string]any{"why": "day", "error": "That is enough photos for today."})
		return nil
	}
	b, err := readBody(r, listings.MaxPhotoBytes)
	if err != nil {
		var he httpError
		if errors.As(err, &he) {
			send(w, he.status, errBody(he.msg), "connection", "close")
			return nil
		}
		return err
	}
	checked, refusal := listings.CheckPhoto(b)
	if checked == nil {
		send(w, 422, map[string]any{"why": string(refusal), "error": "That is not a photo the shop can keep."})
		return nil
	}
	id := listings.PhotoIDOf(checked.Bytes)
	if err := s.rt.PutPhoto(id, checked); err != nil {
		return err
	}
	photo := map[string]any{"id": id, "type": checked.Type, "width": checked.Width, "height": checked.Height, "bytes": len(checked.Bytes)}
	saved, dup, err := s.rt.Submit([]map[string]any{{"kind": "owner_photo", "id": id, "photo": photo}})
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"photo": photo, "saved": saved, "duplicates": dup})
	s.rt.Kick()
	return nil
}

// signed: the signed feed, check answer and card. The runtime builds and signs; the front only passes the page's address and the ids. The key is this process's alone.
func (s *Server) signed(w http.ResponseWriter, r *http.Request, path string) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	max := int64(4 * 1024)
	if strings.HasSuffix(path, "shop-card") {
		max = 40 * 1024
	}
	body, ok := readJSON(w, r, max)
	if !ok {
		return nil
	}
	q, _ := body.(map[string]any)
	page, _ := q["page"].(string)
	url, base, hasPages := s.rt.PagesURL()
	if !hasPages || page == "" || (page != url && page != base) {
		send(w, 400, errBody("page is an address of this shop."))
		return nil
	}
	proto := s.rt.Proto()
	switch {
	case strings.HasSuffix(path, "shop-feed"):
		var languages []string
		if list, ok := q["languages"].([]any); ok {
			for _, l := range list {
				if t, ok := l.(string); ok {
					languages = append(languages, t)
				}
			}
		}
		name, _ := q["name"].(string)
		chat, hasChat := q["chat"]
		if name == "" || utf16Len(name) > 120 || (hasChat && !listings.UnderPage(page, chat)) {
			send(w, 400, errBody("name is the shop's name; chat, when given, is under the shop's page."))
			return nil
		}
		chatText, _ := chat.(string)
		feed, err := proto.Feed(page, name, languages, chatText)
		if err != nil {
			return err
		}
		if feed == nil {
			send(w, 404, errBody("The shop does not show itself."))
			return nil
		}
		send(w, 200, feed)
	case strings.HasSuffix(path, "shop-check"):
		ids, why := listings.CheckIDs(map[string]any{"ids": q["ids"]})
		if why != "" {
			send(w, 400, errBody(why))
			return nil
		}
		answer, err := proto.Check(page, ids)
		if err != nil {
			return err
		}
		if answer == nil {
			send(w, 404, errBody("This shop cannot sign."))
			return nil
		}
		send(w, 200, answer)
	default:
		card, bad := proto.Card(page, q["card"])
		switch {
		case bad:
			send(w, 400, errBody("That is not a card for this shop."))
		case card == nil:
			send(w, 404, errBody("The shop does not show itself."))
		default:
			send(w, 200, card)
		}
	}
	return nil
}

func (s *Server) ownerSignin(w http.ResponseWriter, r *http.Request) error {
	link, _ := header(r, access.OwnerSigninHeader)
	rt := s.rt
	if r.Method == "GET" {
		send(w, 200, map[string]any{"state": rt.LinkState(link)})
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	if rt.o.Access == nil {
		send(w, 403, map[string]any{"state": "unknown"})
		return nil
	}
	sess, state := rt.ConsumeLink(link)
	if sess.Token == "" {
		send(w, 403, map[string]any{"state": state})
		return nil
	}
	rt.RecordAccess("signed_in", sess.ID, "link", "")
	send(w, 200, map[string]any{"session": sess.Token, "expires_at_ms": sess.ExpiresAt})
	return nil
}

// ownerPasskey: the passkey route (item 11h): one route, the step in the body; every check is in owner.go OwnerPasskey.
func (s *Server) ownerPasskey(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	raw, ok := readJSON(w, r, 32*1024)
	if !ok {
		return nil
	}
	body, _ := raw.(map[string]any)
	status, out, err := s.rt.OwnerPasskey(body)
	if err != nil {
		return err
	}
	send(w, status, out)
	return nil
}

// ownerPhones: "Phones that can open your shop" (owner control): ONLY a session made here, never the panel's link; every rule is in owner.go OwnerPhones.
func (s *Server) ownerPhones(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	raw, ok := readJSON(w, r, 4*1024)
	if !ok {
		return nil
	}
	body, _ := raw.(map[string]any)
	sess, sent := header(r, access.OwnerSessionHeader)
	status, out, err := s.rt.OwnerPhones(sess, sent, body)
	if err != nil {
		return err
	}
	send(w, status, out)
	return nil
}

func cut(s string, n int) string {
	if u := utf16.Encode([]rune(s)); len(u) > n {
		return string(utf16.Decode(u[:n]))
	}
	return s
}
