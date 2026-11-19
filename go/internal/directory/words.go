// The words, the style sheet, the script, the MCP tool definitions, the Agent Card and the assistant's prompt the directory serves. Two kinds of source:
//
//   - GENERATED from the TypeScript that is still the source (scripts/gen_directory.ts, into words/pack.json.gz, unpacked once per process): the page's words in four languages and the
//     language names (modules/discovery/words.ts, which the review sheet bundle/panel/review.ts also reads), the shops' own style sheet (modules/channels/look.ts CUSTOMER_CSS), the
//     shops' paints the kinds' tiles use (modules/channels/chat-paint.ts PAINTS), the MCP versions (modules/channels/mcp.ts) and the font. modules/discovery/contract/words-fresh.test.ts
//     fails when the committed pack is older than those files. A line of the TypeScript words that is a function (a plural, a name put into a sentence) is stored as templates with
//     `{n}`, `{town}` ... slots, one per plural form, which the generator proved equal to the real function for every n from 0 to 1000.
//   - GO SOURCE since the TypeScript directory was deleted (19 Nov 2026, decision 61 wave 1c; each was cut out of what the TypeScript made, byte for byte): words/page.css (the page's own
//     style, with {{shops}} and {{kinds}} slots), words/script.js, words/mcp.json, words/cards.json, words/assistant.json. Their leading comment (CSS, JS) or "about" member (JSON) is
//     not served.
package directory

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"sync"
)

//go:embed words/pack.json.gz words/baloo-2-latin-wght-normal.woff2 words/page.css words/script.js words/mcp.json words/cards.json words/assistant.json
var packFS embed.FS

// pack is what the directory serves that is text, once put together.
type pack struct {
	// generated (pack.json.gz)
	Langs         []string
	Categories    []string
	LanguageLabel map[string]string
	Words         map[string]map[string]json.RawMessage
	ShopCSS       string
	Paints        map[string]struct{ Hex, Ink string }
	MCPVersions   []string
	// Go source, and what is made of it
	Style, Script string
	MCP           struct {
		Versions []string
		Tools    []json.RawMessage
		AskTool  json.RawMessage
	}
	Cards     map[string]json.RawMessage
	Assistant struct {
		System string
		Schema json.RawMessage
		Name   string
	}
}

// kindPaints is the paint of each kind's flat tile (a card with no photo), in the order the style sheet lists them; "" is the plain tile (it was page.ts KIND_PAINT). No new colours:
// the paints are the five Streetlist's own shops wear, each with the one text colour that reads on it at AA.
var kindPaints = [][2]string{{"pets", "marigold"}, {"food", "green"}, {"clothes", "pink"}, {"home", "blue"}, {"electronics", "blue"}, {"vehicles_and_cycles", "brick"}, {"services", "green"}, {"other", ""}}

// kindTiles is the CSS of the kinds' tiles over the shops' paints.
func kindTiles(paints map[string]struct{ Hex, Ink string }) string {
	var b strings.Builder
	for _, k := range kindPaints {
		if p, ok := paints[k[1]]; ok {
			b.WriteString(".k-" + k[0] + "{--k:" + p.Hex + ";--ki:" + p.Ink + "}")
		} else {
			b.WriteString(".k-" + k[0] + "{--k:var(--plain-bg);--ki:var(--ink)}")
		}
	}
	return b.String()
}

// source is an embedded Go-source file without its leading comment (CSS and JavaScript: one /* ... */ block and the line break after it).
func source(name string) string {
	b, err := packFS.ReadFile(name)
	if err != nil {
		panic(err)
	}
	s := string(b)
	if strings.HasPrefix(s, "/*") {
		if end := strings.Index(s, "*/\n"); end >= 0 {
			s = s[end+3:]
		}
	}
	return s
}

// sourceJSON decodes an embedded JSON source file (its "about" member is ignored).
func sourceJSON(name string, into any) {
	b, err := packFS.ReadFile(name)
	if err != nil || json.Unmarshal(b, into) != nil {
		panic("the directory's " + name + " cannot be read")
	}
}

var (
	packOnce sync.Once
	packData pack
	words    = map[string]*Words{}
)

func loadPack() *pack {
	packOnce.Do(func() {
		raw, err := packFS.ReadFile("words/pack.json.gz")
		if err != nil {
			panic(err)
		}
		zr, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			panic(err)
		}
		text, err := io.ReadAll(zr)
		if err != nil || json.Unmarshal(text, &packData) != nil {
			panic("the directory's packed words cannot be read")
		}
		packData.Style = strings.NewReplacer("{{shops}}", packData.ShopCSS, "{{kinds}}", kindTiles(packData.Paints)).Replace(source("words/page.css"))
		packData.Script = source("words/script.js")
		sourceJSON("words/mcp.json", &packData.MCP)
		packData.MCP.Versions = packData.MCPVersions
		var cards struct{ Cards map[string]json.RawMessage }
		sourceJSON("words/cards.json", &cards)
		packData.Cards = cards.Cards
		sourceJSON("words/assistant.json", &packData.Assistant)
		for lang, m := range packData.Words {
			w := &Words{s: map[string]string{}, l: map[string][]string{}, k: map[string]map[string]string{}, f: map[string]map[string]map[string]string{}}
			for key, v := range m {
				var s string
				var l []string
				var k map[string]string
				var f struct {
					Fn map[string]map[string]string `json:"fn"`
				}
				switch {
				case json.Unmarshal(v, &s) == nil:
					w.s[key] = s
				case json.Unmarshal(v, &l) == nil:
					w.l[key] = l
				case json.Unmarshal(v, &f) == nil && f.Fn != nil:
					w.f[key] = f.Fn
				case json.Unmarshal(v, &k) == nil:
					w.k[key] = k
				}
			}
			words[lang] = w
		}
	})
	return &packData
}

// Words is one language's lines.
type Words struct {
	s map[string]string
	l map[string][]string
	k map[string]map[string]string
	f map[string]map[string]map[string]string
}

// WordsFor is the words of a language (English for one we do not have).
func WordsIn(lang string) *Words {
	loadPack()
	if w, ok := words[lang]; ok {
		return w
	}
	return words["en"]
}

// S is a plain line; List a list of lines; Map a record of lines (the kinds).
func (w *Words) S(key string) string              { return w.s[key] }
func (w *Words) List(key string) []string         { return w.l[key] }
func (w *Words) Map(key string) map[string]string { return w.k[key] }

// Fn is a line that takes values. n is the count (or -1 for a line with none), flags says which nullable values are given ("town,km", sorted) and args are the values by slot name.
func (w *Words) Fn(key string, n int, flags string, args map[string]string) string {
	variant := w.f[key][flags]
	bucket := ""
	if n >= 0 {
		bucket = "*"
		if n <= 3 {
			bucket = strconv.Itoa(n)
		}
	}
	t := variant[bucket]
	pairs := make([]string, 0, 2*len(args)+2)
	if n >= 0 {
		pairs = append(pairs, "{n}", strconv.Itoa(n))
	}
	for name, v := range args {
		pairs = append(pairs, "{"+name+"}", v)
	}
	return strings.NewReplacer(pairs...).Replace(t)
}

// LanguageLabel is a language's name in its own script.
func LanguageLabel(l string) string { return loadPack().LanguageLabel[l] }

// FontBytes is the page's one font.
func FontBytes() []byte {
	b, _ := packFS.ReadFile("words/baloo-2-latin-wght-normal.woff2")
	return b
}
