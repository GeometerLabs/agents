package messaging_test

// The pure checks against the TypeScript's answers (testdata/misc-vectors.json): what a document, picture, sticker, button or list may be, the provider config check, a template's
// parameters and Meta's error words. Plus the differences Go cannot reproduce, which are tested here as what they are (not vectors).

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

func TestMiscVectors(t *testing.T) {
	var v struct {
		Documents []struct {
			In  messaging.DocumentMessage `json:"in"`
			Out *string                   `json:"out"`
		} `json:"documents"`
		Images []struct {
			In  messaging.ImageMessage `json:"in"`
			Out *string                `json:"out"`
		} `json:"images"`
		Stickers []struct {
			In  messaging.StickerMessage `json:"in"`
			Out *string                  `json:"out"`
		} `json:"stickers"`
		Interactive []struct {
			In      messaging.InteractiveMessage `json:"in"`
			Text    string                       `json:"text"`
			Problem *string                      `json:"problem"`
		} `json:"interactive"`
		Configs []struct {
			In  map[string]any `json:"in"`
			Out *string        `json:"out"`
		} `json:"configs"`
		Parameters []struct {
			In  string `json:"in"`
			Out string `json:"out"`
		} `json:"parameters"`
		MetaErrors []struct {
			In struct {
				Status int             `json:"status"`
				Body   json.RawMessage `json:"body"`
			} `json:"in"`
			Out struct {
				Message string `json:"message"`
				Code    *int64 `json:"code"`
			} `json:"out"`
		} `json:"metaErrors"`
	}
	readJSON(t, "testdata/misc-vectors.json", &v)
	words := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	for i, c := range v.Documents {
		if got := messaging.DocumentProblem(c.In); got != words(c.Out) {
			t.Errorf("document %d %+v: Go %q, TypeScript %q", i, c.In, got, words(c.Out))
		}
	}
	for i, c := range v.Images {
		if got := messaging.ImageProblem(c.In); got != words(c.Out) {
			t.Errorf("image %d %+v: Go %q, TypeScript %q", i, c.In, got, words(c.Out))
		}
	}
	for i, c := range v.Stickers {
		if got := messaging.StickerProblem(c.In); got != words(c.Out) {
			t.Errorf("sticker %d %+v: Go %q, TypeScript %q", i, c.In, got, words(c.Out))
		}
	}
	for i, c := range v.Interactive {
		if got := messaging.InteractiveProblem(c.In); got != words(c.Problem) {
			t.Errorf("interactive %d: Go %q, TypeScript %q", i, got, words(c.Problem))
		}
		if got := messaging.InteractiveText(c.In); got != c.Text {
			t.Errorf("interactive text %d: Go %q, TypeScript %q", i, got, c.Text)
		}
	}
	for i, c := range v.Configs {
		if got := messaging.ConfigProblem(c.In); got != words(c.Out) {
			t.Errorf("config %d %v: Go %q, TypeScript %q", i, c.In, got, words(c.Out))
		}
	}
	for _, c := range v.Parameters {
		if got := messaging.CleanParameter(c.In); got != c.Out {
			t.Errorf("parameter %q: Go %q, TypeScript %q", c.In, got, c.Out)
		}
	}
	for i, c := range v.MetaErrors {
		body, err := guard.Decode(string(c.In.Body))
		if err != nil {
			t.Fatal(err)
		}
		got := messaging.DescribeMetaError(guard.Reply{Status: c.In.Status, Body: body})
		if got.Message != c.Out.Message || got.HasCode != (c.Out.Code != nil) || (c.Out.Code != nil && got.Code != *c.Out.Code) {
			t.Errorf("meta error %d: Go %+v, TypeScript %+v", i, got, c.Out)
		}
	}
	if len(v.Documents) == 0 || len(v.Interactive) == 0 {
		t.Fatal("no vectors")
	}
}

// A decoded `description: ""` is present and refused; a missing one is absent. (TypeScript: `c.description !== undefined`.)
func TestEmptyDescriptionIsPresent(t *testing.T) {
	empty := ""
	m := messaging.InteractiveMessage{Body: "b", List: &messaging.InteractiveList{Button: "L", Rows: []messaging.Choice{{ID: "r", Title: "T", Description: &empty}}}}
	if messaging.InteractiveProblem(m) == "" {
		t.Fatal("an empty description is refused")
	}
}

// The Go clients' own checks (the TypeScript ones sit behind createLiveMessaging's config check, so the vectors reach the config check first).
func TestConstructorChecks(t *testing.T) {
	deps := messaging.Deps{Clock: func() int64 { return 0 }, Window: windows{}}
	if _, err := messaging.NewGupshup(messaging.GupshupConfig{BaseURL: "http://localhost:1", AppID: "short"}, deps); err == nil || err.Error() != "The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens)." {
		t.Errorf("gupshup app id: %v", err)
	}
	if _, err := messaging.NewSelfServe(messaging.SelfServeConfig{BaseURL: "http://localhost:1", AppName: "a", SourceNumber: "919876543210"}, deps); err == nil || err.Error() != "The Gupshup app name must be the app's name as Gupshup shows it (letters, digits and underscores)." {
		t.Errorf("app name: %v", err)
	}
	if _, err := messaging.NewSelfServe(messaging.SelfServeConfig{BaseURL: "http://localhost:1", AppName: "ab", SourceNumber: "12"}, deps); err == nil || err.Error() != "The Gupshup source number must be the app's WhatsApp number with its country code (digits only)." {
		t.Errorf("source: %v", err)
	}
	if _, err := messaging.NewSelfServe(messaging.SelfServeConfig{BaseURL: "http://localhost:1", AppName: "ab", SourceNumber: "123456", AppID: "x"}, deps); err == nil || err.Error() != "The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens)." {
		t.Errorf("app id: %v", err)
	}
	if _, err := messaging.NewMeta(messaging.MetaConfig{BaseURL: "http://user:pw@localhost:1"}, deps); err == nil {
		t.Error("a base URL with a password is refused")
	}
}

// A licence reason cut inside a surrogate pair (JavaScript's slice(0, 300) keeps a lone surrogate; a Go string cannot): the half character is dropped.
func TestLicenceReasonCutInsideAPairDropsTheHalf(t *testing.T) {
	d := messaging.GuardLicenceDecision(strings.Repeat("r", 299)+"😀", true)
	if want := "Guard refused it for the shop's licence (" + strings.Repeat("r", 299) + "): nothing was sent, it is not tried again, and nothing is kept to do later"; d.Reason != want {
		t.Fatalf("got %q", d.Reason)
	}
}
