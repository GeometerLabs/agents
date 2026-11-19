// The HTML of the books (the owner's Money section, the report's "Money this month" block, the customer's document page) compared with what the TypeScript wrote, byte for byte, in four
// languages, with and without download links, with a shop whose name is markup and a link whose address has a quote (testdata/pages-*.json). The style sheets are in the page vectors as a
// placeholder ({{CSS}}) so the files stay small: the Go page must carry the real ones, which are the TypeScript's own (words/words.json.gz, held fresh by its generator's test).
package render

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
)

var worldNames = []string{"bookings", "composition", "settlements", "fees", "legacy", "malformed", "fyend"}

func load(t *testing.T, name string, out any) {
	t.Helper()
	b, err := os.ReadFile("../testdata/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

type world struct {
	Def struct {
		Timezone string               `json:"timezone"`
		Status   *string              `json:"status"`
		Legacy   accounting.LegacyMap `json:"legacy"`
	} `json:"def"`
	Entries []accounting.Entry `json:"entries"`
	Views   []struct {
		Key  string               `json:"key"`
		View accounting.MoneyView `json:"view"`
	} `json:"views"`
	Summaries []struct {
		Name    string                       `json:"name"`
		Summary accounting.AccountingSummary `json:"summary"`
	} `json:"summaries"`
}

var whatFor = func(caseID, language string) string { return "Haircut for <" + caseID + "> & more (" + language + ")" }
var people = map[string]string{"b-1": "Anita Sharma <A&B>", "b-3": "Ravi \"R\" Kumar", "f-1": "Meera", "f-3": "Kavya's mother"}
var person = func(c string) string { return people[c] }

func TestPages(t *testing.T) {
	css := accounting.CustomerCSS() + accounting.DocCSS()
	if len(accounting.CustomerCSS()) < 1000 || len(accounting.DocCSS()) < 500 {
		t.Fatalf("the style sheets did not load (%d, %d)", len(accounting.CustomerCSS()), len(accounting.DocCSS()))
	}
	for _, name := range worldNames {
		t.Run(name, func(t *testing.T) {
			var w world
			load(t, "world-"+name, &w)
			var p struct {
				Sections []struct {
					View  string       `json:"view"`
					Lang  string       `json:"lang"`
					Links *ExportLinks `json:"links"`
					HTML  string       `json:"html"`
				} `json:"sections"`
				Blocks []struct {
					Range   string `json:"range"`
					Lang    string `json:"lang"`
					Options struct {
						ToCome    bool                  `json:"toCome"`
						BooksOnly *accounting.BooksOnly `json:"booksOnly"`
					} `json:"options"`
					HTML string `json:"html"`
				} `json:"blocks"`
				Pages []struct {
					Number   string              `json:"number"`
					Status   string              `json:"status"`
					Lang     string              `json:"lang"`
					Document accounting.Document `json:"document"`
					HTML     string              `json:"html"`
				} `json:"pages"`
				CaseDocs []struct {
					Cases      []string              `json:"cases"`
					Lang       string                `json:"lang"`
					WithPerson bool                  `json:"withPerson"`
					Out        []accounting.Document `json:"out"`
				} `json:"caseDocs"`
			}
			load(t, "pages-"+name, &p)
			for _, s := range p.Sections {
				var view accounting.MoneyView
				for _, v := range w.Views {
					if v.Key == s.View {
						view = v.View
					}
				}
				got := OwnerMoneySection(view, s.Lang, s.Links, w.Def.Timezone)
				if got != s.HTML {
					t.Errorf("section %s %s links %+v differs:\n go %q\n ts %q", s.View, s.Lang, s.Links, got, s.HTML)
				}
			}
			for _, b := range p.Blocks {
				var sum accounting.AccountingSummary
				for _, s := range w.Summaries {
					if s.Name == b.Range {
						sum = s.Summary
					}
				}
				got := MoneyBlock(sum, accounting.BlockWords(b.Lang), BlockOptions{ToCome: b.Options.ToCome, BooksOnly: b.Options.BooksOnly})
				if got != b.HTML {
					t.Errorf("block %s %s %+v differs:\n go %q\n ts %q", b.Range, b.Lang, b.Options, got, b.HTML)
				}
			}
			j := accounting.BuildJournal(w.Entries, w.Def.Legacy)
			shopFor := func(status string) accounting.DocumentShop {
				return accounting.DocumentShop{Name: "Anita's <Salon> & \"Spa\"", Address: "12 MG Road, Kochi\n682001", Phone: "+91 98765 43210", Timezone: w.Def.Timezone, Status: accounting.TaxStatus(status)}
			}
			for _, pg := range p.Pages {
				var doc accounting.DocRef
				for _, d := range j.Documents {
					if d.Number == pg.Number && d.At == pg.Document.At {
						doc = d
					}
				}
				d := accounting.MakeDocument(accounting.DocumentInput{Doc: doc, Documents: j.Documents, Shop: shopFor(pg.Status), Language: pg.Lang, WhatFor: whatFor, Person: person})
				a, _ := json.Marshal(d)
				b, _ := json.Marshal(pg.Document)
				if string(a) != string(b) {
					t.Errorf("document %s %s %s:\n go %s\n ts %s", pg.Number, pg.Status, pg.Lang, a, b)
				}
				got, err := DocumentPage(d)
				if err != nil {
					t.Errorf("document page %s: %v", pg.Number, err)
				}
				if want := strings.Replace(pg.HTML, "{{CSS}}", css, 1); got != want {
					t.Errorf("page %s %s %s differs:\n go %q\n ts %q", pg.Number, pg.Status, pg.Lang, got, want)
				}
			}
			for _, c := range p.CaseDocs {
				status := ""
				if w.Def.Status != nil {
					status = *w.Def.Status
				}
				var pf func(string) string
				if c.WithPerson {
					pf = person
				}
				got := accounting.CaseDocuments(j, c.Cases, shopFor(status), c.Lang, whatFor, pf)
				a, _ := json.Marshal(got)
				b, _ := json.Marshal(c.Out)
				if string(a) != string(b) {
					t.Errorf("caseDocuments %v %s:\n go %s\n ts %s", c.Cases, c.Lang, a, b)
				}
			}
		})
	}
}

func TestEncodeURIComponent(t *testing.T) {
	for in, want := range map[string]string{"abc-_.!~*'()": "abc-_.!~*'()", "a b": "a%20b", "My shop's accounts for November 2026": "My%20shop's%20accounts%20for%20November%202026", "é ക": "%C3%A9%20%E0%B4%95", "a&b=c/d?e#f": "a%26b%3Dc%2Fd%3Fe%23f", "": ""} {
		if got := encodeURIComponent(in); got != want {
			t.Errorf("encodeURIComponent(%q) = %q, want %q", in, got, want)
		}
	}
}
