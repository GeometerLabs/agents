package qr_test

// The QR encoder, SVG writer and PNG writer against what the TypeScript made (testdata/qr-vectors.json, written by go/scripts/vectors/qr.ts): the same matrix for every text, the same
// SVG bytes, and for a PNG the same structure and the same scanlines (the compressed bytes may differ, see image.go) that also decode to the code's own pixels.

import (
	"bytes"
	"compress/zlib"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"hash/crc32"
	"image/color"
	"image/png"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/qr"
)

type vectors struct {
	Matrices []struct {
		Text    string `json:"text"`
		Options struct {
			MinVersion *int `json:"minVersion"`
			Mask       *int `json:"mask"`
		} `json:"options"`
		Version int      `json:"version"`
		Size    int      `json:"size"`
		Mask    int      `json:"mask"`
		Sha     string   `json:"sha"`
		Rows    []string `json:"rows"`
		Error   string   `json:"error"`
	} `json:"matrices"`
	Svgs []struct {
		Text    string `json:"text"`
		Options struct {
			Border *int    `json:"border"`
			Label  *string `json:"label"`
			Width  *int    `json:"width"`
		} `json:"options"`
		Svg string `json:"svg"`
	} `json:"svgs"`
	Pngs []struct {
		Text    string `json:"text"`
		Options struct {
			Scale  *float64 `json:"scale"`
			Border *float64 `json:"border"`
		} `json:"options"`
		Signature  string   `json:"signature"`
		ChunkTypes []string `json:"chunkTypes"`
		Ihdr       string   `json:"ihdr"`
		Iend       string   `json:"iend"`
		RawLength  int      `json:"rawLength"`
		RawSha     string   `json:"rawSha"`
		Width      int      `json:"width"`
		Error      string   `json:"error"`
	} `json:"pngs"`
}

func load(t *testing.T) vectors {
	t.Helper()
	b, err := os.ReadFile("testdata/qr-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Matrices) < 100 || len(v.Svgs) == 0 || len(v.Pngs) == 0 {
		t.Fatalf("the vector file is nearly empty: %d matrices, %d svgs, %d pngs", len(v.Matrices), len(v.Svgs), len(v.Pngs))
	}
	return v
}

func sha(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func rowsOf(c *qr.Code) []string {
	rows := make([]string, c.Size)
	for y, r := range c.Dark {
		var sb strings.Builder
		for _, d := range r {
			if d {
				sb.WriteByte('1')
			} else {
				sb.WriteByte('0')
			}
		}
		rows[y] = sb.String()
	}
	return rows
}

func TestMatrixMatchesTypeScript(t *testing.T) {
	v := load(t)
	big := 0
	for i, m := range v.Matrices {
		name := m.Text
		if len(name) > 30 {
			name = name[:30]
		}
		o := qr.Options{}
		if m.Options.MinVersion != nil {
			o.MinVersion = *m.Options.MinVersion
		}
		o.Mask = m.Options.Mask
		c, err := qr.Encode(m.Text, o)
		if m.Error != "" {
			if err == nil || err.Error() != m.Error {
				t.Errorf("#%d %q: want error %q, got %v", i, name, m.Error, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("#%d %q: %v", i, name, err)
			continue
		}
		if c.Version != m.Version || c.Size != m.Size || c.Mask != m.Mask {
			t.Errorf("#%d %q: version/size/mask %d/%d/%d, TypeScript %d/%d/%d", i, name, c.Version, c.Size, c.Mask, m.Version, m.Size, m.Mask)
			continue
		}
		rows := rowsOf(c)
		if got := sha([]byte(strings.Join(rows, "\n"))); got != m.Sha {
			t.Errorf("#%d %q: the matrix differs (version %d, mask %d)", i, name, c.Version, c.Mask)
		}
		if m.Rows != nil {
			for y := range rows {
				if rows[y] != m.Rows[y] {
					t.Errorf("#%d %q: row %d is %s, TypeScript %s", i, name, y, rows[y], m.Rows[y])
					break
				}
			}
		}
		if c.Version >= 30 {
			big++
		}
	}
	if big == 0 {
		t.Error("no large versions were compared")
	}
}

func TestSvgBytesMatchTypeScript(t *testing.T) {
	for i, s := range load(t).Svgs {
		o := qr.SvgOptions{Border: s.Options.Border, Width: 0}
		if s.Options.Label != nil {
			o.Label = *s.Options.Label
		}
		if s.Options.Width != nil {
			o.Width = *s.Options.Width
		}
		got, err := qr.TextSvg(s.Text, o)
		if err != nil {
			t.Fatal(err)
		}
		if got != s.Svg {
			t.Errorf("#%d %q %+v: SVG differs\n  Go: %.200s\n  TS: %.200s", i, s.Text, s.Options, got, s.Svg)
		}
	}
}

// chunks splits a PNG into its chunks, checking each CRC.
func chunks(t *testing.T, b []byte) (types []string, data [][]byte) {
	t.Helper()
	for i := 8; i < len(b); {
		n := int(b[i])<<24 | int(b[i+1])<<16 | int(b[i+2])<<8 | int(b[i+3])
		typ, body := string(b[i+4:i+8]), b[i+8:i+8+n]
		want := crc32.ChecksumIEEE(b[i+4 : i+8+n])
		got := uint32(b[i+8+n])<<24 | uint32(b[i+9+n])<<16 | uint32(b[i+10+n])<<8 | uint32(b[i+11+n])
		if want != got {
			t.Errorf("chunk %s: CRC %x, want %x", typ, got, want)
		}
		types, data = append(types, typ), append(data, body)
		i += 12 + n
	}
	return
}

func TestPngStructureAndScanlinesMatchTypeScript(t *testing.T) {
	compared := 0
	for i, p := range load(t).Pngs {
		o := qr.PngOptions{}
		whole := true
		if p.Options.Scale != nil {
			if *p.Options.Scale != float64(int(*p.Options.Scale)) {
				whole = false
			}
			s := int(*p.Options.Scale)
			o.Scale = &s
		}
		if p.Options.Border != nil {
			if *p.Options.Border != float64(int(*p.Options.Border)) {
				whole = false
			}
			b := int(*p.Options.Border)
			o.Border = &b
		}
		if !whole {
			// a scale or border that is not a whole number cannot be written as an int: the TypeScript's refusal is a type here
			if p.Error != "scale and border must be whole numbers" {
				t.Errorf("#%d: expected the whole-number error, TypeScript said %q", i, p.Error)
			}
			continue
		}
		got, err := qr.TextPng(p.Text, o)
		if p.Error != "" {
			if err == nil || err.Error() != p.Error {
				t.Errorf("#%d: want error %q, got %v", i, p.Error, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("#%d: %v", i, err)
			continue
		}
		if hex.EncodeToString(got[:8]) != p.Signature {
			t.Errorf("#%d: signature %x", i, got[:8])
		}
		if hex.EncodeToString(got[len(got)-12:]) != p.Iend {
			t.Errorf("#%d: IEND %x, want %s", i, got[len(got)-12:], p.Iend)
		}
		types, data := chunks(t, got)
		if strings.Join(types, ",") != strings.Join(p.ChunkTypes, ",") {
			t.Errorf("#%d: chunks %v, TypeScript %v", i, types, p.ChunkTypes)
			continue
		}
		if hex.EncodeToString(data[0]) != p.Ihdr {
			t.Errorf("#%d: IHDR %x, want %s", i, data[0], p.Ihdr)
		}
		zr, err := zlib.NewReader(bytes.NewReader(data[1]))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if len(raw) != p.RawLength || sha(raw) != p.RawSha {
			t.Errorf("#%d %q %+v: the scanlines differ from the TypeScript's (%d bytes, want %d)", i, p.Text, p.Options, len(raw), p.RawLength)
		}
		compared++
	}
	if compared < 20 {
		t.Errorf("only %d PNGs were compared", compared)
	}
}

// The PNG decodes with the standard library to exactly the code's pixels, quiet zone included.
func TestPngDecodesToTheCode(t *testing.T) {
	for _, text := range []string{"hello", "upi://pay?pa=glowsalon@okaxis&pn=Glow%20Salon&am=600.00&cu=INR&tn=Deposit&tr=b-3", strings.Repeat("x", 300)} {
		c, err := qr.Encode(text, qr.Options{})
		if err != nil {
			t.Fatal(err)
		}
		scale, border := 3, 4
		b, err := qr.Png(c, qr.PngOptions{Scale: &scale})
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		if w := (c.Size + 2*border) * scale; img.Bounds().Dx() != w || img.Bounds().Dy() != w {
			t.Fatalf("size %v, want %d", img.Bounds(), w)
		}
		for py := 0; py < img.Bounds().Dy(); py++ {
			for px := 0; px < img.Bounds().Dx(); px++ {
				y, x := py/scale-border, px/scale-border
				dark := y >= 0 && y < c.Size && x >= 0 && x < c.Size && c.Dark[y][x]
				g := color.GrayModel.Convert(img.At(px, py)).(color.Gray).Y
				if dark != (g == 0) {
					t.Fatalf("%q pixel (%d,%d): dark %v but grey %d", text, px, py, dark, g)
				}
			}
		}
	}
}

// Go-only: the places Go differs from JavaScript on purpose, and the helpers the TypeScript tests also check.
func TestGoOnly(t *testing.T) {
	if _, err := qr.Encode("x", qr.Options{Mask: func() *int { m := 9; return &m }()}); err == nil || err.Error() != "no mask 9" {
		t.Errorf("a forced mask of 9: %v", err)
	}
	zero := 0
	if _, err := qr.Png(&qr.Code{Size: 21}, qr.PngOptions{Scale: &zero}); err == nil || err.Error() != "scale and border must be whole numbers" {
		t.Errorf("a scale of 0: %v", err)
	}
	// ISO/IEC 18004: version 1 at level M holds 16 data codewords, version 40 holds 2334; byte capacity 14 and 2331.
	if qr.DataCodewords(1) != 16 || qr.DataCodewords(40) != 2334 || qr.ByteCapacity(1) != 14 || qr.ByteCapacity(40) != 2331 {
		t.Errorf("capacities: %d %d %d %d", qr.DataCodewords(1), qr.DataCodewords(40), qr.ByteCapacity(1), qr.ByteCapacity(40))
	}
	if qr.VersionFor(2332, 1) != 0 || qr.VersionFor(14, 1) != 1 || qr.VersionFor(15, 1) != 2 || qr.VersionFor(1, 0) != 1 {
		t.Error("VersionFor")
	}
	// the standard's worked example of Reed-Solomon: the 10 codewords for the 16 data codewords of "01234567" (ISO/IEC 18004 annex I)
	data := []byte{0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11}
	want := []byte{0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55}
	if got := qr.ReedSolomon(data, 10); !bytes.Equal(got, want) {
		t.Errorf("Reed-Solomon %x, want %x", got, want)
	}
}
