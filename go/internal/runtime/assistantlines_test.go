package runtime

// The owner's assistant's lines against the TypeScript's own (testdata/assistant-lines.json, made by go/scripts/gen_assistant_vectors.ts from modules/assistant/words.ts and
// templates.ts): for each line, in en, hi, ml and kn, the Go code that says it on a Bookings shop (and, since 23 Nov 2026, a Fees centre's who owes and its cards) builds the
// same words from the same data, and the outgoing check over the facts ITS writer noted finds nothing in the line and, once the line is tampered with (a stray number, a changed
// amount, a link, another date), the same problems as check.ts, word for word. The combined lines (the day's list with its rows, "and N more" and the closed-day line; who owes
// with its rows; a closed day with the customers not reached; every limit line) are here so that a change in how Go joins them is caught in every language.

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type lineCase struct {
	Lang     string         `json:"lang"`
	Kind     string         `json:"kind"`
	Go       map[string]any `json:"go"`
	Text     string         `json:"text"`
	Problems []string       `json:"problems"`
	Tampered []struct {
		Text     string   `json:"text"`
		Problems []string `json:"problems"`
	} `json:"tampered"`
}

// lineConv is a conversation on the owner's page with nothing else: what it says is handed to the spy.
func lineConv(t *testing.T, lang string, loc *time.Location, said *[]saidFacts, blocked *[]string) *conv {
	c := &conv{r: &Runtime{loc: loc}, a: &assistant.State{}, pack: assistant.Words(lang), lang: lang, toPage: true}
	c.hooks = &AssistantHooks{Log: func(_, _, action, outcome string, _ any, more messaging.LogMore) {
		if action == "send_message" && outcome == "blocked" && more.Notes != nil {
			*blocked = append(*blocked, *more.Notes)
		}
	}}
	c.tellSpy = func(text string, facts language.Facts) { *said = append(*said, saidFacts{text: text, facts: facts}) }
	return c
}

func vDate(v any) LocalDate {
	m := v.(map[string]any)
	return LocalDate{int(m["year"].(float64)), int(m["month"].(float64)), int(m["day"].(float64))}
}

func vInt(v any) int64 { return int64(v.(float64)) }

func vRows(v any) []DayRow {
	var out []DayRow
	for _, x := range v.([]any) {
		m := x.(map[string]any)
		out = append(out, DayRow{Case: m["case"].(string), StartMs: vInt(m["startMs"]), What: m["what"].(string), Who: m["who"].(string), State: m["state"].(string)})
	}
	return out
}

func vLimit(g map[string]any) LimitView {
	z, _ := g["zeroIsOff"].(bool)
	return (&LimitDecl{Kind: g["kind"].(string), Unit: g["unit"].(string), ZeroIsOff: z}).view()
}

// say runs one case through the Go code that says it and gives the line and its facts.
func (c *conv) sayCase(t *testing.T, k lineCase, said *[]saidFacts) saidFacts {
	g := k.Go
	*said = nil
	switch k.Kind {
	case "day_list":
		w := c.pack.Writer()
		d := vDate(g["date"])
		c.tellText("day_list", c.dayList(w, d, vRows(g["rows"]), g["closed"].(bool)), w.Facts(), "", nil)
	case "closed":
		var booked []Booked
		for _, x := range g["booked"].([]any) {
			m := x.(map[string]any)
			booked = append(booked, Booked{Case: m["case"].(string), Who: m["who"].(string)})
		}
		var told []string
		for _, x := range g["told"].([]any) {
			told = append(told, x.(string))
		}
		c.closedLine(c.dateText(vDate(g["date"])), booked, told)
	case "limit":
		c.sayLimit(g["what"].(string), vLimit(g), vInt(g["value"]), 0)
	case "not_tighter":
		c.sayNotTighter(vLimit(g), vInt(g["now"]), vInt(g["to"]))
	case "which":
		var decl []LimitDecl
		for _, x := range g["kinds"].([]any) {
			decl = append(decl, LimitDecl{Kind: x.(string)})
		}
		c.sayWhichLimit(decl)
	case "card_limit", "card":
		// offerCard's words: the question, then the line under it with the card's code (a card is never a page line, so it is checked here as say's Matches checks it)
		w := c.pack.Writer()
		var q string
		if k.Kind == "card_limit" {
			q = c.cardQuestion(w, "limits", "limit", "", "limit:"+g["kind"].(string), Shown{Limit: &LimitCardView{LimitView: vLimit(g), Now: vInt(g["now"]), To: vInt(g["to"])}})
		} else {
			skill, _ := g["skill"].(string)
			if skill == "" {
				skill = "bookings"
			}
			itemKind, _ := g["itemKind"].(string)
			q = c.cardQuestion(w, skill, g["kind"].(string), itemKind, g["ref"].(string), Shown{Who: g["who"].(string), What: g["what"].(string), AmountPaise: vInt(g["amountPaise"])})
		}
		return saidFacts{text: q + "\n" + c.cardFoot(w, g["code"].(string), g["hasNo"] != false, false), facts: w.Facts()}
	case "need_ref":
		if skill, ok := g["skill"].(string); ok {
			c.skills = []OwnerSkill{namedSkill{name: skill}} // the shop's own skill names its kind of case (conv.ownKey)
		}
		c.needRefLine(g["kind"].(string), vRows(g["rows"]))
	case "owes_list":
		var rows []OweRow
		for _, x := range g["rows"].([]any) {
			m := x.(map[string]any)
			rows = append(rows, OweRow{Case: m["case"].(string), Who: m["who"].(string), What: m["what"].(string), AmountPaise: vInt(m["amountPaise"]), DueMs: vInt(m["dueMs"])})
		}
		w := c.pack.Writer()
		c.tellText("owes_list", c.owesList(w, rows), w.Facts(), "", nil)
	case "tmpl":
		return c.dayTemplate(g["id"].(string), c.lang, g["shop"].(string), vDate(g["date"]), vInt(g["startMs"]))
	case "say":
		key := g["key"].(string)
		switch key {
		case "reopened.n":
			c.say(key, "date", c.dateText(vDate(g["date"])), "n", strconv.FormatInt(vInt(g["n"]), 10))
		case "refusal.no_window":
			c.refusal("no_window", g["ref"].(string), g["who"].(string))
		case "money_in.some":
			c.say(key, "date", c.dateText(vDate(g["date"])), "inr", assistant.INR(vInt(g["paise"])), "n", strconv.FormatInt(vInt(g["n"]), 10))
		default:
			c.say(key, "shop", g["shop"].(string))
		}
	default:
		t.Fatalf("no such case kind %q", k.Kind)
	}
	if len(*said) != 1 {
		t.Fatalf("%s %s: %d lines said, want 1", k.Lang, k.Kind, len(*said))
	}
	return (*said)[0]
}

func TestAssistantLinesAreTheTypeScriptsAndTheirCheckToo(t *testing.T) {
	b, err := os.ReadFile("testdata/assistant-lines.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		TimeZone string     `json:"timeZone"`
		Cases    []lineCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	loc, err := time.LoadLocation(v.TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Cases) < 80 {
		t.Fatalf("only %d cases", len(v.Cases))
	}
	for i, k := range v.Cases {
		var said []saidFacts
		var blocked []string
		c := lineConv(t, k.Lang, loc, &said, &blocked)
		got := c.sayCase(t, k, &said)
		if got.text != k.Text {
			t.Errorf("case %d (%s %s): words\n got %q\nwant %q", i, k.Lang, k.Kind, got.text, k.Text)
			continue
		}
		if p := language.CheckText(got.text, got.facts); !reflect.DeepEqual(nonNil(p), nonNil(k.Problems)) {
			t.Errorf("case %d (%s %s): own check %q, want %q", i, k.Lang, k.Kind, p, k.Problems)
		}
		if len(blocked) > 0 {
			t.Errorf("case %d (%s %s): held back: %v", i, k.Lang, k.Kind, blocked)
		}
		for _, tm := range k.Tampered {
			if p := language.CheckText(tm.Text, got.facts); !reflect.DeepEqual(nonNil(p), nonNil(tm.Problems)) {
				t.Errorf("case %d (%s %s) tampered %q:\n got %q\nwant %q", i, k.Lang, k.Kind, tm.Text, p, tm.Problems)
			}
		}
	}
}

// A page line that fails the check is not shown, and the record says why in TypeScript's words (conversation.ts tell on the page).
func TestAPageLineThatFailsTheCheckIsNotShown(t *testing.T) {
	var said []saidFacts
	var blocked []string
	c := lineConv(t, "en", time.UTC, &said, &blocked)
	if c.tellText("talk_reply", "Bookings today: 7.", language.Facts{}, "", nil) {
		t.Fatal("a line with a number the record does not hold was shown")
	}
	if len(c.a.Talk) != 0 || len(blocked) != 1 || blocked[0] != "the answer failed the outgoing check and was not shown: The message has the number 7, which is not in the record for this conversation." {
		t.Fatalf("talk %v, blocked %q", c.a.Talk, blocked)
	}
	if !c.tellText("talk_reply", "Bookings today: 7.", language.Facts{Counts: []float64{7}}, "", nil) || len(c.a.Talk) != 1 {
		t.Fatal("the same line with its count noted was not shown")
	}
}

// On WhatsApp the shared say runs the check (sayVoice.matches): allowed with the reason TypeScript writes, blocked with the problems alone.
func TestTheAssistantsWhatsAppCheckIsCheckText(t *testing.T) {
	ok := assistantVoice{}.Matches("Refunds above ₹500 need your approval.", saidFacts{facts: language.Facts{AmountsInr: []float64{500}}})
	if ok.Verdict != "allow" || ok.Reason != "every value in the message is on the record" {
		t.Fatalf("%+v", ok)
	}
	no := assistantVoice{}.Matches("Refunds above ₹600 need your approval.", saidFacts{facts: language.Facts{AmountsInr: []float64{500}}})
	if no.Verdict != "block" || no.RuleID != "message-matches-record" || no.Reason != "The message says ₹600, but the record only has ₹500." {
		t.Fatalf("%+v", no)
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// namedSkill is a skill with a name and nothing else: what the lines read of the shop's own skill.
type namedSkill struct{ name string }

func (k namedSkill) Name() string                                 { return k.name }
func (namedSkill) Owns(string) bool                               { return false }
func (namedSkill) Prepare(assistant.Raw) (Prepared, string)       { return Prepared{}, "not_here" }
func (namedSkill) Execute(assistant.Action) Executed              { return Executed{} }
func (namedSkill) Waiting() []WaitingItem                         { return nil }
func (namedSkill) Problems() int                                  { return 0 }
