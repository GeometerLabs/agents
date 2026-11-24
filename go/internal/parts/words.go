package parts

// The shop's own words (not any part's): what each kind of part is called and the router's one question, GENERATED from templates/commerce/parts/src/words.ts by
// go/scripts/gen_parts_words.ts into words.json. `question` joins the names the way words.ts does ("a, b or c" with each language's own "or"); words_test.go holds it to the
// TypeScript's own output, carried in the same file.

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/fees"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/orders"
)

//go:embed words.json
var wordsJSON []byte

type partNames struct {
	Owner          string `json:"owner"`
	Customer       string `json:"customer"`
	Button         string `json:"button"`
	CustomerButton string `json:"customerButton"`
}

type questionWords struct {
	Owner    string `json:"owner"`
	Customer string `json:"customer"`
	Or       string `json:"or"`
}

type wordsFile struct {
	Names    map[string]map[string]partNames `json:"names"`
	Question map[string]questionWords        `json:"question"`
	Vectors  []struct {
		Language string   `json:"language"`
		To       string   `json:"to"`
		Names    []string `json:"names"`
		Text     string   `json:"text"`
	} `json:"vectors"`
}

var (
	wordsOnce sync.Once
	words     wordsFile
)

func loadWords() *wordsFile {
	wordsOnce.Do(func() {
		if err := json.Unmarshal(wordsJSON, &words); err != nil {
			panic("internal/parts words.json cannot be read: " + err.Error())
		}
	})
	return &words
}

// kindOf is the kind of part a part is, for its names: the credit book is a Fees part with a credit book, the pickup hold an Orders part that takes no advance.
func kindOf(p *Part) string {
	switch o := p.Own.(type) {
	case *fees.Settings:
		if o.Credit != nil {
			return "credit"
		}
		return "fees"
	case *orders.Settings:
		if o.NoAdvance() {
			return "hold"
		}
		return "orders"
	}
	return p.Name
}

// namesOf is a part's names in a language (English when the language has none).
func namesOf(p *Part, lang string) partNames {
	w := loadWords()
	byLang := w.Names[kindOf(p)]
	if n, ok := byLang[lang]; ok {
		return n
	}
	return byLang["en"]
}

// question is words.ts `question`: the question to the owner or a customer with the names put in.
func question(lang, to string, names []string) string {
	w := loadWords()
	q, ok := w.Question[lang]
	if !ok {
		q = w.Question["en"]
	}
	list := strings.Join(names, "")
	if len(names) >= 2 {
		list = strings.Join(names[:len(names)-1], ", ") + q.Or + names[len(names)-1]
	}
	text := q.Owner
	if to == "customer" {
		text = q.Customer
	}
	return strings.Replace(text, "{parts}", list, 1)
}

// answerIn: the owner's (or the customer's) answer names one of the parts asked about, by any of its names in any language, or by the button they tapped; "" when it names
// none or more than one.
func answerIn(text, replyID string, parts []*Part) string {
	if strings.HasPrefix(replyID, answerButton) {
		name := strings.TrimPrefix(replyID, answerButton)
		for _, p := range parts {
			if p.Name == name {
				return name
			}
		}
		return ""
	}
	said := language.LowerJS(language.Plain(text))
	found := ""
	for _, p := range parts {
		hit := false
		for _, n := range loadWords().Names[kindOf(p)] {
			for _, s := range []string{n.Owner, n.Customer, n.Button, n.CustomerButton} {
				if s != "" && strings.Contains(said, language.LowerJS(language.Plain(s))) {
					hit = true
				}
			}
		}
		if hit {
			if found != "" {
				return ""
			}
			found = p.Name
		}
	}
	return found
}

// answerButton is the reply button's id: "part:" and the part's name.
const answerButton = "part:"
