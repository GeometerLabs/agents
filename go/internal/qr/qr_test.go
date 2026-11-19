// Tests of the Go QR encoder against what the TypeScript produced (testdata/vectors.json, made by scripts/gen_qr_vectors.ts): the matrix, mask, version and the SVG text
// must be identical; the PNG must decode to the same modules.
package qr

import (
	"bytes"
	"encoding/json"
	"image/png"
	"os"
	"strings"
	"testing"
)

type vecCase struct {
	Text    string   `json:"text"`
	Version int      `json:"version"`
	Mask    int      `json:"mask"`
	Rows    []string `json:"rows"`
	Svg     string   `json:"svg"`
	TextSvg string   `json:"textSvg"`
}

type vectors struct {
	Cases   []vecCase `json:"cases"`
	Options []struct {
		Text   string `json:"text"`
		Border *int   `json:"border"`
		Label  string `json:"label"`
		Width  int    `json:"width"`
		Svg    string `json:"svg"`
	} `json:"options"`
	Masks   []vecCase `json:"masks"`
	TooLong string    `json:"tooLong"`
}

func load(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func rowsOf(c *Code) []string {
	out := make([]string, c.Size)
	for y, r := range c.Dark {
		var b strings.Builder
		for _, d := range r {
			if d {
				b.WriteByte('1')
			} else {
				b.WriteByte('0')
			}
		}
		out[y] = b.String()
	}
	return out
}

func TestMatrixAndSvgMatchTypeScript(t *testing.T) {
	v := load(t)
	versions := map[int]bool{}
	for _, c := range v.Cases {
		got, err := Encode(c.Text)
		if err != nil {
			t.Fatal(err)
		}
		versions[got.Version] = true
		if got.Version != c.Version || got.Mask != c.Mask {
			t.Errorf("%.20q: version %d mask %d, TypeScript %d %d", c.Text, got.Version, got.Mask, c.Version, c.Mask)
		}
		if strings.Join(rowsOf(got), "\n") != strings.Join(c.Rows, "\n") {
			t.Errorf("%.20q: the matrix differs", c.Text)
		}
		if s := Svg(got, SvgOptions{}); s != c.Svg {
			t.Errorf("%.20q: the SVG differs", c.Text)
		}
		if s, _ := TextSvg(c.Text, SvgOptions{}); s != c.TextSvg {
			t.Errorf("%.20q: the text SVG differs", c.Text)
		}
	}
	if len(versions) < 8 {
		t.Errorf("only %d versions were covered", len(versions))
	}
}

func TestSvgOptionsAndForcedMasks(t *testing.T) {
	v := load(t)
	for _, o := range v.Options {
		so := SvgOptions{Label: o.Label, Width: o.Width}
		if o.Border != nil {
			so.Border, so.BorderSet = *o.Border, true
		}
		if s, _ := TextSvg(o.Text, so); s != o.Svg {
			t.Errorf("%q: options SVG differs:\n%s\n%s", o.Text, s, o.Svg)
		}
	}
	for _, m := range v.Masks {
		got, _ := EncodeWith(m.Text, Options{Mask: m.Mask})
		if got.Mask != m.Mask || strings.Join(rowsOf(got), "\n") != strings.Join(m.Rows, "\n") {
			t.Errorf("mask %d differs", m.Mask)
		}
	}
}

func TestTooLong(t *testing.T) {
	_, err := Encode(strings.Repeat("w", 2400))
	if err == nil || err.Error() != v0(t).TooLong {
		t.Errorf("error %v, TypeScript %q", err, v0(t).TooLong)
	}
}

func v0(t *testing.T) vectors { return load(t) }

func TestPngDecodesToTheSameModules(t *testing.T) {
	c, _ := Encode("upi://pay?pa=a@b&pn=Shop")
	data, err := Png(c, 0, -1)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != (c.Size+8)*8 {
		t.Fatalf("width %d", img.Bounds().Dx())
	}
	for y := 0; y < c.Size; y++ {
		for x := 0; x < c.Size; x++ {
			r, _, _, _ := img.At((x+4)*8+3, (y+4)*8+3).RGBA()
			if (r == 0) != c.Dark[y][x] {
				t.Fatalf("module %d,%d", x, y)
			}
		}
	}
	if r, _, _, _ := img.At(2, 2).RGBA(); r == 0 {
		t.Error("the quiet zone is not white")
	}
	if _, err := Png(c, -3, 4); err == nil {
		t.Error("a negative scale is refused")
	}
}
