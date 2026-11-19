// The words, the style sheet, the script, the MCP tool definitions, the Agent Card and the assistant's prompt the directory serves, as the TypeScript directory has them. All of it is
// GENERATED from the TypeScript by scripts/gen_directory.ts into words/pack.json.gz (one gzip file, embedded, unpacked once per process): nothing the visitor reads is typed twice, and
// words_fresh_test.go fails when the committed pack is older than the TypeScript. A line of the TypeScript words that is a function (a plural, a name put into a sentence) is stored as
// templates with `{n}`, `{town}` ... slots, one per plural form, which the generator proved equal to the real function for every n from 0 to 1000.
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

//go:embed words/pack.json.gz words/baloo-2-latin-wght-normal.woff2
var packFS embed.FS

type pack struct {
	Langs         []string
	Categories    []string
	LanguageLabel map[string]string
	Words         map[string]map[string]json.RawMessage
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
