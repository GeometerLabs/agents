// A QR code as a picture: the inline SVG (the Go twin of modules/qr/svg.ts) and the PNG (png.ts). Both are black on white with a quiet zone of four modules, the standard's least.
//
// The SVG is the same text, byte for byte: each row's dark runs are joined into one rectangle path, and a label is escaped the way svg.ts escapes it.
//
// The PNG has the same structure and the same pixels, but NOT the same bytes. png.ts compresses the scanlines with Node's zlib at level 9, and the bytes zlib makes depend on the
// implementation (Go's compress/flate chooses other matches and so writes other bytes for the same data); nothing needs them equal, because the picture is named by a random
// address and fetched by WhatsApp. So the signature, the IHDR, the filtered scanlines before compression (one-bit greyscale, each row's filter byte 0, the pad bits white) and the
// IEND are byte-identical, the IDAT is a valid zlib stream of those same scanlines, and the tests compare the decompressed scanlines and decode the picture (testdata/qr-vectors.json
// holds what the TypeScript made). Stored (uncompressed) blocks would not make the bytes equal either: Node compresses, it does not store.
package qr

import (
	"bytes"
	"compress/zlib"
	"errors"
	"hash/crc32"
	"strconv"
	"strings"
)

// SvgOptions is svg.ts SvgOptions. Border is the modules of white around the code; nil is 4. Label is the words a screen reader says (escaped here); "" hides the picture from
// screen readers. Width is the width in CSS pixels; 0 leaves it to the stylesheet.
type SvgOptions struct {
	Border *int
	Label  string
	Width  int
}

var attributeEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")

// Svg is qrSvg: the SVG text of a QR code.
func Svg(c *Code, o SvgOptions) string {
	border := 4
	if o.Border != nil {
		border = *o.Border
	}
	total := c.Size + 2*border
	var path strings.Builder
	for y := 0; y < c.Size; y++ {
		for x := 0; x < c.Size; x++ {
			if !c.Dark[y][x] {
				continue
			}
			run := 1
			for x+run < c.Size && c.Dark[y][x+run] {
				run++
			}
			r := strconv.Itoa(run)
			path.WriteString("M" + strconv.Itoa(x+border) + " " + strconv.Itoa(y+border) + "h" + r + "v1h-" + r + "z")
			x += run - 1
		}
	}
	label := ` aria-hidden="true"`
	if o.Label != "" {
		label = ` role="img" aria-label="` + attributeEscaper.Replace(o.Label) + `"`
	}
	width := ""
	if o.Width != 0 {
		w := strconv.Itoa(o.Width)
		width = ` width="` + w + `" height="` + w + `"`
	}
	t := strconv.Itoa(total)
	return `<svg viewBox="0 0 ` + t + ` ` + t + `"` + width + label + ` shape-rendering="crispEdges"><rect width="` + t + `" height="` + t + `" fill="#fff"/><path d="` + path.String() + `" fill="#000"/></svg>`
}

// TextSvg is textQrSvg.
func TextSvg(text string, o SvgOptions) (string, error) {
	c, err := Encode(text, Options{})
	if err != nil {
		return "", err
	}
	return Svg(c, o), nil
}

// PngOptions is png.ts PngOptions: Scale is the pixels per module (nil is 8: a version 10 code is then 520 pixels across with its quiet zone; 0 is an error, as in the TypeScript),
// Border the modules of white around the code (nil is 4). The TypeScript also refuses a scale or border that is not a whole number; an int cannot be anything else.
type PngOptions struct {
	Scale  *int
	Border *int
}

var pngSignature = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

// pngChunk is one chunk: length, type, data, CRC-32 of the type and data.
func pngChunk(typ string, data []byte) []byte {
	out := make([]byte, 0, 12+len(data))
	out = append(out, byte(len(data)>>24), byte(len(data)>>16), byte(len(data)>>8), byte(len(data)))
	out = append(out, typ...)
	out = append(out, data...)
	crc := crc32.ChecksumIEEE(out[4:])
	return append(out, byte(crc>>24), byte(crc>>16), byte(crc>>8), byte(crc))
}

// Scanlines is the picture before compression: each row is a filter byte 0 and the row's pixels, one bit each, 0 black and 1 white, the pad bits past the last pixel white. It is
// what png.ts builds in `raw`.
func Scanlines(c *Code, scale, border int) (raw []byte, width int) {
	width = (c.Size + 2*border) * scale
	rowBytes := (width + 7) / 8
	raw = bytes.Repeat([]byte{0xff}, (rowBytes+1)*width)
	for py := 0; py < width; py++ {
		row := py * (rowBytes + 1)
		raw[row] = 0
		y := py/scale - border
		for px := 0; px < width; px++ {
			x := px/scale - border
			if y >= 0 && y < c.Size && x >= 0 && x < c.Size && c.Dark[y][x] {
				raw[row+1+px>>3] &^= 0x80 >> uint(px&7)
			}
		}
	}
	return raw, width
}

// Png is qrPng: the PNG bytes of a QR code (see the file comment for what is and is not identical to the TypeScript's bytes).
func Png(c *Code, o PngOptions) ([]byte, error) {
	scale, border := 8, 4
	if o.Scale != nil {
		scale = *o.Scale
	}
	if o.Border != nil {
		border = *o.Border
	}
	if scale < 1 || border < 0 {
		return nil, errors.New("scale and border must be whole numbers")
	}
	raw, width := Scanlines(c, scale, border)
	header := make([]byte, 13)
	for i, v := range []int{width, width} {
		header[i*4], header[i*4+1], header[i*4+2], header[i*4+3] = byte(v>>24), byte(v>>16), byte(v>>8), byte(v)
	}
	header[8] = 1 // bit depth; [9] greyscale, [10] deflate, [11] adaptive filtering (every row says "none"), [12] not interlaced: all 0
	var z bytes.Buffer
	w, _ := zlib.NewWriterLevel(&z, zlib.BestCompression)
	w.Write(raw)
	w.Close()
	var out bytes.Buffer
	out.Write(pngSignature)
	out.Write(pngChunk("IHDR", header))
	out.Write(pngChunk("IDAT", z.Bytes()))
	out.Write(pngChunk("IEND", nil))
	return out.Bytes(), nil
}

// TextPng is textQrPng: the PNG of the QR code of a text (a `upi://pay` link).
func TextPng(text string, o PngOptions) ([]byte, error) {
	c, err := Encode(text, Options{})
	if err != nil {
		return nil, err
	}
	return Png(c, o)
}
