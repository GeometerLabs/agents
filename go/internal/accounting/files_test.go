// The accountant's files (journal, documents and settlements CSVs, the README, the two Tally files) of each recorded shop, for every month and year it has, with and without Tally, with Tally's
// own company and ledger names (and two that must be refused), with and without the old-due marks, in other time zones, and for periods that are not periods: compared byte for byte with what
// the TypeScript wrote (testdata/files-*.json), thrown sentences included. Also the small helpers (XML escaping, CSV fields, rupees, formatPaise, yesterday, makeDocument) in testdata/misc.json.
package accounting

import (
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"testing"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type fileOut struct {
	Value []ExportFile `json:"value"`
	Error *string      `json:"error"`
}

type tallySpec struct {
	Company     string            `json:"company"`
	LedgerNames map[string]string `json:"ledgerNames"`
	OldDueOf    map[string]string `json:"oldDueOf"`
}

func (s *tallySpec) options() *TallyOptions {
	if s == nil {
		return nil
	}
	o := TallyOptions{Company: s.Company, LedgerNames: s.LedgerNames}
	if s.OldDueOf != nil {
		m := s.OldDueOf
		o.OldDueOf = func(e Entry) string { return m[strconv.Itoa(e.Seq)] }
	}
	return &o
}

func compareFiles(t *testing.T, what string, got []ExportFile, err error, want fileOut) {
	t.Helper()
	if want.Error != nil {
		if err == nil || err.Error() != *want.Error {
			t.Errorf("%s: go error %v, ts error %q", what, err, *want.Error)
		}
		return
	}
	if err != nil {
		t.Errorf("%s: go error %v, ts made %d files", what, err, len(want.Value))
		return
	}
	if len(got) != len(want.Value) {
		t.Errorf("%s: %d files, ts %d", what, len(got), len(want.Value))
		return
	}
	for i := range got {
		if got[i].Name != want.Value[i].Name {
			t.Errorf("%s: file %d is %s, ts %s", what, i, got[i].Name, want.Value[i].Name)
		} else if got[i].Content != want.Value[i].Content {
			t.Errorf("%s: %s differs from the TypeScript's:\n go %q\n ts %q", what, got[i].Name, got[i].Content, want.Value[i].Content)
		}
	}
}

func TestAccountantFiles(t *testing.T) {
	for _, name := range worldNames {
		t.Run(name, func(t *testing.T) {
			w := loadWorld(t, name)
			var f struct {
				Tallies []struct {
					Name  string     `json:"name"`
					Tally *tallySpec `json:"tally"`
				} `json:"tallies"`
				Out []struct {
					Period string  `json:"period"`
					Tally  string  `json:"tally"`
					OldDue bool    `json:"oldDue"`
					Out    fileOut `json:"out"`
				} `json:"out"`
				OtherZone []struct {
					Period string  `json:"period"`
					TZ     string  `json:"tz"`
					Out    fileOut `json:"out"`
				} `json:"otherZone"`
			}
			loadVec(t, "files-"+name, &f)
			j := BuildJournal(w.Entries, w.Def.Legacy)
			specs := map[string]*tallySpec{}
			for _, t := range f.Tallies {
				specs[t.Name] = t.Tally
			}
			oldDue := func(e Entry) string { return w.Def.OldDue[strconv.Itoa(e.Seq)] }
			for _, c := range f.Out {
				in := ExportInput{Journal: j, Entries: w.Entries, Period: c.Period, TimeZone: w.Def.Timezone, Tally: specs[c.Tally].options()}
				if c.OldDue {
					in.OldDueOf = oldDue
				}
				got, err := AccountantFiles(in)
				compareFiles(t, "period "+c.Period+" tally "+c.Tally+" oldDue "+strconv.FormatBool(c.OldDue), got, err, c.Out)
			}
			for _, c := range f.OtherZone {
				got, err := AccountantFiles(ExportInput{Journal: j, Entries: w.Entries, Period: c.Period, TimeZone: c.TZ})
				compareFiles(t, "period "+c.Period+" in "+c.TZ, got, err, c.Out)
			}
			if len(f.Out) == 0 {
				t.Error("no files in the vectors")
			}
		})
	}
}

func TestMisc(t *testing.T) {
	var m struct {
		Collation struct {
			IDs    []string `json:"ids"`
			Sorted []string `json:"sorted"`
		} `json:"collation"`
		XML    []struct{ Text, Out string } `json:"xml"`
		CSV    []struct{ Text, Out string } `json:"csv"`
		Rupees []struct {
			Paise int64           `json:"paise"`
			Out   outcome[string] `json:"out"`
		} `json:"rupees"`
		FormatPaise []struct {
			Paise int64           `json:"paise"`
			Out   outcome[string] `json:"out"`
		} `json:"formatPaise"`
		Yesterdays []struct {
			TZ  string          `json:"tz"`
			Ms  int64           `json:"ms"`
			Out json.RawMessage `json:"out"`
		} `json:"yesterdays"`
		DocMisc []struct {
			Status   string `json:"status"`
			Language string `json:"language"`
			Docs     []struct {
				Doc json.RawMessage `json:"doc"`
				Out json.RawMessage `json:"out"`
			} `json:"docs"`
		} `json:"docMisc"`
	}
	loadVec(t, "misc", &m)
	// the order the settlements sheet and the obligations sort by (JavaScript's localeCompare): collate with the English tailoring gives the order Node's ICU gives
	ids := append([]string(nil), m.Collation.IDs...)
	coll := collate.New(language.English)
	sort.SliceStable(ids, func(a, b int) bool { return coll.CompareString(ids[a], ids[b]) < 0 })
	if !reflect.DeepEqual(ids, m.Collation.Sorted) {
		t.Errorf("collate order differs from localeCompare:\n go %q\n ts %q", ids, m.Collation.Sorted)
	}
	for _, c := range m.XML {
		if got := XML(c.Text); got != c.Out {
			t.Errorf("XML(%q) = %q, ts %q", c.Text, got, c.Out)
		}
	}
	for _, c := range m.CSV {
		if got := CSVField(c.Text); got != c.Out {
			t.Errorf("CSVField(%q) = %q, ts %q", c.Text, got, c.Out)
		}
	}
	check := func(what string, p int64, got string, err error, want outcome[string]) {
		switch {
		case want.Error != nil && (err == nil || err.Error() != *want.Error):
			t.Errorf("%s(%d) = %q, %v; ts error %q", what, p, got, err, *want.Error)
		case want.Value != nil && (err != nil || got != *want.Value):
			t.Errorf("%s(%d) = %q, %v; ts %q", what, p, got, err, *want.Value)
		}
	}
	for _, c := range m.Rupees {
		got, err := Rupees(c.Paise)
		check("Rupees", c.Paise, got, err, c.Out)
	}
	for _, c := range m.FormatPaise {
		got, err := FormatPaise(c.Paise)
		check("FormatPaise", c.Paise, got, err, c.Out)
	}
	for _, c := range m.Yesterdays {
		d := YesterdayOf(c.Ms, c.TZ)
		sameJSON(t, "YesterdayOf", map[string]int{"year": d.Year, "month": d.Month, "day": d.Day}, c.Out)
	}
	whatFor := func(caseID, language string) string { return "Haircut for <" + caseID + "> & more (" + language + ")" }
	people := map[string]string{"b-1": "Anita Sharma <A&B>", "b-3": "Ravi \"R\" Kumar", "f-1": "Meera", "f-3": "Kavya's mother"}
	for _, o := range m.DocMisc {
		var all []DocRef
		for _, d := range o.Docs {
			var ref DocRef
			json.Unmarshal(d.Doc, &ref)
			all = append(all, ref)
		}
		for i, d := range o.Docs {
			shop := DocumentShop{Name: "Anita's <Salon> & \"Spa\"", Address: "12 MG Road, Kochi\n682001", Phone: "+91 98765 43210", Timezone: "Asia/Kolkata", Status: TaxStatus(o.Status)}
			got := MakeDocument(DocumentInput{Doc: all[i], Documents: all, Shop: shop, Language: o.Language, WhatFor: whatFor, Person: func(c string) string { return people[c] }})
			sameJSON(t, "makeDocument "+all[i].Number, got, d.Out)
		}
	}
}
