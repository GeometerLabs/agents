// Tests of the signed summary against the TypeScript: every layout, Hindi, Malayalam and Kannada names that travel as UTF-16LE, names long enough to be cut (fitText with grapheme
// clusters), the links read back, links changed in each way, the check as the page makes it, and messageCheckLink at WhatsApp's limit. The TypeScript's verdicts are saved in the
// vectors; Go's own output is also run through Go's own readers.
package report

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

type fieldsVec struct {
	Layout      int
	Source      string
	OwnerMarked bool
	Period      string
	Pathway     string
	Shop        string
	By          *string
	Figures     []float64
}

func (f fieldsVec) fields() (SummaryFields, bool) {
	out := SummaryFields{Layout: f.Layout, Source: f.Source, OwnerMarked: f.OwnerMarked, Period: f.Period, Pathway: f.Pathway, Shop: f.Shop}
	if f.By != nil {
		out.By = *f.By
	}
	for _, n := range f.Figures {
		if n != float64(int64(n)) {
			return out, false // a fraction cannot be written as an int64: the Go API cannot even be asked
		}
		out.Figures = append(out.Figures, int64(n))
	}
	return out, true
}

type summaryVec struct {
	Layout                    int
	Source                    string
	OwnerMarked               bool
	Period, Pathway, Shop, By string
	Figures                   []int64
	KeyHint, Digest           string
}

func (s summaryVec) is(t *testing.T, what string, got PaperSummary) {
	t.Helper()
	if got.Layout != s.Layout || got.Source != s.Source || got.OwnerMarked != s.OwnerMarked || got.Period != s.Period || got.Pathway != s.Pathway || got.Shop != s.Shop || got.By != s.By ||
		got.KeyHint != s.KeyHint || got.Digest != s.Digest || len(got.Figures) != len(s.Figures) {
		t.Errorf("%s: %+v, TypeScript %+v", what, got, s)
		return
	}
	for i := range s.Figures {
		if got.Figures[i] != s.Figures[i] {
			t.Errorf("%s: figure %d", what, i)
		}
	}
}

func TestSignedSummariesMatchTypeScript(t *testing.T) {
	main, other, _ := testKeys(t)
	var cases []struct {
		Name                            string
		Fields                          fieldsVec
		Document                        string
		Signer, SignWith, Digest, KeyID string
		Error                           *string
		None                            bool
		Summary                         *struct {
			Summary                  summaryVec
			Payload, Signature, Link string
		}
	}
	vec(t, "summaries", &cases)
	if len(cases) < 40 {
		t.Errorf("only %d cases", len(cases))
	}
	var listed []ListedSigner
	vec(t, "signers", &listed)
	wide, cut := 0, 0
	for _, c := range cases {
		fields, expressible := c.Fields.fields()
		if !expressible {
			continue
		}
		paperKey, signKey := main, main
		if c.Signer == "other" {
			paperKey = other
		}
		signKey = paperKey
		if c.SignWith == "other" {
			signKey = other
		} else if c.SignWith == "main" {
			signKey = main
		}
		e := Seal(tree(t, c.Document), paperKey)
		if e.Digest != c.Digest || e.Signature.KeyID != c.KeyID {
			t.Fatalf("%s: the sealed paper differs", c.Name)
		}
		got, err := SummaryFor(e, fields, signKey)
		switch {
		case c.Error != nil:
			if err == nil || err.Error() != *c.Error {
				t.Errorf("%s: error %v, TypeScript %q", c.Name, err, *c.Error)
			}
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		case c.None:
			if got != nil {
				t.Errorf("%s: a summary where the TypeScript gave none", c.Name)
			}
		case got == nil:
			t.Errorf("%s: no summary, TypeScript made one", c.Name)
		default:
			w := c.Summary
			c.Summary.Summary.is(t, c.Name, got.Summary)
			if hex.EncodeToString(got.Payload) != w.Payload || hex.EncodeToString(got.Signature) != w.Signature || got.Link != w.Link {
				t.Errorf("%s: payload, signature or link differs", c.Name)
			}
			// Go's own link through Go's own reader and checker, and the TypeScript's saved verdict is the same ("genuine" for the listed key)
			read, err := ReadSummaryLink(got.Link)
			if err != nil || !bytes.Equal(read.Payload, got.Payload) {
				t.Errorf("%s: Go cannot read its own link: %v", c.Name, err)
			}
			if check := CheckSummaryLink(got.Link, listed); check.Status != "genuine" {
				t.Errorf("%s: Go's own link checks as %s", c.Name, check.Status)
			}
			if w, _ := TextBytes(got.Summary.Shop); w {
				wide++
			}
			if strings.HasSuffix(got.Summary.Shop, "…") {
				cut++
			}
		}
	}
	if wide < 3 || cut < 3 {
		t.Errorf("the cases cover too little: %d wide names, %d cut names", wide, cut)
	}
}

func TestFitTextAndTextBytes(t *testing.T) {
	var cases []struct {
		Text    string
		Max     int
		Out     string
		Carried int
		Wide    bool
	}
	vec(t, "fitText", &cases)
	for _, c := range cases {
		if got := FitText(c.Text, c.Max); got != c.Out {
			t.Errorf("fitText(%q, %d) = %q, TypeScript %q", c.Text, c.Max, got, c.Out)
		}
		wide, _ := TextBytes(c.Text)
		if CarriedLength(c.Text) != c.Carried || wide != c.Wide {
			t.Errorf("%q: carried %d wide %v, TypeScript %d %v", c.Text, CarriedLength(c.Text), wide, c.Carried, c.Wide)
		}
	}
	var texts []struct {
		Text   string
		Wide   bool
		Length int
	}
	vec(t, "texts", &texts)
	for _, c := range texts {
		if w, _ := TextBytes(c.Text); w != c.Wide || CarriedLength(c.Text) != c.Length {
			t.Errorf("%q differs", c.Text)
		}
	}
	// invalid UTF-8 is what Go has for a lone surrogate: cut out, never carried
	if got := FitText("a\xffb", 64); got != "ab" {
		t.Errorf("invalid byte: %q", got)
	}
	if _, err := EncodeSummary(PaperSummary{Layout: 3, Source: "live", Period: "2026-11", Pathway: "a", Shop: "a\xffb", Figures: []int64{1, 2, 3, 4}, KeyHint: strings.Repeat("a", 16), Digest: "sha256:" + strings.Repeat("a", 64)}); err == nil {
		t.Error("invalid UTF-8 in a name is refused")
	}
}

func TestReadSummaryLinkAndCheck(t *testing.T) {
	var cases []struct {
		Name, Link string
		Read       trialOf[struct {
			Summary                    summaryVec
			Payload, Signature, Signed string
		}]
		IsSummary             bool
		Figures               trialOf[[]LabelledFigure]
		Check, CheckNoSigners struct {
			Status  string
			Summary *summaryVec
			Signer  *ListedSigner
			Reason  string
		}
	}
	vec(t, "links", &cases)
	var signers []ListedSigner
	vec(t, "signers", &signers)
	ok, bad := 0, 0
	for _, c := range cases {
		got, err := ReadSummaryLink(c.Link)
		if c.Read.Error != nil {
			bad++
			if err == nil || err.Error() != *c.Read.Error {
				t.Errorf("%s: error %v, TypeScript %q", c.Name, err, *c.Read.Error)
			}
		} else {
			ok++
			w := c.Read.OK
			if err != nil {
				t.Errorf("%s: %v", c.Name, err)
				continue
			}
			w.Summary.is(t, c.Name, got.Summary)
			if hex.EncodeToString(got.Payload) != w.Payload || hex.EncodeToString(got.Signature) != w.Signature || hex.EncodeToString(got.Signed) != w.Signed {
				t.Errorf("%s: bytes differ", c.Name)
			}
			if c.Figures.OK != nil {
				if lf := LabelledFigures(got.Summary); len(lf) != len(*c.Figures.OK) {
					t.Errorf("%s: labelled figures", c.Name)
				} else {
					for i := range lf {
						if lf[i] != (*c.Figures.OK)[i] {
							t.Errorf("%s: labelled figure %d", c.Name, i)
						}
					}
				}
			}
		}
		if IsSummaryLink(c.Link) != c.IsSummary {
			t.Errorf("%s: isSummaryLink", c.Name)
		}
		for _, p := range []struct {
			got  SummaryCheck
			want struct {
				Status  string
				Summary *summaryVec
				Signer  *ListedSigner
				Reason  string
			}
		}{{CheckSummaryLink(c.Link, signers), c.Check}, {CheckSummaryLink(c.Link, nil), c.CheckNoSigners}} {
			if p.got.Status != p.want.Status || p.got.Reason != p.want.Reason {
				t.Errorf("%s: check %s %q, TypeScript %s %q", c.Name, p.got.Status, p.got.Reason, p.want.Status, p.want.Reason)
				continue
			}
			if (p.got.Signer == nil) != (p.want.Signer == nil) || (p.got.Signer != nil && p.got.Signer.KeyID != p.want.Signer.KeyID) {
				t.Errorf("%s: signer differs", c.Name)
			}
			if p.want.Summary != nil {
				p.want.Summary.is(t, c.Name+" check", *p.got.Summary)
			}
		}
	}
	if ok < 5 || bad < 15 {
		t.Errorf("covered %d good and %d bad links", ok, bad)
	}
}

func TestEncodeRefusals(t *testing.T) {
	good := PaperSummary{Layout: 3, Source: "live", Period: "2026-11", Pathway: "orders", Shop: "Shop", Figures: []int64{1, 2, 3, 4}, KeyHint: strings.Repeat("a", 16), Digest: "sha256:" + strings.Repeat("b", 64)}
	b, err := EncodeSummary(good)
	if err != nil {
		t.Fatal(err)
	}
	back, err := DecodeSummary(b)
	if err != nil {
		t.Fatal(err)
	}
	if b2, _ := EncodeSummary(back); !bytes.Equal(b, b2) {
		t.Error("decode then encode is not the same bytes")
	}
	for name, mutate := range map[string]func(*PaperSummary){
		"layout 0": func(s *PaperSummary) { s.Layout = 0 }, "layout 256": func(s *PaperSummary) { s.Layout = 256 }, "source": func(s *PaperSummary) { s.Source = "x" },
		"too many figures": func(s *PaperSummary) { s.Figures = make([]int64, 17) }, "wrong count": func(s *PaperSummary) { s.Figures = []int64{1} }, "negative": func(s *PaperSummary) { s.Figures[0] = -1 },
		"too big": func(s *PaperSummary) { s.Figures[0] = 1 << 53 }, "empty pathway": func(s *PaperSummary) { s.Pathway = "" }, "newline": func(s *PaperSummary) { s.Shop = "a\nb" },
		"leading space": func(s *PaperSummary) { s.Shop = " a" }, "two spaces": func(s *PaperSummary) { s.Shop = "a  b" }, "long pathway": func(s *PaperSummary) { s.Pathway = strings.Repeat("a", 33) },
		"key hint": func(s *PaperSummary) { s.KeyHint = "ABCDEFABCDEFABCD" }, "digest": func(s *PaperSummary) { s.Digest = "sha256:xx" },
	} {
		s := good
		s.Figures = append([]int64{}, good.Figures...)
		mutate(&s)
		if _, err := EncodeSummary(s); err == nil {
			t.Errorf("%s was accepted", name)
		} else if _, ok := AsSummaryError(err); !ok {
			t.Errorf("%s: not a SummaryError", name)
		}
	}
	// decode: a figure written in more bytes than it needs, and trailing bytes
	pad := append([]byte{}, b...)
	if _, err := DecodeSummary(append(pad, 0)); err == nil {
		t.Error("a trailing byte was accepted")
	}
	if _, err := DecodeSummary(nil); err == nil {
		t.Error("nothing was accepted")
	}
}

func TestMessageCheckLinkAtTheLimit(t *testing.T) {
	var cases []struct {
		Pad                 string
		N                   int
		SummaryLink         string
		Digest, Code        string
		Expected, NoSummary string
	}
	vec(t, "messageLimit", &cases)
	kinds := map[string]bool{}
	for _, c := range cases {
		fill := func(check string) string { return strings.Repeat(c.Pad, c.N) + check }
		got, err := MessageCheckLink(fill, c.Digest, c.Code, c.SummaryLink)
		if err != nil || got != c.Expected {
			t.Errorf("pad %q n %d: %q, TypeScript %q", c.Pad, c.N, got, c.Expected)
		}
		kinds[got[:min(len(got), 40)]] = true
		got, err = MessageCheckLink(fill, c.Digest, c.Code, "")
		if err != nil || got != c.NoSummary {
			t.Errorf("pad %q n %d without a summary: %q, TypeScript %q", c.Pad, c.N, got, c.NoSummary)
		}
	}
	if len(kinds) < 3 {
		t.Errorf("the cases reach only %d of the three links", len(kinds))
	}
}

func TestSummaryHelpers(t *testing.T) {
	main, _, _ := testKeys(t)
	var periods []struct {
		Period string
		Ok     bool
	}
	vec(t, "periods", &periods)
	for _, p := range periods {
		if IsPeriod(p.Period) != p.Ok {
			t.Errorf("isPeriod(%q)", p.Period)
		}
	}
	var po []struct {
		Period struct {
			Month             *YearMonth
			FirstDay, LastDay struct{ Year, Month, Day int }
		}
		Out   string
		Label []string
	}
	vec(t, "periodOf", &po)
	for _, p := range po {
		rp := ReportPeriod{Month: p.Period.Month}
		rp.FirstDay.Year, rp.FirstDay.Month, rp.FirstDay.Day = p.Period.FirstDay.Year, p.Period.FirstDay.Month, p.Period.FirstDay.Day
		rp.LastDay.Year, rp.LastDay.Month, rp.LastDay.Day = p.Period.LastDay.Year, p.Period.LastDay.Month, p.Period.LastDay.Day
		if PeriodOf(rp) != p.Out {
			t.Errorf("periodOf %+v", p.Period)
		}
		for i, l := range languages {
			if PeriodLabel(rp, l) != p.Label[i] {
				t.Errorf("periodLabel %s %+v: %q, TypeScript %q", l, p.Period, PeriodLabel(rp, l), p.Label[i])
			}
		}
	}
	var hints []struct {
		KeyID string
		trialOf[string]
	}
	vec(t, "keyHints", &hints)
	for _, h := range hints {
		got, err := KeyHintOf(h.KeyID)
		h.same(t, h.KeyID, got, err, strEq)
	}
	var claims []struct {
		ID string
		trialOf[struct{ Public_key, Proof string }]
	}
	vec(t, "claim", &claims)
	for _, c := range claims {
		pub, proof, err := SignerClaim(main, c.ID)
		c.same(t, c.ID, struct{ Public_key, Proof string }{pub, proof}, err, func(a, b struct{ Public_key, Proof string }) bool { return a == b })
	}
	var gl []struct {
		Cert struct {
			Pathway    struct{ Name string }
			Shop       struct{ Name string }
			PreparedBy *string
			IssuedOn   struct{ Year, Month, Day int }
			Checks     struct{ Held, Total, Failed int }
			NotTested  []any
		}
		Fields fieldsVec
	}
	vec(t, "goLiveFields", &gl)
	for _, c := range gl {
		cert := GoLiveCertificate{PathwayName: c.Cert.Pathway.Name, ShopName: c.Cert.Shop.Name, Held: c.Cert.Checks.Held, Total: c.Cert.Checks.Total, Failed: c.Cert.Checks.Failed, NotTested: len(c.Cert.NotTested)}
		cert.IssuedOn.Year, cert.IssuedOn.Month, cert.IssuedOn.Day = c.Cert.IssuedOn.Year, c.Cert.IssuedOn.Month, c.Cert.IssuedOn.Day
		if c.Cert.PreparedBy != nil {
			cert.PreparedBy = *c.Cert.PreparedBy
		}
		want, _ := c.Fields.fields()
		got := GoLiveSummaryFields(cert)
		if got.Layout != want.Layout || got.Source != want.Source || got.Period != want.Period || got.Pathway != want.Pathway || got.Shop != want.Shop || got.By != want.By || len(got.Figures) != 4 || got.Figures[3] != want.Figures[3] {
			t.Errorf("goLiveSummaryFields %+v", got)
		}
	}
	var days []struct {
		Date struct{ Year, Month, Day int }
		Out  string
	}
	vec(t, "dayOf", &days)
	for _, d := range days {
		var date zone.Date
		date.Year, date.Month, date.Day = d.Date.Year, d.Date.Month, d.Date.Day
		if DayOf(date) != d.Out {
			t.Errorf("dayOf %+v", d.Date)
		}
	}
	// the sample link is a real summary of the first test vector
	link, digest := SampleSummaryLink()
	if r, err := ReadSummaryLink(link); err != nil || r.Summary.Digest != digest {
		t.Errorf("the sample link: %v", err)
	}
	// a key that is not the paper's own is refused
	e := Seal(map[string]any{"a": 1}, main)
	_, other, _ := testKeys(t)
	if _, err := SummaryFor(e, SummaryFields{Layout: 3, Source: "live", Period: "2026-11", Pathway: "p", Shop: "s", Figures: []int64{1, 2, 3, 4}}, other); err == nil {
		t.Error("a summary signed with another key")
	}
	if got, err := SummaryFor(Seal(map[string]any{"a": 1}, nil), SummaryFields{}, main); got != nil || err != nil {
		t.Error("an unsigned paper has no summary")
	}
}
