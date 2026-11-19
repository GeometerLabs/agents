// The search page for people, and the page that states the order in plain words (modules/discovery/page.ts; specs/directory.md). Server-rendered HTML, no script needed: the search is a
// plain form (GET /search), the results are a list of photo cards, and every state has a page of its own (start, results, nothing found, a request that did not work, "wait a minute",
// "not working right now"). The one script (by the response's nonce) only adds a "Use my location" button. The style sheet and the script are the TypeScript page's own, cut out of a
// rendered page by scripts/gen_directory.ts, so Streetlist's look is never retyped. A photo is shown only when it is served from this directory's own address, so opening the page
// never tells another server who looked.
//
// The markup below is the TypeScript template literals copied piece for piece (the whitespace between elements included); the differential test renders both and compares them.
package directory

import (
	"fmt"
	"github.com/GeometerLabs/agents/go/internal/language"
	"math"
	"strconv"
	"strings"
)

// FormValues is what the form shows (the buyer's own request, as typed).
type FormValues struct{ Q, Category, Town, Lat, Lon, RadiusKm, Ask string }

// SearchView is one state of the search page.
type SearchView struct {
	State   string // start, results, none, bad, busy, down
	Answer  *SearchAnswer
	Message string
}

// PageContext is what a page is drawn for.
type PageContext struct {
	Origin    string
	Lang      string
	Now       int64
	Nonce     string
	FontURL   string
	Assistant bool
}

// AssistBits is what the assistant adds over the results.
type AssistBits struct{ Line, Notice string }

// PagePolicy is the page's content policy: nothing loads but this origin's own photos and the one font; the one script by its nonce; the form posts to /search and nowhere else.
func PagePolicy(origin, nonce string) string {
	return "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'nonce-" + nonce + "'; form-action " + origin + "/search " + origin + "/search/ask; frame-ancestors 'none'; base-uri 'none'; connect-src 'none'"
}

var escaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

func esc(s string) string { return escaper.Replace(s) }

// rupees is `₹` and Number(value).toLocaleString("en-IN", ...): Indian grouping (12,34,567), no decimals for a whole number, else two.
func rupees(value string) string {
	n, _ := strconv.ParseFloat(value, 64)
	whole := math.Trunc(n)
	digits := strconv.FormatFloat(whole, 'f', 0, 64)
	var grouped string
	if len(digits) > 3 {
		head, tail := digits[:len(digits)-3], digits[len(digits)-3:]
		var parts []string
		for len(head) > 2 {
			parts = append([]string{head[len(head)-2:]}, parts...)
			head = head[:len(head)-2]
		}
		if head != "" {
			parts = append([]string{head}, parts...)
		}
		grouped = strings.Join(parts, ",") + "," + tail
	} else {
		grouped = digits
	}
	if n == whole {
		return "₹" + grouped
	}
	frac := strconv.FormatFloat(n-whole, 'f', 2, 64) // "0.50": its two places
	return "₹" + grouped + frac[1:]
}

// Freshness is "Confirmed today", "Confirmed yesterday", "Confirmed 3 days ago", from the date the shop last confirmed, counted in India's days.
func Freshness(w *Words, confirmed string, now int64) string {
	at, _ := language.ParseJSDate(confirmed)
	today, _ := language.ParseJSDate(DayOf(now) + "T00:00:00Z")
	then, _ := language.ParseJSDate(DayOf(at) + "T00:00:00Z")
	days := int(math.Round(float64(today-then) / 86_400_000))
	switch {
	case days <= 0:
		return w.S("confirmedToday")
	case days == 1:
		return w.S("confirmedYesterday")
	}
	return w.Fn("confirmedDays", days, "", nil)
}

// KmText is `km`: one decimal under 10, else whole.
func KmText(n float64) string {
	if n < 10 {
		return toFixed1(n)
	}
	return strconv.FormatFloat(roundHalfUp(n), 'f', 0, 64)
}

// toFixed1 is Number.prototype.toFixed(1): on an exact tie (x.25, x.75 in binary) JavaScript takes the larger, Go's formatter the even one.
func toFixed1(n float64) string {
	if q := n * 4; q == math.Trunc(q) && math.Mod(q, 2) != 0 && n >= 0 {
		return strconv.FormatFloat((math.Floor(n*10)+1)/10, 'f', 1, 64)
	}
	return strconv.FormatFloat(n, 'f', 1, 64)
}

type kv struct{ k, v string }

// link is an address on this directory with these parameters (empty ones left out), in the order given.
func link(path string, params []kv) string {
	var pairs [][2]string
	for _, p := range params {
		if p.v != "" {
			pairs = append(pairs, [2]string{p.k, p.v})
		}
	}
	s := encodeForm(pairs)
	if s == "" {
		return path
	}
	return path + "?" + s
}

func langParam(lang string) string {
	if lang == "en" {
		return ""
	}
	return lang
}

func formParams(f FormValues, lang string) []kv {
	return []kv{{"q", f.Q}, {"category", f.Category}, {"town", f.Town}, {"lat", f.Lat}, {"lon", f.Lon}, {"radius_km", f.RadiusKm}, {"lang", langParam(lang)}}
}

func head(ctx PageContext, title string, noindex bool) string {
	w := WordsIn(ctx.Lang)
	robots := ""
	if noindex {
		robots = `<meta name="robots" content="noindex">`
	}
	p := loadPack()
	return `<!doctype html><html lang="` + ctx.Lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">` + robots + `<title>` + esc(title) + ` · ` + esc(w.S("title")) + `</title><style>` + p.Style + `</style></head><body>`
}

// langNav is the four languages as links that keep the search (the language you read in is the one you are in). params has its `lang` member last, as the TypeScript object does.
func langNav(ctx PageContext, path string, params []kv) string {
	w := WordsIn(ctx.Lang)
	var b strings.Builder
	b.WriteString(`<nav class="langs" aria-label="` + esc(w.S("language")) + `">`)
	for _, l := range Langs {
		if l == ctx.Lang {
			b.WriteString(`<b aria-current="true" lang="` + l + `">` + esc(LanguageLabel(l)) + `</b>`)
			continue
		}
		with := make([]kv, 0, len(params)+1)
		for _, p := range params {
			if p.k != "lang" {
				with = append(with, p)
			}
		}
		with = append(with, kv{"lang", langParam(l)})
		b.WriteString(`<a lang="` + l + `" hreflang="` + l + `" href="` + esc(link(path, with)) + `">` + esc(LanguageLabel(l)) + `</a>`)
	}
	b.WriteString(`</nav>`)
	return b.String()
}

func foot(ctx PageContext) string {
	w := WordsIn(ctx.Lang)
	return `<footer class="foot wrap"><a href="` + esc(link("/order", []kv{{"lang", langParam(ctx.Lang)}})) + `">` + esc(w.S("orderLink")) + `</a><a href="/.well-known/agent-card.json" lang="en">` + esc(w.S("assistants")) + `</a><span>` + esc(w.S("foot")) + `</span></footer>`
}

func selected(on bool) string {
	if on {
		return " selected"
	}
	return ""
}

func form(ctx PageContext, f FormValues) string {
	w := WordsIn(ctx.Lang)
	located := f.Lat != "" && f.Lon != ""
	kinds := []string{`<option value=""` + selected(f.Category == "") + `>` + esc(w.S("anyKind")) + `</option>`}
	for _, c := range Categories {
		kinds = append(kinds, `<option value="`+c+`"`+selected(f.Category == c)+`>`+esc(w.Map("kinds")[c])+`</option>`)
	}
	radii := []string{`<option value=""` + selected(f.RadiusKm == "") + `>` + esc(w.S("anyDistance")) + `</option>`}
	for _, n := range []int{5, 10, 25, 50} {
		radii = append(radii, `<option value="`+strconv.Itoa(n)+`"`+selected(f.RadiusKm == strconv.Itoa(n))+`>`+esc(w.Fn("km", n, "", nil))+`</option>`)
	}
	open := ""
	if f.Category != "" || f.RadiusKm != "" || f.Town != "" || located {
		open = " open"
	}
	hidden := " hidden"
	if located {
		hidden = ""
	}
	langField := ""
	if ctx.Lang != "en" {
		langField = `<input type="hidden" name="lang" value="` + ctx.Lang + `">`
	}
	return `<form class="search" action="/search" method="get" role="search">
<label for="q">` + esc(w.S("searchLabel")) + `</label><input id="q" name="q" type="search" value="` + esc(f.Q) + `" placeholder="` + esc(w.S("placeholder")) + `" maxlength="200" autocomplete="off" enterkeyhint="search">
<details class="choices"` + open + `><summary>` + esc(w.S("choices")) + `</summary>
<div class="pair"><div><label for="category">` + esc(w.S("kindLabel")) + `</label><select id="category" name="category">` + strings.Join(kinds, "") + `</select></div>
<div><label for="radius">` + esc(w.S("radiusLabel")) + `</label><select id="radius" name="radius_km">` + strings.Join(radii, "") + `</select></div></div>
<label for="town">` + esc(w.S("townLabel")) + `</label><input id="town" name="town" type="text" value="` + esc(f.Town) + `" maxlength="80" autocomplete="address-level2" aria-describedby="town-hint"><p class="note" id="town-hint">` + esc(w.S("townHint")) + `</p></details>
<input type="hidden" name="lat" value="` + esc(f.Lat) + `"><input type="hidden" name="lon" value="` + esc(f.Lon) + `">
<p class="note" id="near-set"` + hidden + `>` + esc(w.S("nearMeSet")) + `</p>
<button type="button" id="near" class="quiet" hidden>` + esc(w.S("nearMe")) + `</button>
` + langField + `
<button type="submit" class="full">` + esc(w.S("search")) + `</button>
</form>`
}

// askBox is "Ask in your own words": one box, a POST form (no script), so the words are never in an address. Shown only where the assistant is on.
func askBox(ctx PageContext, f FormValues) string {
	if !ctx.Assistant {
		return ""
	}
	w := WordsIn(ctx.Lang)
	coords := ""
	if f.Lat != "" && f.Lon != "" {
		coords = `<input type="hidden" name="lat" value="` + esc(f.Lat) + `"><input type="hidden" name="lon" value="` + esc(f.Lon) + `">`
	}
	langField := ""
	if ctx.Lang != "en" {
		langField = `<input type="hidden" name="lang" value="` + ctx.Lang + `">`
	}
	return `<form class="search ask" action="/search/ask" method="post" role="search">
<label for="ask">` + esc(w.S("askLabel")) + `</label><input id="ask" name="ask" type="text" value="` + esc(f.Ask) + `" placeholder="` + esc(w.S("askPlaceholder")) + `" maxlength="200" autocomplete="off" enterkeyhint="send">
` + coords + langField + `
<button type="submit" class="full">` + esc(w.S("askButton")) + `</button>
</form>`
}

func card(ctx PageContext, r SearchResultItem) string {
	w := WordsIn(ctx.Lang)
	photoOK := r.Item.Photo != nil && strings.HasPrefix(*r.Item.Photo, ctx.Origin+"/")
	price := `<p class="price ask">` + esc(w.S("ask")) + `</p>`
	if r.Item.Price != nil {
		note := ""
		if r.Item.Price.Note != "" {
			note = ` <span class="note">` + esc(r.Item.Price.Note) + `</span>`
		}
		price = `<p class="price">` + esc(rupees(r.Item.Price.Value)) + note + `</p>`
	}
	sure := r.Checked && r.Item.Availability == "in_stock"
	fresh := `<span class="stamp wait">` + esc(w.S("callToCheck")) + `</span>`
	if sure {
		fresh = `<span class="stamp ok">` + esc(Freshness(w, r.Item.Confirmed, ctx.Now)) + `</span>`
	}
	where := w.Fn("inTown", -1, "", map[string]string{"town": r.Shop.Town})
	if r.Shop.DistanceKm != nil {
		where = w.Fn("away", -1, "", map[string]string{"km": KmText(*r.Shop.DistanceKm)})
	}
	chat := r.Chat
	if ctx.Lang != "en" {
		chat += "&lang=" + ctx.Lang
	}
	ph := `<span>` + esc(w.Map("kinds")[r.Item.Category]) + `</span>`
	noClass := " no"
	if photoOK {
		ph = `<img src="` + esc(*r.Item.Photo) + `" alt="` + esc(w.Fn("photoOf", -1, "", map[string]string{"item": r.Item.Title})) + `" loading="lazy" decoding="async" width="400" height="300">`
		noClass = ""
	}
	tag := ""
	if r.Item.MachineWritten {
		tag = `<p class="tag">` + esc(w.S("machine")) + `</p>`
	}
	why := ""
	if !sure {
		why = `<p class="note why">` + esc(w.S("callToCheckWhy")) + `</p>`
	}
	return `<li class="card res"><div class="ph k-` + r.Item.Category + noClass + `">` + ph + `</div>
<div class="body"><h2 lang="` + r.Item.Lang + `">` + esc(r.Item.Title) + `</h2>` + tag + price + `
<p class="meta">` + fresh + `<span>` + esc(where) + `</span></p>` + why + `
<p class="shop">` + esc(r.Shop.Name) + ` <span>· ` + esc(r.Shop.Town) + `</span></p>
<a class="btn" href="` + esc(chat) + `" aria-label="` + esc(w.Fn("chatLabel", -1, "", map[string]string{"shop": r.Shop.Name, "item": r.Item.Title})) + `">` + esc(w.S("chat")) + `</a></div></li>`
}

// SearchPage is the whole search page for a view.
func SearchPage(ctx PageContext, f FormValues, view SearchView, assist *AssistBits) string {
	w := WordsIn(ctx.Lang)
	params := formParams(f, ctx.Lang)
	var main string
	switch view.State {
	case "start":
		var chips []string
		for _, e := range w.List("examples") {
			chips = append(chips, `<li><a class="chip" href="`+esc(link("/search", []kv{{"q", e}, {"lang", langParam(ctx.Lang)}}))+`">`+esc(e)+`</a></li>`)
		}
		for _, c := range Categories {
			chips = append(chips, `<li><a class="chip" href="`+esc(link("/search", []kv{{"category", c}, {"lang", langParam(ctx.Lang)}}))+`">`+esc(w.Map("kinds")[c])+`</a></li>`)
		}
		main = `<section class="state-page" aria-labelledby="st"><h2 id="st">` + esc(w.S("startTitle")) + `</h2><p>` + esc(w.S("startBody")) + `</p>
<p class="note">` + esc(w.S("tryThese")) + `</p><ul class="chips">` + strings.Join(chips, "") + `</ul></section>`
	case "results":
		results := view.Answer.Results
		unanswered := 0
		for _, r := range results {
			if !r.Checked {
				unanswered++
			}
		}
		var count string
		if language.TrimJS(f.Q) == "" {
			count = w.Fn("resultsNoWords", len(results), "", nil)
		} else {
			count = w.Fn("resultsFor", len(results), "", map[string]string{"q": language.TrimJS(f.Q)})
		}
		note := ""
		if unanswered > 0 {
			note = `<p class="notice" role="status">` + esc(w.Fn("unanswered", unanswered, "", nil)) + `</p>`
		}
		var cards []string
		for _, r := range results {
			cards = append(cards, card(ctx, r))
		}
		more := ""
		if view.Answer.Next != nil {
			with := append(append([]kv{}, params...), kv{"offset", *view.Answer.Next})
			more = `<a class="btn quiet more" href="` + esc(link("/search", with)) + `">` + esc(w.S("more")) + `</a>`
		}
		main = `<section aria-labelledby="rs"><h2 id="rs" class="sr">` + esc(count) + `</h2><p class="count" aria-hidden="true">` + esc(count) + `</p>` + note + `
<ul class="results">` + strings.Join(cards, "") + `</ul>
` + more + `</section>`
	case "none":
		main = `<section class="state-page card" aria-labelledby="st"><h2 id="st">` + esc(w.S("noneTitle")) + `</h2><p>` + esc(w.S("noneBody")) + `</p><a class="btn quiet" href="` + esc(link("/search", []kv{{"lang", langParam(ctx.Lang)}})) + `">` + esc(w.S("clear")) + `</a></section>`
	case "bad":
		main = `<section class="state-page state s-bad" role="alert"><h2>` + esc(w.S("badTitle")) + `</h2><p lang="en">` + esc(view.Message) + `</p></section>`
	case "busy":
		main = `<section class="state-page state s-wait" role="status"><h2>` + esc(w.S("busyTitle")) + `</h2><p>` + esc(w.S("busyBody")) + `</p></section>`
	default:
		main = `<section class="state-page state s-info" role="status"><h2>` + esc(w.S("downTitle")) + `</h2><p>` + esc(w.S("downBody")) + `</p></section>`
	}
	if assist != nil && (view.State == "results" || view.State == "none") {
		n, l := "", ""
		if assist.Notice != "" {
			n = `<p class="notice" role="status">` + esc(assist.Notice) + `</p>`
		}
		if assist.Line != "" {
			l = `<p class="askline" role="status">` + esc(assist.Line) + `</p>`
		}
		main = n + l + main
	}
	title := language.TrimJS(f.Q)
	if title == "" {
		title = w.S("title")
	}
	return head(ctx, title, true) + `<header class="top"><div class="wrap"><h1>` + esc(w.S("title")) + `</h1><p>` + esc(w.S("sub")) + `</p>` + langNav(ctx, "/search", params) + `</div></header>
<main class="wrap">` + askBox(ctx, f) + form(ctx, f) + main + `</main>` + foot(ctx) + `<script nonce="` + ctx.Nonce + `">` + loadPack().Script + `</script></body></html>`
}

// OrderPage is the page that states the order in plain words; linked from every search page.
func OrderPage(ctx PageContext) string {
	w := WordsIn(ctx.Lang)
	var steps []string
	for _, s := range w.List("orderSteps") {
		steps = append(steps, `<li>`+esc(s)+`</li>`)
	}
	return head(ctx, w.S("orderTitle"), false) + `<header class="top"><div class="wrap"><h1>` + esc(w.S("orderTitle")) + `</h1><p>` + esc(w.S("orderIntro")) + `</p>` + langNav(ctx, "/order", nil) + `</div></header>
<main class="wrap"><ol class="order">` + strings.Join(steps, "") + `</ol>
<section class="never" aria-labelledby="nv"><h2 id="nv">` + esc(w.S("orderNever")) + `</h2><p>` + esc(w.S("orderNeverBody")) + `</p></section>
<h2>` + esc(w.S("orderAsk")) + `</h2><p>` + esc(w.S("orderAskBody")) + `</p><h2>` + esc(w.S("orderWords")) + `</h2><p>` + esc(w.S("orderWordsBody")) + `</p><h2>` + esc(w.S("orderPrivate")) + `</h2><p>` + esc(w.S("orderPrivateBody")) + `</p>
<a class="btn quiet" href="` + esc(link("/search", []kv{{"lang", langParam(ctx.Lang)}})) + `">` + esc(w.S("back")) + `</a></main>` + foot(ctx) + `</body></html>`
}

var _ = fmt.Sprint
