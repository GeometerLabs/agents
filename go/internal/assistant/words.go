package assistant

// What the assistant says to the owner, in English, Hindi, Malayalam and Kannada. The words are NOT typed here: go/scripts/gen_words.ts renders each message with the real TypeScript
// functions (modules/assistant/words*.ts, modules/listings/words.ts), with `{slots}` where a shop's own value goes, and packs each language into words/<lang>.json.gz, embedded below.
// This file only unpacks a language and fills the slots.
//
// Unpacked on demand and shared: a language is read and decompressed the FIRST time any shop in this process needs it (sync.Once per language, so a process that hosts a thousand
// shops holds at most four copies, and a shop in English never pays for Malayalam). The word lists of the owner's commands (rules.json.gz) are unpacked the same way, and the regular
// expressions made from them are compiled the first time an owner's message is read (rules.go).
//
// The formatters a message needs are here, and small: the rupee grouping (en-IN: 12,34,567), the date (weekday and month names come from the pack), the time of day (24 forms in
// the pack, the day-part words of each hour) and the moment an owner-control alert carries (owner-phones.ts dayAndTime: the month names and 24 forms in the pack). The tests prove
// each of them equal to Node's.

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

//go:embed words/en.json.gz words/hi.json.gz words/ml.json.gz words/kn.json.gz words/rules.json.gz
var packed embed.FS

// Pack is one language's messages.
type Pack struct {
	M   map[string]string `json:"m"`
	Cat map[string]string `json:"cat"`
	// lang is the pack's language: dates and times are written by language.Formats, the one table the Go runtimes share (formats.json)
	lang string
	// Stamp is owner-phones.ts dayAndTime as data: the months' short names, and per hour the whole moment with {d}, {mon} and {mm} slots (gen_words.ts stampOf)
	Stamp struct {
		Months []string          `json:"months"`
		Hours  map[string]string `json:"hours"`
	} `json:"stamp"`
}

type slot struct {
	once sync.Once
	pack *Pack
}

var packs = map[string]*slot{"en": {}, "hi": {}, "ml": {}, "kn": {}}

func gunzip(name string) []byte {
	f, err := packed.Open("words/" + name)
	if err != nil {
		panic("the packed words are missing: " + name) // the files are embedded at build time; their absence is a build fault
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		panic("the packed words are not gzip: " + name)
	}
	b, err := io.ReadAll(z)
	if err != nil {
		panic("the packed words cannot be read: " + name)
	}
	return b
}

// Words is the pack of a language (English for a language it does not know). Safe for many shops at once.
func Words(lang string) *Pack {
	s, ok := packs[lang]
	if !ok {
		s = packs["en"]
	}
	s.once.Do(func() {
		p := &Pack{lang: strings.TrimSuffix(lang2file(lang), ".json.gz")}
		if err := json.Unmarshal(gunzip(lang2file(lang)), p); err != nil {
			panic("the packed words are not JSON: " + lang)
		}
		s.pack = p
	})
	return s.pack
}

func lang2file(lang string) string {
	if _, ok := packs[lang]; !ok {
		lang = "en"
	}
	return lang + ".json.gz"
}

// Loaded says which languages have been unpacked in this process (a test and the memory report read it).
func Loaded() []string {
	var out []string
	for _, l := range []string{"en", "hi", "ml", "kn"} {
		if packs[l].pack != nil {
			out = append(out, l)
		}
	}
	return out
}

// Say fills a message's slots. `vals` are name, value pairs: Say("refusal.no_case", "ref", "b-14"). A slot with no value is left as it is, so a missing value shows in a test, not as a blank.
func (p *Pack) Say(key string, vals ...string) string {
	t, ok := p.M[key]
	if !ok {
		panic("no such message: " + key) // a key the generator did not write is a programming error, found by the tests
	}
	if len(vals) == 0 {
		return t
	}
	return strings.NewReplacer(slotPairs(vals)...).Replace(t)
}

func slotPairs(vals []string) []string {
	out := make([]string, 0, len(vals))
	for i := 0; i+1 < len(vals); i += 2 {
		out = append(out, "{"+vals[i]+"}", vals[i+1])
	}
	return out
}

// Has is whether the pack has a message.
func (p *Pack) Has(key string) bool { _, ok := p.M[key]; return ok }

// INR is format.ts formatInr over paise, as the TypeScript callers write it (formatInr(paise / 100)): language.FormatInr, the one rupee text.
func INR(paise int64) string { return language.FormatInr(float64(paise) / 100) }

// DateText is format.ts formatDate: "Wed 18 Nov", or "बुधवार, 18 नवंबर".
func (p *Pack) DateText(year, month, day int) string { return language.Formats(p.lang).Date(year, month, day) }

// TimeOfDay is format.ts formatTime: "6:05 pm", "शाम 6:05 बजे".
func (p *Pack) TimeOfDay(hour, minute int) string { return language.Formats(p.lang).TimeOfDay(hour, minute) }

// india is India's time, the one owner-phones.ts writes every moment in (Asia/Kolkata has had no summer time since 1945, so a fixed zone is the same zone and needs no tz database).
var india = time.FixedZone("IST", 5*3600+30*60)

// Moment is owner-phones.ts dayAndTime: "28 Nov, 3:29 pm", in India's time, as an owner-control alert carries it.
func (p *Pack) Moment(ms int64) string {
	t := time.UnixMilli(ms).In(india)
	mm := strconv.Itoa(t.Minute())
	if t.Minute() < 10 {
		mm = "0" + mm
	}
	return strings.NewReplacer("{d}", strconv.Itoa(t.Day()), "{mon}", p.Stamp.Months[t.Month()-1], "{mm}", mm).Replace(p.Stamp.Hours[strconv.Itoa(t.Hour())])
}

// OwnerAlert is the push alert of an owner-control notice, word for word TypeScript's (gen_words.ts renders them): "new_phone", "codes_made" and "phone_removed" carry the moment
// and the phone's coarse label (owner-phones.ts NEW_PHONE_ALERT, CODES_ALERT, REMOVED_ALERT); "removal_asked" names who asked, "Your Operator" when nobody is named, and
// "owner_change_asked" says nothing the Operator typed (owner-signin.ts REMOVAL_ALERT, OWNER_CHANGE_ALERT).
func (p *Pack) OwnerAlert(what string, at int64, label, by string) string {
	switch what {
	case "new_phone", "codes_made", "phone_removed":
		if label != "" {
			return p.Say("alert."+what+".label", "at", p.Moment(at), "label", label)
		}
		return p.Say("alert."+what, "at", p.Moment(at))
	case "removal_asked":
		if by != "" {
			return p.Say("alert.removal_asked.by", "by", by)
		}
		return p.Say("alert.removal_asked")
	}
	return p.Say("alert." + what)
}

// Category is the name of a category in this language ("Pets"); an unknown category is shown as it is.
func (p *Pack) Category(c string) string {
	if n, ok := p.Cat[c]; ok {
		return n
	}
	return c
}

// ---- the rules' word lists --------------------------------------------------------------------------------------------------------------------------------

// RuleWords are the lists the owner's memory and leave words are read from (modules/assistant/intents-memory.ts, intents-leave.ts), taken from the TypeScript source by the
// generator. The kinds' and the dates' patterns are not here: they are the TypeScript's built patterns themselves (internal/language, patterns.json).
type RuleWords struct {
	LeaveFile      []string `json:"leaveFile"`
	LeaveOperator  []string `json:"leaveOperator"`
	Remember, List []string
	// Router is the router's reading for this shop's kinds (intents.ts ownerReading): the language model's prompt and schema, the decision model's question.
	Router struct {
		Prompt       string         `json:"prompt"`
		Schema       map[string]any `json:"schema"`
		Instructions string         `json:"instructions"`
		Criteria     [][2]string    `json:"criteria"`
	} `json:"router"`
	// TalkSchema is the owner's talk's answer schema (talk-prompt.ts ownerPrompt with no limits).
	TalkSchema map[string]any `json:"talkSchema"`
}

var (
	rulesOnce  sync.Once
	rulesWords *RuleWords
)

// Rules is the rules' word lists, unpacked the first time they are needed.
func Rules() *RuleWords {
	rulesOnce.Do(func() {
		rulesWords = &RuleWords{}
		if err := json.NewDecoder(bytes.NewReader(gunzip("rules.json.gz"))).Decode(rulesWords); err != nil {
			panic("the packed rules are not JSON")
		}
	})
	return rulesWords
}
