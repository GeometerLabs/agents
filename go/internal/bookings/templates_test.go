package bookings

// The words, proved equal to the TypeScript on testdata/templates-vectors.json (made by go/scripts/gen_bookings_vectors.ts from the real TypeScript functions): every message of
// every language rendered from the example facts and read by the outgoing check (area "render"), every WhatsApp template's body, parameters and filled text ("meta"), the
// labels, the lists of services and free times, the buttons and the list of templates a shop submits to Meta. They stand for the TypeScript unit tests language.test.ts,
// meta-templates.test.ts and buttons.test.ts. A few more cases below walk what the vectors do not: a missing fact, the owner's day list, a Hindi-looking fact in English.

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func exampleLang(t *testing.T) (*Settings, map[string]*MessageFacts) {
	s := exampleSettings(t)
	m := map[string]*MessageFacts{}
	for _, l := range []string{"en", "hi", "ml", "kn"} {
		m[l] = ExampleFacts(s, l)
	}
	return s, m
}

func TestRenderVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "templates-vectors.json", &vs)
	_, facts := exampleLang(t)
	n := 0
	for _, v := range vs {
		if v.Area != "render" {
			continue
		}
		var in struct{ ID, Language string }
		_ = json.Unmarshal(v.Input, &in)
		var want struct {
			Text  *string `json:"text"`
			Check *struct {
				OK       bool     `json:"ok"`
				Problems []string `json:"problems"`
			} `json:"check"`
		}
		_ = json.Unmarshal(v.Output, &want)
		f := facts[in.Language]
		text, err := Render(in.ID, f)
		if want.Text == nil {
			// a message that needs facts the example does not carry: refused, naming the fact
			if _, miss := err.(*MissingFact); !miss {
				t.Errorf("%s: want a refusal, got %q, %v", v.Name, text, err)
			}
			n++
			continue
		}
		if err != nil || text != *want.Text {
			t.Errorf("%s: want %q, got %q (%v)", v.Name, *want.Text, text, err)
			continue
		}
		problems := CheckMessage(text, f)
		if want.Check.OK != (len(problems) == 0) || (len(problems) > 0 && strings.Join(problems, "\n") != strings.Join(want.Check.Problems, "\n")) {
			t.Errorf("%s: the check said %v, want %+v", v.Name, problems, want.Check)
		}
		n++
	}
	if n != 4*len(WordsFor("en").T) {
		t.Fatalf("walked %d messages, want %d (4 languages)", n, 4*len(WordsFor("en").T))
	}
}

func TestMetaVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "templates-vectors.json", &vs)
	s, facts := exampleLang(t)
	n := 0
	for _, v := range vs {
		switch v.Area {
		case "meta":
			var in struct{ Name, Language string }
			_ = json.Unmarshal(v.Input, &in)
			var tm *MetaWord
			for _, m := range MetaTemplates(in.Language) {
				if m.Name == in.Name {
					m := m
					tm = &m
				}
			}
			if tm == nil {
				t.Fatalf("%s: no such template", v.Name)
			}
			params, err := MetaParameters(*tm, facts[in.Language])
			if err != nil {
				t.Fatalf("%s: %v", v.Name, err)
			}
			body := MetaBody(tm.Body)
			sameJSON(t, v.Name, v.Output, map[string]any{"body": body, "parameters": params, "filled": FillBody(body, params)})
			n++
		case "submissions":
			got, err := MetaSubmissions(s)
			if err != nil {
				t.Fatal(err)
			}
			sameJSON(t, v.Name, v.Output, got)
			n++
		}
	}
	if n != 4*len(MetaTemplates("en"))+1 {
		t.Fatalf("walked %d cases, want %d", n, 4*len(MetaTemplates("en"))+1)
	}
}

func TestInteractiveVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "templates-vectors.json", &vs)
	s := exampleSettings(t)
	n := 0
	for _, v := range vs {
		var in struct {
			Language string
			Slots    []int64
		}
		_ = json.Unmarshal(v.Input, &in)
		switch v.Area {
		case "labels":
			got := map[string]string{}
			for _, k := range []string{"yes", "no", "owner", "cancel", "cancelYes", "keep", "pickService", "pickTime", "paid", "received", "refundSent", "keptForBooking"} {
				got[k] = Label(in.Language, k)
			}
			sameJSON(t, v.Name, v.Output, got)
		case "serviceList":
			sameJSON(t, v.Name, v.Output, ServiceList(s, in.Language))
		case "slotList":
			sameJSON(t, v.Name, v.Output, SlotList(in.Slots, s.Loc, in.Language))
		case "buttons":
			sameJSON(t, v.Name, v.Output, ButtonsFor(in.Language, "yes", "no"))
		default:
			continue
		}
		n++
	}
	if n != 16 {
		t.Fatalf("walked %d cases, want 16", n)
	}
}

// A message whose record lacks a fact is refused with the TypeScript's sentence, naming the first fact missing in reading order.
func TestMissingFactIsRefused(t *testing.T) {
	_, facts := exampleLang(t)
	f := *facts["en"]
	f.ServiceName, f.SlotMs = nil, nil
	_, err := Render("confirm_details", &f)
	if err == nil || err.Error() != `The message needs "serviceName" from the record, and the record does not have it.` {
		t.Fatalf("got %v", err)
	}
	f.ServiceName = S("haircut")
	if _, err = Render("confirm_details", &f); err == nil || !strings.Contains(err.Error(), `"slotMs"`) {
		t.Fatalf("got %v", err)
	}
}

// The English service opens a sentence with a capital, in no other language; the owner's day list has a heading, a row per booking and a line for none.
func TestServiceCapitalAndDayList(t *testing.T) {
	_, facts := exampleLang(t)
	f := *facts["en"]
	f.ServiceName = S("haircut")
	if got, _ := Render("booked", &f); !strings.HasPrefix(got, "You're booked! Haircut, ") {
		t.Errorf("the service does not open the sentence with a capital: %q", got)
	}
	f.Day = "tomorrow"
	if got, _ := Render("owner_day_bookings", &f); got != "No bookings tomorrow." {
		t.Errorf("got %q", got)
	}
	f.DayBookings = []DayBooking{{SlotMs: time.Date(2026, 11, 11, 4, 30, 0, 0, time.UTC).UnixMilli(), ServiceName: "Haircut", CustomerPhone: "+919811111111", Ref: "b-1"}}
	if got, _ := Render("owner_day_bookings", &f); got != "Tomorrow's bookings:\n- 10:00 am: Haircut, +91 98111 11111" {
		t.Errorf("got %q", got)
	}
}

// The check reads dates and times against the booking's own (and a list's free times) and says what the record shows, in the language the wrong one was written in.
func TestCheckNamesTheRecordsMoment(t *testing.T) {
	_, facts := exampleLang(t)
	en := facts["en"]
	got := CheckMessage("Just checking: Haircut on Tue 10 Nov, 7:00 pm?", en)
	if len(got) != 1 || got[0] != `The message says the time "7:00 pm", but the record has 6:00 pm.` {
		t.Errorf("got %v", got)
	}
	got = CheckMessage("मंगलवार, 11 नवंबर", facts["hi"])
	if len(got) != 1 || got[0] != `The message says the date "मंगलवार, 11 नवंबर", but the record has मंगलवार, 10 नवंबर.` {
		t.Errorf("got %v", got)
	}
	f := *en
	f.SlotChoices = []int64{time.Date(2026, 11, 11, 4, 30, 0, 0, time.UTC).UnixMilli()}
	if got = CheckMessage("Wed 11 Nov, 10:00 am", &f); len(got) != 0 {
		t.Errorf("a free time the list offers is allowed, got %v", got)
	}
}
