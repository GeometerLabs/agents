package assistant

// What the assistant says to the owner, in English, Hindi, Malayalam and Kannada. The words are NOT typed here: go/scripts/gen_words.ts renders each message with the real TypeScript
// functions (modules/assistant/words*.ts, modules/listings/words.ts), with `{slots}` where a shop's own value goes, and packs each language into words/<lang>.json.gz, embedded below.
// This file only unpacks a language and fills the slots.
//
// Unpacked on demand and shared: a language is read and decompressed the FIRST time any shop in this process needs it (sync.Once per language, so a process that hosts a thousand
// shops holds at most four copies, and a shop in English never pays for Malayalam). The word lists of the owner's commands (rules.json.gz) are unpacked the same way, and the regular
// expressions made from them are compiled the first time an owner's message is read (rules.go).
//
// The formatters a message needs are here, and small: the rupee grouping (en-IN: 12,34,567), the date (weekday and month names come from the pack) and the time of day (24 forms in
// the pack, the day-part words of each hour). The tests prove each of them equal to Node's.

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
)

//go:embed words/en.json.gz words/hi.json.gz words/ml.json.gz words/kn.json.gz words/rules.json.gz
var packed embed.FS

// Pack is one language's messages.
type Pack struct {
	M    map[string]string `json:"m"`
	Date struct {
		Weekdays []string `json:"weekdays"`
		Months   []string `json:"months"`
		Comma    bool     `json:"comma"`
	} `json:"date"`
	Time map[string]string `json:"time"`
	Cat  map[string]string `json:"cat"`
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
		p := &Pack{}
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

// INR is formatters.ts formatInr over paise: "₹8,000", "₹120.5", "₹12,34,567" (JavaScript's toLocaleString("en-IN"): the last three digits, then pairs; up to two decimals, trailing zeros dropped).
func INR(paise int64) string {
	neg := paise < 0
	if neg {
		paise = -paise
	}
	whole, frac := paise/100, paise%100
	s := strconv.FormatInt(whole, 10)
	if len(s) > 3 {
		head, tail := s[:len(s)-3], s[len(s)-3:]
		var groups []string
		for len(head) > 2 {
			groups = append([]string{head[len(head)-2:]}, groups...)
			head = head[:len(head)-2]
		}
		if head != "" {
			groups = append([]string{head}, groups...)
		}
		s = strings.Join(groups, ",") + "," + tail
	}
	if frac != 0 {
		f := strconv.FormatInt(frac+100, 10)[1:]
		s += "." + strings.TrimRight(f, "0")
	}
	if neg {
		s = "-" + s
	}
	return "₹" + s
}

// DateText is formatters.ts formatDate: "Wed 18 Nov", or "बुधवार, 18 नवंबर" (a comma after the weekday in the other languages).
func (p *Pack) DateText(year, month, day int) string {
	wd := time.Date(year, time.Month(month), day, 12, 0, 0, 0, time.UTC).Weekday()
	comma := ""
	if p.Date.Comma {
		comma = ","
	}
	return p.Date.Weekdays[wd] + comma + " " + strconv.Itoa(day) + " " + p.Date.Months[month-1]
}

// TimeOfDay is formatters.ts formatTime: "6:05 pm", "शाम 6:05 बजे".
func (p *Pack) TimeOfDay(hour, minute int) string {
	mm := strconv.Itoa(minute)
	if minute < 10 {
		mm = "0" + mm
	}
	return strings.Replace(p.Time[strconv.Itoa(hour)], "{mm}", mm, 1)
}

// Category is the name of a category in this language ("Pets"); an unknown category is shown as it is.
func (p *Pack) Category(c string) string {
	if n, ok := p.Cat[c]; ok {
		return n
	}
	return c
}

// ---- the rules' word lists --------------------------------------------------------------------------------------------------------------------------------

// RuleWords are the lists the owner's commands are read from (modules/assistant/intents*.ts), taken from the TypeScript source by the generator.
type RuleWords struct {
	Kinds          [][]json.RawMessage `json:"kinds"` // each [kind, [words...]]
	LeaveFile      []string            `json:"leaveFile"`
	LeaveOperator  []string            `json:"leaveOperator"`
	Remember, List []string
	Dates          struct{ Today, Tomorrow, DayAfter, Yesterday, Weekdays, Months []string }
}

var (
	rulesOnce  sync.Once
	rulesWords *RuleWords
)

// Rules is the rules' word lists, unpacked the first time they are needed.
func Rules() *RuleWords {
	rulesOnce.Do(func() {
		var raw struct {
			Kinds         [][]json.RawMessage `json:"kinds"`
			LeaveFile     []string            `json:"leaveFile"`
			LeaveOperator []string            `json:"leaveOperator"`
			Remember      []string            `json:"remember"`
			List          []string            `json:"list"`
			Dates         struct {
				Today, Tomorrow, DayAfter, Yesterday, Weekdays, Months []string
			} `json:"dates"`
		}
		if err := json.NewDecoder(bytes.NewReader(gunzip("rules.json.gz"))).Decode(&raw); err != nil {
			panic("the packed rules are not JSON")
		}
		rulesWords = &RuleWords{Kinds: raw.Kinds, LeaveFile: raw.LeaveFile, LeaveOperator: raw.LeaveOperator, Remember: raw.Remember, List: raw.List}
		rulesWords.Dates = raw.Dates
	})
	return rulesWords
}
