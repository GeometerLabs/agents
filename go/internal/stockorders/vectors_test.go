package stockorders

// The Stock orders vectors (testdata/vectors.json, made by go/scripts/gen_stockorders_vectors.ts by RUNNING the TypeScript): every message in four languages from real facts must
// be written here exactly as render writes it and pass the outgoing check as it does there; every message must go out as the same WhatsApp template (or the generic name) with the same
// parameters; the owner's words must be read as readOwnerText and quantityIn read them.

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestStockOrdersVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Settings json.RawMessage           `json:"settings"`
		Facts    map[string]map[string]any `json:"facts"`
		Messages []struct {
			Language, ID, Text, Check string
		} `json:"messages"`
		Templates []struct {
			Language, ID, Name string
			Parameters         []string
		} `json:"templates"`
		Readings []struct {
			Text    string         `json:"text"`
			Reading map[string]any `json:"reading"`
			Qty     *float64       `json:"qty"`
		} `json:"readings"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	s, errs := ReadSettings(file.Settings)
	if len(errs) > 0 {
		t.Fatalf("the example settings do not read: %v", errs)
	}
	factsOf := func(lang string) facts {
		f := facts{}
		for k, v := range file.Facts[lang] {
			switch k {
			case "options", "refs":
				var l []string
				for _, x := range v.([]any) {
					l = append(l, x.(string))
				}
				f[k] = l
			case "lines":
				var rows []statusRow
				for _, x := range v.([]any) {
					m := x.(map[string]any)
					rows = append(rows, statusRow{Ref: m["ref"].(string), ItemName: m["itemName"].(string), UnitName: m["unitName"].(string), SupplierName: m["supplierName"].(string),
						StateWord: m["stateWord"].(string), Qty: int64(m["qty"].(float64)), ReceivedQty: int64(m["receivedQty"].(float64)), TotalInr: m["totalInr"].(float64)})
				}
				f[k] = rows
			default:
				f[k] = v
			}
		}
		return f
	}
	for _, m := range file.Messages {
		f := factsOf(m.Language)
		got, err := render(m.ID, f)
		if err != nil {
			t.Fatalf("%s %s: %v", m.Language, m.ID, err)
		}
		if got != m.Text {
			t.Fatalf("%s %s:\n go %q\n ts %q", m.Language, m.ID, got, m.Text)
		}
		if v := matches(got, f).Verdict; v != m.Check {
			t.Fatalf("%s %s: the outgoing check says %s, the TypeScript's %s (%s)", m.Language, m.ID, v, m.Check, matches(got, f).Reason)
		}
	}
	// which WhatsApp template carries each message (meta-templates.ts templateMessage): its own, with its values, or the generic name with none
	for _, m := range file.Templates {
		f := factsOf(m.Language)
		text, err := render(m.ID, f)
		if err != nil {
			t.Fatalf("%s %s: %v", m.Language, m.ID, err)
		}
		got := templateMessage([]string{m.ID}, f, text, "generic")
		if got.Name != m.Name || strings.Join(got.Parameters, "\x00") != strings.Join(m.Parameters, "\x00") {
			t.Fatalf("%s %s: template %q %q, the TypeScript's %q %q", m.Language, m.ID, got.Name, got.Parameters, m.Name, m.Parameters)
		}
	}
	for _, x := range file.Readings {
		r := readOwnerText(s, x.Text)
		want := x.Reading
		str := func(k string) string { v, _ := want[k].(string); return v }
		bad := r.Kind != str("kind") || r.Command != str("command") || r.Ref != str("ref") || r.Item != str("item") || r.Supplier != str("supplier") || r.Unit != str("unit") ||
			r.UnknownSupplier != str("unknownSupplier")
		if lw, ok := want["lowStock"].(bool); ok && lw != r.LowStock {
			bad = true
		}
		if q, ok := want["qty"].(float64); ok {
			bad = bad || r.Qty == nil || float64(*r.Qty) != q
		} else if _, there := want["qty"]; !there && r.Qty != nil && r.Kind == "order" {
			bad = true
		}
		if tied, ok := want["tied"].([]any); ok && len(tied) != len(r.Tied) {
			bad = true
		}
		if bad {
			t.Fatalf("%q: read %+v, the TypeScript %v", x.Text, r, want)
		}
		q := quantityIn(x.Text)
		if (q == nil) != (x.Qty == nil) || (q != nil && float64(*q) != *x.Qty) {
			t.Fatalf("%q: quantity %v, the TypeScript %v", x.Text, q, x.Qty)
		}
	}
}
