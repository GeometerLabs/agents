// The back-soon page's language, in the order the deleted TypeScript test (templates/commerce/listings/test/shared-pool.test.ts) checked it: ?lang= first, then the browser's
// Accept-Language (the first of our four languages, in the order en, hi, ml, kn, that the header names, as back-soon.ts's LANGUAGES.find did), then the shop's own first language,
// then English. Carried over when the TypeScript shared process was deleted (19 Nov 2026).
package shared

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBackSoonLanguageAskedThenBrowserThenTheShopsOwn(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"languages":["fr","ml","en"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	p := Paths{Name: "glow-pets", ClientFolder: dir}
	cases := []struct{ url, accept, want string }{
		{"/?lang=kn", "hi-IN,hi;q=0.9", "kn"},
		{"/?lang=fr", "hi-IN,hi;q=0.9,en;q=0.8", "en"}, // an unknown ?lang= is passed over; the header names en and hi, and en comes first in the list
		{"/", "hi-IN,hi;q=0.9", "hi"},
		{"/", "ta-IN, fr", "ml"}, // the browser says nothing we speak: the shop's own first language we speak
		{"/", "", "ml"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", c.url, nil)
		if c.accept != "" {
			r.Header.Set("accept-language", c.accept)
		}
		if got := backSoonLanguage(p, r); got != c.want {
			t.Errorf("%s with %q: %s, want %s", c.url, c.accept, got, c.want)
		}
	}
	if got := backSoonLanguage(Paths{ClientFolder: filepath.Join(dir, "missing")}, httptest.NewRequest("GET", "/", nil)); got != "en" {
		t.Errorf("no settings file: %s, want en", got)
	}
}
