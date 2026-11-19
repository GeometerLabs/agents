// The directory's HTTP face (modules/discovery/http.ts): one handler over the search, the pages, the notices, the MCP endpoint and the Agent Card. It holds no state of its own beyond the
// in-memory per-address limits. The program in cmd/directory wires it to a port, a database file and the network; the door forwards these addresses to it.
//
//	GET  /search            the people's page (HTML), or the JSON `directory-search/1` when the caller asks for JSON (`Accept: application/json` or `format=json`)
//	POST /search/ask        "Ask in your own words" (only where the buyer's assistant is on): a form-encoded body `ask`, optional `lat`, `lon`, `lang`; a POST, so the words are never in an address
//	GET  /search/font.woff2 Baloo 2's Latin subset (SIL OFL): the page's headings and buttons
//	GET  /order             the page that states the fair order in plain words
//	POST /feed-changed      "my feed changed" (shop-feed-changed/1): a hint only
//	POST /mcp               the MCP endpoint: search_listings, get_listing, shop_page, and ask where the assistant is on
//	GET  /.well-known/agent-card.json   the directory's signed A2A Agent Card
//	GET  /healthz           "ok"
//
// Privacy (specs/directory.md): no cookie is ever set, no account exists, a search is kept as a count only, per-address limits live in memory, the pages send `Referrer-Policy:
// no-referrer`. The address is the LAST entry of X-Forwarded-For (the door appends the real one; anything before it is the visitor's own claim), or the socket's.
//
// The request path is read as JavaScript's `new URL(req.url, origin).pathname` reads it (dot segments removed, a backslash a slash, percent escapes NOT decoded), because that is what
// decides which route an address is, and Go's own mux would clean and decode it differently.
package directory

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/GeometerLabs/agents/go/internal/language"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxMCPBytes = 16 * 1024
	maxAskBytes = 2 * 1024
)

// Limits is what one address may do in a window. A phone shares one address with a street, so these are generous; a program that crawls is stopped.
var Limits = map[string]Limit{"search": {40, 60_000}, "mcp": {90, 60_000}, "notice": {20, 60_000}, "pages": {120, 60_000}}

// HTTPDeps is what the handler needs.
type HTTPDeps struct {
	Search    SearchDeps
	Origin    string                // the directory's own address, https://<pages domain>
	Card      func() map[string]any // the signed Agent Card
	Served    []string              // the pages domains it serves
	Config    []string              // the configured feed addresses
	Assistant *Assistant            // nil: no "Ask in your own words" box, no `ask` tool
	Now       func() int64
	Log       func(string)
}

// LanguageOf is the language of a page: `?lang=`, else the first of the browser's languages we speak, else English.
func LanguageOf(param string, has bool, acceptLanguage string) string {
	if has && isLang(param) {
		return param
	}
	for _, part := range strings.Split(acceptLanguage, ",") {
		tag := language.LowerJS(language.TrimJS(strings.SplitN(part, ";", 2)[0]))
		tag = language.UTF16SliceFFFD(tag, 2)
		if isLang(tag) {
			return tag
		}
	}
	return "en"
}

var (
	reJSON = regexp.MustCompile(`application/json`)
	reHTML = regexp.MustCompile(`text/html`)
)

// requestPath is `new URL(req.url, origin)`'s pathname and search of a request target.
func requestPath(target string) (path, query string) {
	if !strings.HasPrefix(target, "/") { // an absolute-form target: keep what follows the authority
		if i := strings.Index(target, "://"); i >= 0 {
			if j := strings.IndexByte(target[i+3:], '/'); j >= 0 {
				target = target[i+3+j:]
			} else {
				target = "/"
			}
		}
	}
	if i := strings.IndexByte(target, '#'); i >= 0 {
		target = target[:i]
	}
	path = target
	if i := strings.IndexByte(target, '?'); i >= 0 {
		path, query = target[:i], target[i+1:]
	}
	path = strings.ReplaceAll(path, `\`, "/")
	var out []string
	segs := strings.Split(path, "/")
	for i, s := range segs {
		if i == 0 {
			continue
		}
		switch strings.ToLower(s) {
		case ".", "%2e":
			if i == len(segs)-1 {
				out = append(out, "")
			}
		case "..", ".%2e", "%2e.", "%2e%2e":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			if i == len(segs)-1 {
				out = append(out, "")
			}
		default:
			out = append(out, s)
		}
	}
	return "/" + strings.Join(out, "/"), query
}

func visitorOf(r *http.Request) string {
	var last string
	for _, p := range strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ", "), ",") {
		if t := language.TrimJS(p); t != "" {
			last = t
		}
	}
	if last != "" {
		return last
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return "unknown"
}

// readBody reads at most max bytes; ok is false for a body that is over it or cannot be read.
func readBody(r *http.Request, max int) (string, bool) {
	if r.ContentLength > int64(max) {
		return "", false
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, int64(max)+1))
	if err != nil || len(b) > max {
		return "", false
	}
	return string(b), true
}

var trailingSlashes = regexp.MustCompile(`/+$`)

// NewHandler is the directory's request handler.
func NewHandler(deps HTTPDeps) http.Handler {
	now := deps.Now
	if now == nil {
		now = func() int64 { return time.Now().UnixMilli() }
	}
	limiter := NewLimiter(Limits, now)
	logf := deps.Log
	if logf == nil {
		logf = func(string) {}
	}
	send := func(w http.ResponseWriter, status int, body, typ string, extra map[string]string) {
		h := w.Header()
		// Header.Set writes the canonical name (Go adds its own Content-Length in that form, and a second one under another spelling is a refused response)
		h.Set("content-type", typ)
		h.Set("content-length", strconv.Itoa(len(body)))
		h.Set("x-content-type-options", "nosniff")
		h.Set("referrer-policy", "no-referrer")
		for k, v := range extra {
			h.Set(k, v)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
	sendJSON := func(w http.ResponseWriter, status int, v any, extra map[string]string) {
		b, _ := marshalNoEscape(v)
		e := map[string]string{"cache-control": "no-store"}
		for k, x := range extra {
			e[k] = x
		}
		send(w, status, string(b), "application/json; charset=utf-8", e)
	}
	sendHTML := func(w http.ResponseWriter, status int, nonce, body string, extra map[string]string) {
		e := map[string]string{"content-security-policy": PagePolicy(deps.Origin, nonce), "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=()"}
		for k, x := range extra {
			e[k] = x
		}
		send(w, status, body, "text/html; charset=utf-8", e)
	}
	noIndex := map[string]string{"cache-control": "no-store", "x-robots-tag": "noindex"}
	retry := func(extra map[string]string) map[string]string {
		m := map[string]string{"retry-after": "60"}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}

	route := func(w http.ResponseWriter, r *http.Request) {
		path, rawQuery := requestPath(r.RequestURI)
		method := r.Method
		who := visitorOf(r)
		if len(path) > 1 {
			path = trailingSlashes.ReplaceAllString(path, "")
			if path == "" {
				path = "/"
			}
		}
		if path == "/healthz" && method == "GET" {
			send(w, 200, "ok", "text/plain; charset=utf-8", nil)
			return
		}
		nb := make([]byte, 16)
		_, _ = rand.Read(nb)
		nonce := base64.RawURLEncoding.EncodeToString(nb)
		ctx := func(lang string) PageContext {
			return PageContext{Origin: deps.Origin, Lang: lang, Now: now(), Nonce: nonce, FontURL: "/search/font.woff2", Assistant: deps.Assistant != nil}
		}
		q := parseForm(rawQuery)
		lp, hasLang := q.get("lang")
		acceptLang := r.Header.Get("Accept-Language")
		lang := LanguageOf(lp, hasLang, acceptLang)
		accept := r.Header.Get("Accept")

		switch {
		case path == "/search/font.woff2" && (method == "GET" || method == "HEAD"):
			b := FontBytes()
			h := w.Header()
			h.Set("content-type", "font/woff2")
			h.Set("content-length", strconv.Itoa(len(b)))
			h.Set("cache-control", "public, max-age=31536000, immutable")
			h.Set("x-content-type-options", "nosniff")
			h.Set("referrer-policy", "no-referrer")
			w.WriteHeader(200)
			if method != "HEAD" {
				_, _ = w.Write(b)
			}
		case path == "/order" && (method == "GET" || method == "HEAD"):
			if !limiter.Take("pages", who) {
				sendHTML(w, 429, nonce, SearchPage(ctx(lang), FormValues{}, SearchView{State: "busy"}, nil), retry(map[string]string{"cache-control": "no-store"}))
				return
			}
			sendHTML(w, 200, nonce, OrderPage(ctx(lang)), map[string]string{"cache-control": "public, max-age=300"})
		case path == "/.well-known/agent-card.json" && (method == "GET" || method == "HEAD"):
			if !limiter.Take("pages", who) {
				sendJSON(w, 429, orderedMap("error", "Too many requests; try again in a minute."), retry(nil))
				return
			}
			sendJSON(w, 200, deps.Card(), map[string]string{"cache-control": "public, max-age=300", "access-control-allow-origin": "*"})
		case path == "/search" && (method == "GET" || method == "HEAD"):
			get := func(name string) (string, bool) { return q.get(name) }
			asked := SearchRequest{"lang": lang}
			for _, n := range []string{"q", "category", "lat", "lon", "town", "radius_km", "offset"} {
				if v, ok := get(n); ok {
					asked[n] = v
				}
			}
			wantsJSON := func() bool {
				f, _ := q.get("format")
				return f == "json" || (reJSON.MatchString(accept) && !reHTML.MatchString(accept))
			}()
			val := func(n string, max int) string { v, _ := get(n); return language.UTF16SliceFFFD(v, max) }
			rk, _ := get("radius_km")
			cat, _ := get("category")
			f := FormValues{Q: val("q", 200), Category: cat, Town: val("town", 80), Lat: val("lat", 12), Lon: val("lon", 12), RadiusKm: rk}
			if !limiter.Take("search", who) {
				if wantsJSON {
					sendJSON(w, 429, orderedMap("error", "Too many searches from this address; try again in a minute."), retry(nil))
				} else {
					sendHTML(w, 429, nonce, SearchPage(ctx(lang), f, SearchView{State: "busy"}, nil), retry(noIndex))
				}
				return
			}
			if !wantsJSON && f.Q == "" && f.Category == "" && f.Town == "" && f.Lat == "" && f.Lon == "" {
				sendHTML(w, 200, nonce, SearchPage(ctx(lang), f, SearchView{State: "start"}, nil), noIndex)
				return
			}
			answer, failed := safeSearch(deps.Search, asked)
			if failed {
				logf("directory: a search failed") // the kind only, never the search
				if wantsJSON {
					sendJSON(w, 503, orderedMap("error", "The search is not working right now."), map[string]string{"retry-after": "120"})
				} else {
					sendHTML(w, 503, nonce, SearchPage(ctx(lang), f, SearchView{State: "down"}, nil), map[string]string{"retry-after": "120", "cache-control": "no-store", "x-robots-tag": "noindex"})
				}
				return
			}
			if wantsJSON {
				if answer.OK {
					sendJSON(w, 200, answer.Answer, map[string]string{"access-control-allow-origin": "*", "x-robots-tag": "noindex"})
				} else {
					sendJSON(w, 400, orderedMap("error", answer.Error), map[string]string{"access-control-allow-origin": "*", "x-robots-tag": "noindex"})
				}
				return
			}
			status := 200
			view := SearchView{State: "results", Answer: &answer.Answer}
			switch {
			case !answer.OK:
				status, view = 400, SearchView{State: "bad", Message: answer.Error}
			case len(answer.Answer.Results) == 0:
				view = SearchView{State: "none"}
			}
			sendHTML(w, status, nonce, SearchPage(ctx(lang), f, view, nil), noIndex)
		case path == "/search/ask":
			if method != "POST" || deps.Assistant == nil {
				if method != "POST" && deps.Assistant != nil {
					sendJSON(w, 405, orderedMap("error", "Use POST."), map[string]string{"allow": "POST"})
				} else {
					send(w, 404, "Not here", "text/plain; charset=utf-8", map[string]string{"cache-control": "no-store"})
				}
				return
			}
			// a form from another site is refused: the Origin of a browser's form post is this directory's own, or (older browsers) Sec-Fetch-Site says so
			origin, site := r.Header.Get("Origin"), r.Header.Get("Sec-Fetch-Site")
			if origin != "" && origin != deps.Origin || origin == "" && site != "" && site != "same-origin" && site != "none" {
				sendHTML(w, 403, nonce, "<!doctype html><p>Forms from another site are refused.</p>", map[string]string{"cache-control": "no-store"})
				return
			}
			wantsJSON := reJSON.MatchString(accept) && !reHTML.MatchString(accept)
			text, okBody := readBody(r, maxAskBytes)
			body := parseForm(text)
			lp, hasL := body.get("lang")
			askLang := LanguageOf(lp, hasL, acceptLang)
			askRaw, _ := body.get("ask")
			ask := language.UTF16SliceFFFD(language.TrimJS(askRaw), MaxQuestion)
			la, _ := body.get("lat")
			lo, _ := body.get("lon")
			lat, lon := language.UTF16SliceFFFD(la, 12), language.UTF16SliceFFFD(lo, 12)
			f := FormValues{Lat: lat, Lon: lon, Ask: ask}
			if !limiter.Take("search", who) {
				if wantsJSON {
					sendJSON(w, 429, orderedMap("error", "Too many searches from this address; try again in a minute."), retry(nil))
				} else {
					sendHTML(w, 429, nonce, SearchPage(ctx(askLang), f, SearchView{State: "busy"}, nil), retry(noIndex))
				}
				return
			}
			if !okBody || ask == "" {
				if wantsJSON {
					sendJSON(w, 400, orderedMap("error", "ask must be the buyer's words, in a form-encoded body of at most 2 KB."), nil)
				} else {
					sendHTML(w, 200, nonce, SearchPage(ctx(askLang), f, SearchView{State: "start"}, nil), noIndex)
				}
				return
			}
			in := AskInput{Question: ask, Lang: askLang, Who: who}
			if lat != "" && lon != "" {
				in.Lat, in.Lon = lat, lon
			}
			assisted := AskListings(r.Context(), deps.Search, deps.Assistant, in)
			ans := assisted.Searched
			if wantsJSON {
				if ans.OK {
					sendJSON(w, 200, askAnswer(assisted), map[string]string{"access-control-allow-origin": "*", "x-robots-tag": "noindex"})
				} else {
					sendJSON(w, 400, orderedMap("error", ans.Error), map[string]string{"access-control-allow-origin": "*", "x-robots-tag": "noindex"})
				}
				return
			}
			f = assisted.Form
			f.Ask = ask
			status := 200
			view := SearchView{State: "results", Answer: &ans.Answer}
			switch {
			case !ans.OK:
				status, view = 400, SearchView{State: "bad", Message: ans.Error}
			case len(ans.Answer.Results) == 0:
				view = SearchView{State: "none"}
			}
			sendHTML(w, status, nonce, SearchPage(ctx(askLang), f, view, &AssistBits{Line: assisted.Line, Notice: assisted.Notice}), noIndex)
		case path == "/feed-changed":
			if method != "POST" {
				sendJSON(w, 405, orderedMap("error", "Use POST."), map[string]string{"allow": "POST"})
				return
			}
			if !limiter.Take("notice", who) {
				sendJSON(w, 429, orderedMap("ok", false, "message", "Too many notices from this address."), retry(nil))
				return
			}
			text, okBody := readBody(r, MaxNoticeBytes)
			var probe any
			if !okBody || json.Unmarshal([]byte(text), &probe) != nil {
				sendJSON(w, 400, orderedMap("ok", false, "message", "The body must be JSON of at most 2 KB."), nil)
				return
			}
			a := HandleNotice(NoticeConfig{Index: deps.Search.Index, Served: deps.Served, Configured: deps.Config, Now: now}, []byte(text))
			sendJSON(w, a.Status, orderedMap("ok", a.OK, "message", a.Message), nil)
		case path == "/mcp":
			if method != "POST" {
				sendJSON(w, 405, orderedMap("error", "This MCP endpoint answers POST with JSON; it offers no event stream."), map[string]string{"allow": "POST"})
				return
			}
			text, okBody := readBody(r, maxMCPBytes)
			var probe any
			if !okBody || json.Unmarshal([]byte(text), &probe) != nil {
				sendJSON(w, 400, orderedMap("jsonrpc", "2.0", "id", nil, "error", orderedMap("code", -32700, "message", "The body must be JSON of at most 16 KB.")), nil)
				return
			}
			// each tool call counts as a search against the address, as a shop's endpoint counts a call; the protocol's own messages are cheap and free
			var messages []json.RawMessage
			if arr, ok := probe.([]any); ok {
				_ = json.Unmarshal([]byte(text), &messages)
				_ = arr
			} else {
				messages = []json.RawMessage{json.RawMessage(text)}
			}
			for _, m := range messages {
				var mm struct{ Method any }
				_ = json.Unmarshal(m, &mm)
				kind := "mcp"
				if mm.Method == "tools/call" {
					kind = "search"
				}
				if !limiter.Take(kind, who) {
					sendJSON(w, 429, orderedMap("jsonrpc", "2.0", "id", nil, "error", orderedMap("code", -32000, "message", "Too many requests from this address; try again in a minute.")), retry(nil))
					return
				}
			}
			status, out := ServerPost(DirectoryServer(deps.Search, deps.Assistant, who), json.RawMessage(text))
			if status == 202 {
				h := w.Header()
				h.Set("cache-control", "no-store")
				h.Set("x-content-type-options", "nosniff")
				h.Set("referrer-policy", "no-referrer")
				w.WriteHeader(202)
				return
			}
			sendJSON(w, status, out, map[string]string{"access-control-allow-origin": "*"})
		default:
			send(w, 404, "Not here", "text/plain; charset=utf-8", map[string]string{"cache-control": "no-store"})
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if e := recover(); e != nil {
				logf("directory: a request could not be answered")
				send(w, 500, "Something went wrong", "text/plain; charset=utf-8", nil)
			}
		}()
		route(w, r)
	})
}

// safeSearch is a search that reports a panic as a failure (the TypeScript's 503), never a crash.
func safeSearch(deps SearchDeps, req SearchRequest) (s Searched, failed bool) {
	defer func() {
		if recover() != nil {
			failed = true
		}
	}()
	return SearchListings(deps, req), false
}
