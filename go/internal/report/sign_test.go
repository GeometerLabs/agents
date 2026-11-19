// Tests of sealing and checking a document against the TypeScript: the same digest, code, signature (Ed25519 is deterministic) and file bytes for several documents with and without a
// key; the TypeScript's verdict on good and tampered files; and Go's own output run through Go's own verifier.
package report

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestSealMatchesTypeScript(t *testing.T) {
	main, _, kv := testKeys(t)
	var cases []struct {
		Document, Key, Digest, Code, File string
		Signature                         *struct{ Algorithm, KeyID, PublicKey, Value string } `json:"signature"`
	}
	vec(t, "sealed", &cases)
	for _, c := range cases {
		var key ed25519.PrivateKey
		if c.Key == "main" {
			key = main
		}
		e := Seal(tree(t, c.Document), key)
		if e.Digest != c.Digest || e.Code != c.Code {
			t.Errorf("%s: digest %s code %s, TypeScript %s %s", c.Document, e.Digest, e.Code, c.Digest, c.Code)
		}
		if file := EnvelopeFile(e); file != c.File {
			t.Errorf("%s: the file differs:\n%s\n%s", c.Document, file, c.File)
		}
		if (e.Signature == nil) != (c.Signature == nil) || (e.Signature != nil && (e.Signature.Value != c.Signature.Value || e.Signature.KeyID != c.Signature.KeyID || e.Signature.PublicKey != c.Signature.PublicKey)) {
			t.Errorf("%s: signature differs", c.Document)
		}
		// Go's own output through Go's own verifier
		v := VerifyEnvelopeText(EnvelopeFile(e), nil)
		if !v.Unchanged || v.Signed != (key != nil) {
			t.Errorf("%s: Go's file does not check: %+v", c.Document, v.Checks)
		}
	}
	if PublicKeyHex(main) != kv.PublicKey || KeyIDOf(kv.PublicKey) != kv.KeyID {
		t.Error("the public key or its id differs")
	}
}

type verdictVec struct {
	Name    string
	Text    string
	Trust   []string
	Verdict struct {
		Unchanged, Signed, Trusted bool
		KeyID                      *string `json:"keyId"`
		Checks                     []Check
		NotChecked                 []string
		Summary                    string
		Envelope                   map[string]any
	}
}

func TestVerifyEnvelopeTextMatchesTypeScript(t *testing.T) {
	var cases []verdictVec
	vec(t, "verify", &cases)
	if len(cases) < 60 {
		t.Errorf("only %d cases", len(cases))
	}
	for _, c := range cases {
		got := VerifyEnvelopeText(c.Text, c.Trust)
		w := c.Verdict
		id := c.Name
		if got.Unchanged != w.Unchanged || got.Signed != w.Signed || got.Trusted != w.Trusted || (got.KeyID == nil) != (w.KeyID == nil) || (got.KeyID != nil && *got.KeyID != *w.KeyID) {
			t.Errorf("%s (trust %v): verdict %v %v %v %v, TypeScript %v %v %v %v", id, c.Trust, got.Unchanged, got.Signed, got.Trusted, got.KeyID, w.Unchanged, w.Signed, w.Trusted, w.KeyID)
		}
		if got.Summary != w.Summary || !slices.Equal(got.NotChecked, w.NotChecked) {
			t.Errorf("%s (trust %v): summary or notChecked differ:\n%s\n%s", id, c.Trust, got.Summary, w.Summary)
		}
		if len(got.Checks) != len(w.Checks) {
			t.Errorf("%s: %d checks, TypeScript %d", id, len(got.Checks), len(w.Checks))
			continue
		}
		for i := range w.Checks {
			g := got.Checks[i]
			// the one detail that carries a JSON parser's own message: V8's text, not Go's
			if g.Name != w.Checks[i].Name || g.OK != w.Checks[i].OK || (i > 0 || g.OK) && g.Detail != w.Checks[i].Detail {
				t.Errorf("%s check %d: %+v, TypeScript %+v", id, i, g, w.Checks[i])
			}
		}
		if (got.Envelope == nil) != (w.Envelope == nil) {
			t.Errorf("%s: envelope presence differs", id)
		} else if got.Envelope != nil {
			if d, isString := w.Envelope["digest"].(string); isString && got.Envelope.Digest != d {
				t.Errorf("%s: envelope digest", id)
			}
			if CanonicalJSON(got.Envelope.Document) != CanonicalJSON(w.Envelope["document"]) {
				t.Errorf("%s: envelope document", id)
			}
		}
	}
}

func TestLoadPrivateKey(t *testing.T) {
	main, _, _ := testKeys(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "report-key.pem")
	der, err := x509.MarshalPKCS8PrivateKey(main) // the PEM is made here from the test seed, so no key text is kept in a file
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	key, err := LoadPrivateKey(path)
	if err != nil || !key.Equal(main) {
		t.Fatalf("a 0600 key: %v", err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPrivateKey(path); err == nil || err.Error() != "The key file "+path+" can be read by other people (mode 644). Run: chmod 600 "+path {
		t.Errorf("a world-readable key: %v", err)
	}
	if _, err := LoadPrivateKey(filepath.Join(dir, "none.pem")); err == nil {
		t.Error("a missing file")
	}
	bad := filepath.Join(dir, "bad.pem")
	_ = os.WriteFile(bad, []byte("not pem"), 0o600)
	if _, err := LoadPrivateKey(bad); err == nil {
		t.Error("a file that is not PEM")
	}
}
