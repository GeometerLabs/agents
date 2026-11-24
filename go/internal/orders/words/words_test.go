package words

// The words, proved equal to the TypeScript on the vectors go/scripts/gen_orders_words.ts makes from the real TypeScript functions (templates.ts render and need, meta-templates.ts,
// interactive.ts, check.ts, limits.ts checkMessageMatchesRecord, settings.ts itemName):
//   testdata/render-vectors.json.gz  every message of every language rendered from four varied sets of facts (text, the outgoing check's problems, the rule's decision, and the same
//                                    for the text with a tail the record does not hold), and from those facts with each fact the message needs taken away (the refusal's own sentence,
//                                    so the first missing fact in reading order is proved), area by area
//   testdata/words-vectors.json.gz   the WhatsApp parameters, filled bodies, templateMessage choices and submissions, exampleFacts of two shops, labels, buttons, the owner's mark
//                                    buttons, the menu and window lists, clip and itemName
// They stand for the TypeScript unit tests language.test.ts, meta-templates.test.ts and buttons.test.ts.

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

func readJSON(t *testing.T, name string, into any) {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasSuffix(name, ".gz") {
		z, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		var b bytes.Buffer
		if _, err := b.ReadFrom(z); err != nil {
			t.Fatal(err)
		}
		raw = b.Bytes()
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

func canon(v any) string {
	b, _ := json.Marshal(v)
	var x any
	_ = json.Unmarshal(b, &x)
	out, _ := json.Marshal(x) // maps are written with sorted keys
	return string(out)
}

func sameJSON(t *testing.T, name string, want json.RawMessage, got any) {
	t.Helper()
	var w any
	_ = json.Unmarshal(want, &w)
	if canon(w) != canon(got) {
		t.Errorf("%s:\nwant %s\n got %s", name, canon(w), canon(got))
	}
}

// factsOf decodes a fact set (JSON with the TypeScript's member names) into MessageFacts, refusing a member the struct does not have, after taking away the named facts
// ("plan.meals" is a plan's member).
func factsOf(t *testing.T, set map[string]any, without []string) *MessageFacts {
	t.Helper()
	m := map[string]any{}
	for k, v := range set {
		m[k] = v
	}
	// a plan's members first, so taking away "plan" itself leaves the plan absent (the generator does the same)
	sorted := append([]string{}, without...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return strings.HasPrefix(sorted[i], "plan.") && !strings.HasPrefix(sorted[j], "plan.")
	})
	for _, k := range sorted {
		if strings.HasPrefix(k, "plan.") {
			p := map[string]any{}
			for pk, pv := range m["plan"].(map[string]any) {
				p[pk] = pv
			}
			delete(p, k[5:])
			m["plan"] = p
		} else {
			delete(m, k)
		}
	}
	b, _ := json.Marshal(m)
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	f := &MessageFacts{}
	if err := d.Decode(f); err != nil {
		t.Fatalf("facts: %v", err)
	}
	return f
}

type verdict struct {
	OK       bool     `json:"ok"`
	Problems []string `json:"problems"`
}

func TestRenderVectors(t *testing.T) {
	var file struct {
		Facts   []map[string]any `json:"facts"`
		Vectors []struct {
			ID       string          `json:"id"`
			Language string          `json:"language"`
			Facts    int             `json:"facts"`
			Without  []string        `json:"without"`
			Text     *string         `json:"text"`
			Error    *string         `json:"error"`
			Check    *verdict        `json:"check"`
			Decision json.RawMessage `json:"decision"`
			Mutated  *struct {
				Text     string          `json:"text"`
				Check    verdict         `json:"check"`
				Decision json.RawMessage `json:"decision"`
			} `json:"mutated"`
		} `json:"vectors"`
	}
	readJSON(t, "render-vectors.json.gz", &file)
	full, refused, same := 0, 0, 0
	walked := map[string]int{}
	for _, v := range file.Vectors {
		f := factsOf(t, file.Facts[v.Facts], v.Without)
		name := v.Language + "/" + v.ID
		text, err := Render(v.ID, f)
		if v.Text == nil {
			if v.Error == nil {
				t.Fatalf("%s: a vector with neither text nor error", name)
			}
			if err == nil || err.Error() != *v.Error {
				t.Errorf("%s without %v: want the refusal %q, got %q (%v)", name, v.Without, *v.Error, text, err)
			}
			refused++
			continue
		}
		if err != nil || text != *v.Text {
			t.Errorf("%s without %v: want %q, got %q (%v)", name, v.Without, *v.Text, text, err)
			continue
		}
		if v.Check == nil {
			same++ // a fact the message does not need, taken away: the same words
			continue
		}
		full++
		walked[v.Language]++
		problems := CheckMessage(text, f)
		if v.Check.OK != (len(problems) == 0) || strings.Join(problems, "\n") != strings.Join(v.Check.Problems, "\n") {
			t.Errorf("%s: the check said %v, want %+v", name, problems, *v.Check)
		}
		sameJSON(t, name+" decision", v.Decision, MatchesRecord(text, f))
		mp := CheckMessage(v.Mutated.Text, f)
		if v.Mutated.Check.OK != (len(mp) == 0) || strings.Join(mp, "\n") != strings.Join(v.Mutated.Check.Problems, "\n") {
			t.Errorf("%s (with a tail): the check said %v, want %+v", name, mp, v.Mutated.Check)
		}
		sameJSON(t, name+" decision (with a tail)", v.Mutated.Decision, MatchesRecord(v.Mutated.Text, f))
		if v.Mutated.Check.OK {
			t.Errorf("%s: the tail the record does not hold was not refused", name)
		}
	}
	ids := len(WordsFor("en").T)
	for _, l := range []string{"en", "hi", "ml", "kn"} {
		if walked[l] != 4*ids {
			t.Errorf("%s: walked %d renders, want %d (4 fact sets of %d messages)", l, walked[l], 4*ids, ids)
		}
	}
	if refused < 4*ids || full < 16*ids {
		t.Fatalf("too few cases: %d renders, %d refusals", full, refused)
	}
	t.Logf("%d messages rendered and checked, %d refusals, %d unchanged without an unneeded fact", full, refused, same)
}

type wordsVectors struct {
	Meta []struct {
		Name       string          `json:"name"`
		Language   string          `json:"language"`
		Facts      int             `json:"facts"`
		Parameters json.RawMessage `json:"parameters"`
		Body       string          `json:"body"`
		Filled     string          `json:"filled"`
	} `json:"meta"`
	TemplateMessage []struct {
		Name     string          `json:"name"`
		Language string          `json:"language"`
		Facts    int             `json:"facts"`
		What     string          `json:"what"`
		IDs      []string        `json:"ids"`
		Text     string          `json:"text"`
		Generic  string          `json:"generic"`
		Out      json.RawMessage `json:"out"`
	} `json:"templateMessage"`
	Example []struct {
		Shop     string          `json:"shop"`
		Language string          `json:"language"`
		Out      json.RawMessage `json:"out"`
	} `json:"example"`
	Submissions []struct {
		Shop     string          `json:"shop"`
		ShopData Shop            `json:"shopData"`
		Out      json.RawMessage `json:"out"`
	} `json:"submissions"`
	Labels []struct {
		Language string            `json:"language"`
		Out      map[string]string `json:"out"`
	} `json:"labels"`
	Buttons []struct {
		Language string          `json:"language"`
		IDs      []string        `json:"ids"`
		Out      json.RawMessage `json:"out"`
	} `json:"buttons"`
	OwnerMarks []struct {
		Language    string          `json:"language"`
		Kind        string          `json:"kind"`
		Code        string          `json:"code"`
		AmountInr   float64         `json:"amountInr"`
		KeepAllowed bool            `json:"keepAllowed"`
		Out         json.RawMessage `json:"out"`
	} `json:"ownerMarks"`
	ItemList []struct {
		Shop     string          `json:"shop"`
		ShopData Shop            `json:"shopData"`
		Language string          `json:"language"`
		Out      json.RawMessage `json:"out"`
	} `json:"itemList"`
	SlotList []struct {
		Language string          `json:"language"`
		Zone     string          `json:"zone"`
		Windows  []WindowRow     `json:"windows"`
		Out      json.RawMessage `json:"out"`
	} `json:"slotList"`
	Clip []struct {
		Text string          `json:"text"`
		Max  int             `json:"max"`
		Out  json.RawMessage `json:"out"`
	} `json:"clip"`
	Names []struct {
		Shop     string `json:"shop"`
		Item     string `json:"item"`
		Language string `json:"language"`
		Out      string `json:"out"`
	} `json:"names"`
}

func TestMetaVectors(t *testing.T) {
	var facts struct {
		Facts []map[string]any `json:"facts"`
	}
	readJSON(t, "render-vectors.json.gz", &facts)
	var v wordsVectors
	readJSON(t, "words-vectors.json.gz", &v)
	templates := len(MetaTemplates("en"))
	for _, m := range v.Meta {
		var tm *MetaWord
		for _, w := range MetaTemplates(m.Language) {
			if w.Name == m.Name {
				w := w
				tm = &w
			}
		}
		if tm == nil {
			t.Fatalf("%s/%s: no such template", m.Language, m.Name)
		}
		f := factsOf(t, facts.Facts[m.Facts], nil)
		params, err := MetaParameters(*tm, f)
		name := m.Language + "/" + m.Name
		var want any
		_ = json.Unmarshal(m.Parameters, &want)
		if obj, ok := want.(map[string]any); ok { // a refusal
			if err == nil || err.Error() != obj["error"] {
				t.Errorf("%s: want the refusal %v, got %v (%v)", name, obj["error"], params, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		body := MetaBody(tm.Body)
		if body != m.Body || FillBody(body, params) != m.Filled {
			t.Errorf("%s: body %q filled %q, want %q %q", name, body, FillBody(body, params), m.Body, m.Filled)
		}
		sameJSON(t, name+" parameters", m.Parameters, params)
	}
	if len(v.Meta) != 16*templates {
		t.Errorf("walked %d template cases, want %d", len(v.Meta), 16*templates)
	}
	picked := 0
	for _, m := range v.TemplateMessage {
		f := factsOf(t, facts.Facts[m.Facts], nil)
		got := MetaTemplateMessage(m.IDs, f, m.Text, m.Generic)
		sameJSON(t, m.Language+"/"+m.Name+"/"+m.What, m.Out, got)
		if got.Name != m.Generic {
			picked++
		}
	}
	if picked < 100 {
		t.Errorf("only %d messages went as a template: the cases do not reach the real templates", picked)
	}
	shops := map[string]Shop{}
	for _, s := range v.Submissions {
		shops[s.Shop] = s.ShopData
		s := s
		got, err := MetaSubmissions(&s.ShopData)
		if err != nil {
			t.Fatal(err)
		}
		sameJSON(t, "submissions "+s.Shop, s.Out, got)
		if len(got) != 4*templates {
			t.Errorf("%d submissions, want %d", len(got), 4*templates)
		}
	}
	for _, e := range v.Example {
		s := shops[e.Shop]
		sameJSON(t, "exampleFacts "+e.Shop+"/"+e.Language, e.Out, ExampleFacts(&s, e.Language))
	}
	if len(v.Example) != 8 {
		t.Errorf("walked %d exampleFacts, want 8", len(v.Example))
	}
}

func TestInteractiveVectors(t *testing.T) {
	var v wordsVectors
	readJSON(t, "words-vectors.json.gz", &v)
	for _, c := range v.Labels {
		for k, want := range c.Out {
			if got := Label(c.Language, k); got != want {
				t.Errorf("label %s/%s: want %q, got %q", c.Language, k, want, got)
			}
		}
		if len(c.Out) != len(WordsFor(c.Language).Labels) {
			t.Errorf("%s: %d labels in the TypeScript, %d here", c.Language, len(c.Out), len(WordsFor(c.Language).Labels))
		}
	}
	for _, c := range v.Buttons {
		sameJSON(t, "buttons "+c.Language+" "+strings.Join(c.IDs, ","), c.Out, ButtonsFor(c.Language, c.IDs...))
	}
	for _, c := range v.OwnerMarks {
		sameJSON(t, "ownerMarks "+c.Language+" "+c.Kind, c.Out, OwnerMarkButtons(c.Language, MarkAsk{Kind: c.Kind, Code: c.Code, AmountInr: c.AmountInr, KeepAllowed: c.KeepAllowed}))
	}
	for _, c := range v.ItemList {
		sameJSON(t, "itemList "+c.Shop+" "+c.Language, c.Out, ItemList(&c.ShopData, c.Language))
	}
	for _, c := range v.SlotList {
		sameJSON(t, "slotList "+c.Language+" "+c.Zone, c.Out, SlotList(c.Windows, c.Zone, c.Language))
	}
	for _, c := range v.Clip {
		var want string
		_ = json.Unmarshal(c.Out, &want)
		if got := Clip(c.Text, c.Max); got != want {
			t.Errorf("clip(%q, %d): want %q, got %q", c.Text, c.Max, want, got)
		}
	}
	shops := map[string]Shop{}
	for _, s := range v.Submissions {
		shops[s.Shop] = s.ShopData
	}
	for _, c := range v.Names {
		s := shops[c.Shop]
		for i := range s.Menu {
			if s.Menu[i].ID == c.Item {
				if got := ItemName(&s.Menu[i], c.Language); got != c.Out {
					t.Errorf("itemName %s/%s/%s: want %q, got %q", c.Shop, c.Item, c.Language, c.Out, got)
				}
			}
		}
	}
	if len(v.Buttons) != 24 || len(v.OwnerMarks) != 28 || len(v.ItemList) != 12 || len(v.SlotList) != 20 || len(v.Clip) != 40 || len(v.Names) != 20 {
		t.Errorf("walked %d buttons, %d marks, %d item lists, %d slot lists, %d clips, %d names", len(v.Buttons), len(v.OwnerMarks), len(v.ItemList), len(v.SlotList), len(v.Clip), len(v.Names))
	}
	if ButtonID("cancelYes") != "cancel_yes" || ItemRowID("thali") != "item:thali" || SlotRowID("lunch") != "slot:lunch" {
		t.Errorf("the ids are %q %q %q", ButtonID("cancelYes"), ItemRowID("thali"), SlotRowID("lunch"))
	}
}

// A message whose record lacks a fact is refused with the TypeScript's sentence; a plan's own fact is named "plan.<member>"; a day with no dateMs is read from the window.
func TestMissingFactAndFallbacks(t *testing.T) {
	f := &MessageFacts{Language: "en", TimeZone: "Asia/Kolkata", BusinessName: "Annapurna Tiffins"}
	_, err := Render("confirm_details", f)
	if err == nil || err.Error() != `The message needs "itemsText" from the record, and the record does not have it.` {
		t.Fatalf("got %v", err)
	}
	f.ItemsText = S("2 × Veg thali")
	if _, err = Render("confirm_details", f); err == nil || !strings.Contains(err.Error(), `"slotFromMs"`) {
		t.Fatalf("a day without dateMs reads the window's start: got %v", err)
	}
	f.SlotFromMs = N(1_794_313_800_000)
	if got, err := Render("confirm_details", f); err != nil || got != `Just to be sure: 2 × Veg thali on Tue 10 Nov. Reply "yes" to continue.` {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err = Render("plan_quote", &MessageFacts{Language: "en", TimeZone: "UTC", ItemsText: S("x")}); err == nil || !strings.Contains(err.Error(), `"plan"`) {
		t.Fatalf("got %v", err)
	}
	if _, err = Render("plan_quote", &MessageFacts{Language: "en", TimeZone: "UTC", ItemsText: S("x"), Plan: &PlanFacts{}}); err == nil || !strings.Contains(err.Error(), `"plan.meals"`) {
		t.Fatalf("got %v", err)
	}
	if _, err = Render("no_such_message", f); err == nil {
		t.Fatal("an unknown id is an error")
	}
	if _, err = Render("confirm_details", &MessageFacts{Language: "en", TimeZone: "Mars/Olympus", ItemsText: S("x"), DateMs: N(0)}); err == nil {
		t.Fatal("an unknown time zone is an error")
	}
}

// Every message has the same id in every language, and each slot a pack names is one the code can fill (a build fault otherwise).
func TestEveryMessageHasFourLanguages(t *testing.T) {
	want := len(WordsFor("en").T)
	if want < 100 {
		t.Fatalf("only %d messages", want)
	}
	for _, l := range []string{"hi", "ml", "kn"} {
		w := WordsFor(l)
		if len(w.T) != want {
			t.Errorf("%s has %d messages, English %d", l, len(w.T), want)
		}
		for id := range WordsFor("en").T {
			if _, ok := w.T[id]; !ok {
				t.Errorf("%s lacks %s", l, id)
			}
		}
	}
	if WordsFor("fr") != WordsFor("en") {
		t.Error("an unknown language is English")
	}
}

// TestPlanTemplatesInAClosedWindow is the hand check's finding of 24 Nov 2026: on a UPI shop the plan's renewal writes the UPI ID after its link, and "your plan is on" and the
// owner's "plan cancelled" had no template, so all three went under the generic name, which WhatsApp refuses outside the window. Each now goes as its own template, in every
// language; and since 25 Nov so do the four that go out unasked: the lapse, the hold that ran out and the credit going back (done, or waiting for the owner).
func TestPlanTemplatesInAClosedWindow(t *testing.T) {
	s := func(v string) *string { return &v }
	n := func(v int64) *int64 { return &v }
	for _, lang := range []string{"en", "hi", "ml", "kn"} {
		for _, upi := range []bool{false, true} {
			f := &MessageFacts{Language: lang, TimeZone: "Asia/Kolkata", BusinessName: "Annapurna Tiffins", ItemsText: s("2 × Veg thali"), TotalInr: n(4400), AdvanceInr: n(4000),
				DateMs: n(1763251200000), CutoffMs: n(1763215200000), RefundInr: n(109), Link: s("https://rzp.io/i/plan"), OrderRef: s("o-7"), CustomerPhone: s("+919811111111"),
				Plan: &PlanFacts{Meals: n(22), FromMs: n(1763251200000), ToMs: n(1765756800000)}}
			if upi {
				f.UpiID, f.Payee = s("annapurna@okaxis"), s("Annapurna Tiffins")
			}
			for _, id := range []string{"plan_renewal", "plan_active", "owner_plan_cancelled", "plan_lapsed", "plan_hold_expired", "plan_credit_refund", "plan_credit_refund_pending"} {
				text, err := Render(id, f)
				if err != nil {
					t.Fatalf("%s %s: %v", lang, id, err)
				}
				if upi && id == "plan_renewal" && !strings.Contains(text, "annapurna@okaxis") {
					t.Fatalf("%s: the UPI renewal does not name the UPI ID: %s", lang, text)
				}
				if got := MetaTemplateMessage([]string{id}, f, text, "generic"); got.Name != id {
					t.Errorf("%s %s (UPI %v): went as %q, want its own template; text %q", lang, id, upi, got.Name, text)
				}
			}
		}
	}
}
