// Tests of the canonical JSON, the digest and the short code against what the TypeScript gave (testdata/vectors.json): JavaScript's number text, JSON.stringify's string escapes and
// the UTF-16 order of keys, byte for byte.
package report

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanonicalJSONMatchesTypeScript(t *testing.T) {
	var cases []struct{ JSON, Out, Digest string }
	vec(t, "canonical", &cases)
	if len(cases) < 30 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, c := range cases {
		v := tree(t, c.JSON)
		if got := CanonicalJSON(v); got != c.Out {
			t.Errorf("%s: %s, TypeScript %s", c.JSON, got, c.Out)
		}
		if got := DigestOf(v); got != c.Digest {
			t.Errorf("%s: digest %s, TypeScript %s", c.JSON, got, c.Digest)
		}
	}
}

func TestJSNumber(t *testing.T) {
	var cases []struct {
		Number float64
		Text   string
	}
	vec(t, "numbers", &cases)
	for _, c := range cases {
		if got := JSNumber(c.Number); got != c.Text {
			t.Errorf("%v: %s, JSON.stringify %s", c.Number, got, c.Text)
		}
	}
	if JSNumber(negZero()) != "0" {
		t.Error("-0 is written 0")
	}
	if CanonicalJSON(map[string]any{"a": nan(), "b": json.Number("1e21"), "c": int64(1 << 60), "d": uint8(7), "e": []string{"x"}, "f": map[string]int{"z": 1, "y": 2}}) !=
		`{"a":null,"b":1e+21,"c":1152921504606847000,"d":7,"e":["x"],"f":{"y":2,"z":1}}` {
		t.Error("the other number types")
	}
}

func negZero() float64 { z := 0.0; return -z * 1 }
func nan() float64     { z := 0.0; return z / z }

func TestJSONStringEscapes(t *testing.T) {
	for in, want := range map[string]string{
		"a\"b\\c": `"a\"b\\c"`, "\b\f\n\r\t": `"\b\f\n\r\t"`, "\x01\x1f": `"\u0001\u001f"`, "\x7f": "\"\x7f\"", "  ": "\"  \"", "<&>": `"<&>"`, "é😀": `"é😀"`, "a\xffb": "\"a�b\"",
	} {
		if got := JSONString(in); got != want {
			t.Errorf("%q: %s, want %s", in, got, want)
		}
	}
}

func TestLessUTF16(t *testing.T) {
	// U+10000 is the surrogate pair D800 DC00, so it sorts before U+FF5E and U+E000 in JavaScript (and after them in a byte or rune order)
	if !LessUTF16("\U00010000", "～") || !LessUTF16("\U00010000", "") || LessUTF16("", "\U00010000") || !LessUTF16("a", "ab") || LessUTF16("ab", "ab") {
		t.Error("UTF-16 order")
	}
}

func TestVerificationCode(t *testing.T) {
	var cases []struct {
		Digest string
		trialOf[string]
	}
	vec(t, "codes", &cases)
	for _, c := range cases {
		got, err := VerificationCode(c.Digest)
		c.same(t, c.Digest, got, err, strEq)
	}
	if _, err := VerificationCode("sha256:" + strings.Repeat("0", 64) + "\n"); err == nil {
		t.Error("a trailing newline is refused")
	}
}
