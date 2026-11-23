package runtime

// The HTTP routes a template's runtime has beyond the listings shop's (modules/runtime/http.ts): the inbox's events, the panel's recovery, the approvals relay's refund context,
// and the channel's events and reads (offer, request, owner, documents, accounting). The shared routes (health, status, the owner's sign-in, passkeys, phones, limits, file,
// push, voice) stay in server.go and answer the same for every shop. The order of the checks (method, credential, body) is http.ts's, route by route, because a caller sees it.
//
// The routes of a listings shop (listings, listing-photo, shop-feed, shop-check, shop-card, owner-listing, owner-stock, owner-photo) are 404 for a template with none, and so are
// a Fees centre's (parent, material) for a template whose channel does not read them (kitparent.go: the optional ParentReader and MaterialReader): the contract holds a port to that so
// it does not grow them.

import (
	"net/http"
	"regexp"
	"strconv"
)

// maxBodyBytes is http.ts MAX_BODY_BYTES: the inbox's events.
const maxBodyBytes = 256 * 1024

var (
	periodRe   = regexp.MustCompile(`^(\d{4}-(0[1-9]|1[0-2])|\d{2}-\d{2})$`)
	afterRe    = regexp.MustCompile(`^\d{1,9}$`)
	fromDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// kitRoute answers the non-channel routes a template adds; handled=false leaves the path to server.go.
func (s *Server) kitRoute(w http.ResponseWriter, r *http.Request, path string) (bool, error) {
	rt := s.rt
	switch path {
	case "/internal/events":
		if err := only(r, "POST"); err != nil {
			return true, err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return true, nil
		}
		body, ok := readJSON(w, r, maxBodyBytes)
		if !ok {
			return true, nil
		}
		events, why := CheckEvents(body)
		if why != "" {
			send(w, 400, errBody(why))
			return true, nil
		}
		return true, s.submitKit(w, events)
	case "/internal/recover":
		if err := only(r, "POST"); err != nil {
			return true, err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return true, nil
		}
		body, ok := readJSON(w, r, 4096)
		if !ok {
			return true, nil
		}
		ev, why := CheckRecovery(body)
		if why != "" {
			send(w, 400, errBody(why))
			return true, nil
		}
		return true, s.submitKit(w, []map[string]any{ev})
	case "/internal/refund-context":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		if !authorised(r, &s.token) {
			unauthorised(w)
			return true, nil
		}
		receipt := r.URL.Query().Get("receipt")
		if receipt == "" || utf16Len(receipt) > 200 {
			send(w, 400, errBody("Give the refund's receipt: ?receipt=b-3:pay_..."))
			return true, nil
		}
		st, _, _ := rt.KitState()
		if c := rt.o.Kit.RefundContext(st, &rt.o.Client.Settings, receipt); c != nil {
			send(w, 200, c)
		} else {
			send(w, 404, errBody("No refund is held under that receipt."))
		}
		return true, nil
	case "/internal/feed-notice":
		// a template with no listings has no signed feed: http.ts answers 204 after the token
		if !authorised(r, &s.token) {
			unauthorised(w)
			return true, nil
		}
		w.Header().Set("cache-control", "no-store")
		w.WriteHeader(204)
		return true, nil
	}
	return false, nil
}

func (s *Server) submitKit(w http.ResponseWriter, events []map[string]any) error {
	saved, dup, err := s.rt.SubmitKit(events) // on disk when this returns
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"saved": saved, "duplicates": dup})
	s.rt.Kick() // only now let the queue run
	return nil
}

// kitChannelRoute answers the channel routes a template adds (the channel token is already checked); handled=false leaves the path to server.go's shared channel routes.
func (s *Server) kitChannelRoute(w http.ResponseWriter, r *http.Request, path string) (bool, error) {
	rt := s.rt
	ch := rt.o.Kit.Channel()
	switch path {
	case "/internal/channel/listings", "/internal/channel/listing-photo", "/internal/channel/shop-feed", "/internal/channel/shop-check", "/internal/channel/shop-card",
		"/internal/channel/owner-listing", "/internal/channel/owner-photo":
		return true, nothing
	case "/internal/channel/owner-stock":
		// the owner's Stock page for a template whose shop counts stock (kitstock.go StockKit); 404 for the others, as before
		if !rt.stockOn() {
			return true, nothing
		}
		return true, s.ownerStockRoute(w, r)
	case "/internal/channel/material":
		mr, has := ch.(MaterialReader) // kitparent.go: a Fees centre with Classes; any other shop has none (404)
		if ch == nil || !has {
			return true, nothing
		}
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		q := r.URL.Query()
		link, batch := q.Get("link"), q.Get("batch")
		file, hasFile := q["file"]
		if !HandleHash.MatchString(link) {
			send(w, 400, errBody("link is the link's hash: 64 hex digits."))
			return true, nil
		}
		if !materialBatchRe.MatchString(batch) || (hasFile && !materialFileRe.MatchString(file[0])) {
			send(w, 400, errBody("batch is a batch id and file a file id (12 hex digits)."))
			return true, nil
		}
		fileID := ""
		if hasFile {
			fileID = file[0]
		}
		st, _, _ := rt.KitState()
		if v := mr.Material(st, link, batch, fileID); v != nil {
			send(w, 200, v)
		} else {
			send(w, 404, errBody("Nothing is open here."))
		}
		return true, nil
	case "/internal/channel/parent":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		if !HandleHash.MatchString(r.URL.Query().Get("link")) {
			send(w, 400, errBody("link is the link's hash: 64 hex digits."))
			return true, nil
		}
		if pr, has := ch.(ParentReader); has { // kitparent.go: a Fees centre
			st, _, _ := rt.KitState()
			if v := pr.Parent(st, r.URL.Query().Get("link")); v != nil {
				send(w, 200, v)
				return true, nil
			}
		}
		send(w, 404, errBody("No parent has this link."))
		return true, nil
	case "/internal/channel/events":
		return true, s.kitChannelEvents(w, r)
	case "/internal/channel/chat":
		if ch == nil {
			return true, nothing
		}
		return true, s.chatRead(w, r)
	case "/internal/channel/chat-voice":
		if ch == nil {
			return true, nothing
		}
		return true, s.chatVoice(w, r)
	case "/internal/channel/owner-voice":
		if _, ok := rt.o.Kit.(OwnerVoiceKit); !ok {
			return false, nil // the shared route: voice is off for this shop's assistant
		}
		return true, s.ownerVoice(w, r)
	case "/internal/channel/chat-id":
		if ch == nil {
			return true, nothing
		}
		return true, s.chatID(w, r)
	case "/internal/channel/offer":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		q := r.URL.Query()
		var query OfferQuery
		if d, given := q["days"]; given {
			n, err := strconv.ParseFloat(d[0], 64)
			if err != nil || n != float64(int(n)) || n < 1 || n > 31 {
				send(w, 400, errBody("days is 1 to 31."))
				return true, nil
			}
			query.Days = int(n)
		}
		if f, given := q["from"]; given {
			if !fromDateRe.MatchString(f[0]) {
				send(w, 400, errBody("from is a date: YYYY-MM-DD."))
				return true, nil
			}
			query.FromDate = f[0]
		}
		if sv, given := q["service"]; given && sv[0] != "" {
			if !serviceIDRe.MatchString(sv[0]) {
				send(w, 400, errBody("service is a service id."))
				return true, nil
			}
			query.ServiceID = sv[0]
		}
		if ch == nil {
			return true, nothing
		}
		st, err := rt.FreshKitState()
		if err != nil {
			return true, err
		}
		offer, err := ch.Offer(st, query)
		if err != nil {
			return true, err
		}
		send(w, 200, offer)
		return true, nil
	case "/internal/channel/request":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		handle := r.URL.Query().Get("handle")
		if !HandleHash.MatchString(handle) {
			send(w, 400, errBody("handle is the handle's hash: 64 hex digits."))
			return true, nil
		}
		if ch == nil {
			return true, nothing
		}
		st, _, _ := rt.KitState()
		if v := ch.View(st, handle); v != nil {
			send(w, 200, v)
			return true, nil
		}
		// core.ts view: the request's task is still waiting, or it ended without its work done
		switch rt.TaskState(ChannelStartKey(handle)) {
		case "pending":
			send(w, 200, map[string]any{"status": "pending"})
		case "failed":
			send(w, 200, map[string]any{"status": "not_done"})
		default:
			send(w, 404, errBody("No booking has this handle."))
		}
		return true, nil
	case "/internal/channel/owner":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		if !s.ownerAuthorised(r) {
			send(w, 403, errBody(ownerRefused))
			return true, nil
		}
		if ch == nil {
			return true, nothing
		}
		st, snap, entries := rt.KitState()
		send(w, 200, ch.Owner(st, snap, entries))
		return true, nil
	case "/internal/channel/documents":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		q := r.URL.Query()
		_, hasHandle := q["handle"]
		_, hasLink := q["link"]
		handle, link := q.Get("handle"), q.Get("link")
		lang := q.Get("lang")
		if _, given := q["lang"]; !given {
			lang = "en"
		}
		if ch == nil {
			return true, nothing
		}
		st, _, entries := rt.KitState()
		if hasHandle == hasLink {
			send(w, 400, errBody("Send handle or link, one of them."))
			return true, nil
		}
		key := handle
		if !hasHandle {
			key = link
		}
		if !HandleHash.MatchString(key) {
			send(w, 400, errBody("handle and link are hashes: 64 hex digits."))
			return true, nil
		}
		if !contains(LANGUAGES, lang) {
			send(w, 400, errBody("lang is en, hi, ml or kn."))
			return true, nil
		}
		docs, ok := ch.Documents(st, entries, key, lang)
		if !ok {
			return true, nothing
		}
		if docs == nil {
			docs = []any{}
		}
		send(w, 200, map[string]any{"documents": docs})
		return true, nil
	case "/internal/channel/accounting":
		if err := only(r, "GET"); err != nil {
			return true, err
		}
		sess, sent := header(r, "x-owner-session")
		if !sent || !rt.SessionOK(sess) {
			send(w, 403, errBody("The owner's session is not valid."))
			return true, nil
		}
		af, has := ch.(AccountantFiler)
		if ch == nil || !has {
			return true, nothing
		}
		period := r.URL.Query().Get("period")
		if !periodRe.MatchString(period) {
			send(w, 400, errBody("period is a month (2026-11) or a financial year (26-27)."))
			return true, nil
		}
		st, _, entries := rt.KitState()
		files, err := af.AccountantFiles(st, entries, period)
		if err != nil {
			send(w, 400, errBody(err.Error()))
			return true, nil
		}
		send(w, 200, map[string]any{"files": files})
		return true, nil
	}
	return false, nil
}

// kitChannelEvents is http.ts /internal/channel/events: 1 to 10 events, checked whole; an owner's kind needs the owner, checked here against the runtime's own files.
func (s *Server) kitChannelEvents(w http.ResponseWriter, r *http.Request) error {
	ch := s.rt.o.Kit.Channel()
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
		ev, why := CheckChannelEvent(raw)
		if why != "" {
			send(w, 400, errBody(why))
			return nil
		}
		if k := ev["kind"]; (k == "owner_action" || k == "owner_message") && !s.ownerAuthorised(r) {
			send(w, 403, errBody(ownerRefused))
			return nil
		}
		if ev["kind"] == "chat_message" && ch != nil && !s.chatDoor(w, ev) {
			return nil // a guest's send is counted before anything is saved, so a flood saves no task and costs no step (http.ts)
		}
		events = append(events, ev)
	}
	return s.submitKit(w, events)
}
