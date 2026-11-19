// The pure functions of the directory against what the TypeScript gives on the same inputs (testdata/vectors.json, made by go/scripts/gen_directory_vectors.ts): the Latin fold and the
// text helpers, the fair order and its hash, the address reader (which must give JavaScript's answer or refuse), the dates and numbers JavaScript reads from text, the buyer's request, the
// cleaning of the buyer's words and the patterns over them, a model's typed answer and the small formatters. A refusal where the TypeScript accepts is allowed ONLY for the forms named in
// the tests (the Go side is the stricter reader); an answer different from the TypeScript's is a failure.
package directory

import (
	"encoding/json"
	"github.com/GeometerLabs/agents/go/internal/language"
	"math"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

type anyMap = map[string]any

func loadVectors(t *testing.T, section string) []anyMap {
	t.Helper()
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var all map[string][]anyMap
	if err := json.Unmarshal(raw, &all); err != nil {
		t.Fatal(err)
	}
	return all[section]
}

func strs(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func TestSkeletonAndText(t *testing.T) {
	for _, v := range loadVectors(t, "skeleton") {
		in := v["in"].(string)
		if got := normal(in); got != v["normal"] {
			t.Errorf("normal(%q) = %q, want %q", in, got, v["normal"])
		}
		if got := skeleton(in); got != v["skeleton"] {
			t.Errorf("skeleton(%q) = %q, want %q", in, got, v["skeleton"])
		}
		if got := wordsOf(in); !reflect.DeepEqual(append([]string{}, got...), strs(v["words"])) {
			t.Errorf("wordsOf(%q) = %q, want %q", in, got, v["words"])
		}
		if got := searchWords(in); !reflect.DeepEqual(append([]string{}, got...), strs(v["search"])) {
			t.Errorf("searchWords(%q) = %q, want %q", in, got, v["search"])
		}
	}
}

func TestDistanceAndKm(t *testing.T) {
	for _, v := range loadVectors(t, "haversine") {
		a, b := v["a"].(anyMap), v["b"].(anyMap)
		got := haversineKm(a["lat"].(float64), a["lon"].(float64), b["lat"].(float64), b["lon"].(float64))
		if math.Abs(got-v["km"].(float64)) > 1e-9*math.Max(1, math.Abs(got)) {
			t.Errorf("haversine %v %v = %v, want %v", a, b, got, v["km"])
		}
		if KmText(got) != v["text"] {
			t.Errorf("km(%v) = %q, want %q", got, KmText(got), v["text"])
		}
	}
	for _, v := range loadVectors(t, "km") {
		if got := KmText(v["n"].(float64)); got != v["text"] {
			t.Errorf("km(%v) = %q, want %q", v["n"], got, v["text"])
		}
	}
}

func TestOrderAndHash(t *testing.T) {
	for _, v := range loadVectors(t, "order") {
		var cands []Candidate
		for _, c := range v["candidates"].([]any) {
			m := c.(anyMap)
			cd := Candidate{Key: m["key"].(string), Shop: m["shop"].(string), Fit: int(m["fit"].(float64)), SameTown: m["sameTown"].(bool), InStock: m["inStock"].(bool)}
			if d, ok := m["distanceKm"].(float64); ok {
				cd.DistanceKm = &d
			}
			cands = append(cands, cd)
		}
		got := orderResults(cands, OrderQuery{Place: v["place"].(string), Seed: v["seed"].(string)})
		if !reflect.DeepEqual(got, strs(v["ordered"])) {
			t.Errorf("order (%v, %v, %d candidates) differs:\n got %v\nwant %v", v["place"], v["seed"], len(cands), got, v["ordered"])
		}
	}
	for _, v := range loadVectors(t, "turnHash") {
		in := v["in"].(string)
		if in == "�" || strings.ContainsRune(in, 0xfffd) {
			continue // a lone surrogate has no UTF-8 form
		}
		if got := turnHash(in); got != v["hash"] {
			t.Errorf("turnHash(%q) = %s, want %s", in, got, v["hash"])
		}
	}
	for _, v := range loadVectors(t, "dayOf") {
		if got := DayOf(int64(v["ms"].(float64))); got != v["day"] {
			t.Errorf("dayOf(%v) = %s, want %s", v["ms"], got, v["day"])
		}
	}
}

func TestAddresses(t *testing.T) {
	served, configured := []string{"pages.example"}, []string{"https://builder.example/feed/listings.json"}
	for _, v := range loadVectors(t, "urls") {
		in := v["in"].(string)
		js, _ := v["url"].(anyMap)
		got, ok := parseHTTPS(in)
		if ok {
			// the reader may only accept what JavaScript accepts, and read it the same way
			if js == nil || js["protocol"] != "https:" || js["username"] != "" || js["password"] != "" {
				t.Errorf("%q: Go reads it as %+v, JavaScript refuses or reads it as another kind of address", in, got)
				continue
			}
			for name, pair := range map[string][2]string{"href": {got.Href, js["href"].(string)}, "origin": {got.Origin, js["origin"].(string)}, "hostname": {got.Hostname, js["hostname"].(string)},
				"port": {got.Port, js["port"].(string)}, "pathname": {got.Pathname, js["pathname"].(string)}, "search": {got.Search, js["search"].(string)}, "hash": {got.Hash, js["hash"].(string)}} {
				if pair[0] != pair[1] {
					t.Errorf("%q: %s is %q, JavaScript says %q", in, name, pair[0], pair[1])
				}
			}
		}
		// a notice's address: Go may refuse what JavaScript allows only when it refused to read the address at all
		want := v["allowed"].(bool)
		if g := FeedAllowed(in, served, configured); g != want && !(want && !ok) {
			t.Errorf("FeedAllowed(%q) = %v, want %v", in, g, want)
		}
	}
}

func TestDatesAndNumbers(t *testing.T) {
	for _, v := range loadVectors(t, "dates") {
		in := v["in"].(string)
		got, ok := language.ParseJSDate(in)
		want, has := v["ms"].(float64)
		if strings.Contains(in, "T") && !strings.HasSuffix(in, "Z") && !strings.Contains(in, "+") {
			continue // a date-time with no zone is local time in JavaScript (the machine's zone); the service runs in UTC and Go reads it as UTC
		}
		switch {
		case ok && !has:
			t.Errorf("date %q: Go reads %d, JavaScript says Invalid Date", in, got)
		case ok && float64(got) != want:
			t.Errorf("date %q: %d, want %v", in, got, want)
		case !ok && has && strings.HasPrefix(in, "20") && !strings.ContainsAny(in, " ,") && !strings.HasSuffix(in, "03:30") && !strings.HasSuffix(in, "03:30:00") && !strings.HasPrefix(in, " "):
			t.Errorf("date %q: Go refuses, JavaScript says %v", in, want)
		}
	}
	for _, v := range loadVectors(t, "numbers") {
		in := v["in"].(string)
		got := jsNumber(in)
		switch w := v["n"].(type) {
		case float64:
			if got != w && !(w == 0 && got == 0) {
				t.Errorf("Number(%q) = %v, want %v", in, got, w)
			}
		case string:
			switch w {
			case "NaN":
				if !math.IsNaN(got) {
					t.Errorf("Number(%q) = %v, want NaN", in, got)
				}
			case "Infinity":
				if !math.IsInf(got, 1) {
					t.Errorf("Number(%q) = %v, want Infinity", in, got)
				}
			case "-Infinity":
				if !math.IsInf(got, -1) {
					t.Errorf("Number(%q) = %v, want -Infinity", in, got)
				}
			}
		}
	}
}

func TestRequestsAndLanguage(t *testing.T) {
	for _, v := range loadVectors(t, "requests") {
		in := SearchRequest(v["in"].(anyMap))
		q, place, lang, offset, bad := ReadRequest(in)
		if v["ok"] == false {
			if bad != v["error"] {
				t.Errorf("request %v: error %q, want %q", in, bad, v["error"])
			}
			continue
		}
		if bad != "" {
			t.Errorf("request %v: refused (%s), want it read", in, bad)
			continue
		}
		if !reflect.DeepEqual(append([]string{}, q.Words...), strs(v["words"])) || place != v["place"] || lang != v["lang"] || float64(offset) != v["offset"].(float64) {
			t.Errorf("request %v: words %v place %s lang %s offset %d, want %v %v %v %v", in, q.Words, place, lang, offset, v["words"], v["place"], v["lang"], v["offset"])
		}
		if c, _ := v["category"].(string); c != q.Category {
			t.Errorf("request %v: category %q want %q", in, q.Category, c)
		}
		if tn, _ := v["town"].(string); tn != q.Town {
			t.Errorf("request %v: town %q want %q", in, q.Town, tn)
		}
		if (v["radiusKm"] == nil) != (q.RadiusKm == nil) || q.RadiusKm != nil && *q.RadiusKm != v["radiusKm"].(float64) {
			t.Errorf("request %v: radius %v want %v", in, q.RadiusKm, v["radiusKm"])
		}
		if (v["point"] == nil) != (q.Point == nil) || q.Point != nil && (q.Point[0] != v["point"].(anyMap)["lat"].(float64) || q.Point[1] != v["point"].(anyMap)["lon"].(float64)) {
			t.Errorf("request %v: point %v want %v", in, q.Point, v["point"])
		}
	}
	for _, v := range loadVectors(t, "languageOf") {
		param, has := v["param"].(string)
		accept, _ := v["accept"].(string)
		if got := LanguageOf(param, has, accept); got != v["lang"] {
			t.Errorf("languageOf(%v, %q) = %s, want %s", v["param"], accept, got, v["lang"])
		}
	}
}

func intp(v any) *int {
	f, ok := v.(float64)
	if !ok {
		return nil
	}
	n := int(f)
	return &n
}

func TestCleaningAndRules(t *testing.T) {
	same := func(t *testing.T, in string, got Rules, want anyMap) {
		t.Helper()
		if !reflect.DeepEqual(got.RadiusKm, intp(want["radiusKm"])) || !reflect.DeepEqual(got.MaxPrice, intp(want["maxPrice"])) || got.NearMe != want["nearMe"].(bool) || got.Rest != want["rest"].(string) {
			t.Errorf("readRules(%q) = {%v %v %v %q}, want %v", in, deref(got.RadiusKm), deref(got.MaxPrice), got.NearMe, got.Rest, want)
		}
	}
	for _, v := range loadVectors(t, "clean") {
		in := v["in"].(string)
		if got := CleanQuestion(in); got != v["clean"] {
			t.Errorf("cleanQuestion(%q)\n got %q\nwant %q", in, got, v["clean"])
		}
		same(t, in, ReadRules(in), v["rules"].(anyMap))
		same(t, in+" (cleaned)", ReadRules(CleanQuestion(in)), v["rulesOfClean"].(anyMap))
	}
}

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestTypedSearch(t *testing.T) {
	for _, v := range loadVectors(t, "typed") {
		got := ReadTypedSearch(v["in"])
		want := v["typed"]
		if want == nil {
			if got != nil {
				t.Errorf("readTypedSearch(%v) = %+v, want it dropped", v["in"], got)
			}
			continue
		}
		if got == nil {
			t.Errorf("readTypedSearch(%v) dropped, want %v", v["in"], want)
			continue
		}
		b, _ := json.Marshal(got)
		var back any
		_ = json.Unmarshal(b, &back)
		if !reflect.DeepEqual(back, want) {
			t.Errorf("readTypedSearch(%v) = %s, want %v", v["in"], b, want)
		}
	}
	for _, v := range loadVectors(t, "requestOf") {
		b, _ := json.Marshal(v["typed"])
		var typed TypedSearch
		_ = json.Unmarshal(b, &typed)
		for _, c := range []struct {
			in   AskInput
			want any
		}{{AskInput{Lang: "hi", Lat: "10.5", Lon: "76.2"}, v["request"]}, {AskInput{Lang: "en"}, v["requestNoPoint"]}} {
			got := RequestOf(&typed, c.in, v["english"].(bool))
			gb, _ := json.Marshal(got)
			var back any
			_ = json.Unmarshal(gb, &back)
			if !reflect.DeepEqual(back, c.want) {
				t.Errorf("requestOf(%s) = %s, want %v", b, gb, c.want)
			}
		}
	}
}

func TestFreshnessAndLinks(t *testing.T) {
	for _, v := range loadVectors(t, "freshness") {
		got := Freshness(WordsIn(v["lang"].(string)), v["confirmed"].(string), int64(v["now"].(float64)))
		if got != v["text"] {
			t.Errorf("freshness(%v, %v, %v) = %q, want %q", v["confirmed"], v["now"], v["lang"], got, v["text"])
		}
	}
	for _, v := range loadVectors(t, "link") {
		var params []kv
		for _, p := range v["params"].([]any) {
			pair := p.([]any)
			s, _ := pair[1].(string)
			params = append(params, kv{pair[0].(string), s})
		}
		if got := link(v["path"].(string), params); got != v["link"] {
			t.Errorf("link(%v, %v) = %q, want %q", v["path"], v["params"], got, v["link"])
		}
	}
}

var _ = strconv.Itoa
