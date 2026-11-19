// The QR code as an inline SVG and as a PNG: svg.ts and png.ts of modules/qr. The SVG is byte-for-byte the TypeScript's text (a page that may load nothing from outside embeds it);
// the PNG is the same picture (black on white, one-bit greyscale, a quiet zone of four modules) but its compressed bytes are Go's deflate, not Node's zlib, so the two
// runtimes' PNG FILES differ while decoding to the same pixels; nothing compares PNG bytes (the WhatsApp image is fetched by URL, not hashed).
package qr

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"strconv"
	"strings"
)

// SvgOptions are qrSvg's options: Border (modules of white, default 4 when BorderSet is false), Label (read by a screen reader; empty hides the picture) and Width (CSS pixels, 0 = left to the stylesheet).
type SvgOptions struct {
	Border    int
	BorderSet bool
	Label     string
	Width     int
}

// escapeAttribute is the TypeScript's four replacements, in its order (& first).
func escapeAttribute(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return strings.ReplaceAll(s, `"`, "&quot;")
}

// Svg is the SVG text of a QR code (qrSvg).
func Svg(c *Code, o SvgOptions) string {
	border := 4
	if o.BorderSet {
		border = o.Border
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
			path.WriteString("M" + strconv.Itoa(x+border) + " " + strconv.Itoa(y+border) + "h" + strconv.Itoa(run) + "v1h-" + strconv.Itoa(run) + "z")
			x += run - 1
		}
	}
	label := ` aria-hidden="true"`
	if o.Label != "" {
		label = ` role="img" aria-label="` + escapeAttribute(o.Label) + `"`
	}
	width := ""
	if o.Width != 0 {
		w := strconv.Itoa(o.Width)
		width = ` width="` + w + `" height="` + w + `"`
	}
	t := strconv.Itoa(total)
	return `<svg viewBox="0 0 ` + t + ` ` + t + `"` + width + label + ` shape-rendering="crispEdges"><rect width="` + t + `" height="` + t + `" fill="#fff"/><path d="` + path.String() + `" fill="#000"/></svg>`
}

// TextSvg is the SVG of the QR code for this text (textQrSvg).
func TextSvg(text string, o SvgOptions) (string, error) {
	c, err := Encode(text)
	if err != nil {
		return "", err
	}
	return Svg(c, o), nil
}

func pngChunk(typ string, data []byte) []byte {
	var out bytes.Buffer
	_ = binary.Write(&out, binary.BigEndian, uint32(len(data)))
	out.WriteString(typ)
	out.Write(data)
	_ = binary.Write(&out, binary.BigEndian, crc32.ChecksumIEEE(append([]byte(typ), data...)))
	return out.Bytes()
}

// Png is the PNG bytes of a QR code (qrPng): scale pixels per module (the TypeScript default is 8) and a border of modules (default 4); pass scale 0 and border -1 for the defaults.
func Png(c *Code, scale, border int) ([]byte, error) {
	if scale == 0 {
		scale = 8
	}
	if border < 0 {
		border = 4
	}
	if scale < 1 {
		return nil, errors.New("scale and border must be whole numbers")
	}
	width := (c.Size + 2*border) * scale
	rowBytes := (width + 7) / 8
	raw := bytes.Repeat([]byte{0xff}, (rowBytes+1)*width) // white everywhere
	for py := 0; py < width; py++ {
		row := py * (rowBytes + 1)
		raw[row] = 0 // the row's filter: none
		y := py/scale - border
		for px := 0; px < width; px++ {
			x := px/scale - border
			if y >= 0 && y < c.Size && x >= 0 && x < c.Size && c.Dark[y][x] {
				raw[row+1+px>>3] &^= 0x80 >> uint(px&7) // 0 is black in one-bit greyscale
			}
		}
	}
	header := make([]byte, 13)
	binary.BigEndian.PutUint32(header[0:], uint32(width))
	binary.BigEndian.PutUint32(header[4:], uint32(width))
	header[8] = 1 // bit depth; the other four bytes stay 0 (greyscale, deflate, adaptive filtering, not interlaced)
	var z bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&z, zlib.BestCompression)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	var out bytes.Buffer
	out.Write([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	out.Write(pngChunk("IHDR", header))
	out.Write(pngChunk("IDAT", z.Bytes()))
	out.Write(pngChunk("IEND", nil))
	return out.Bytes(), nil
}

// TextPng is the PNG of the QR code of a text (textQrPng), at the default scale and border.
func TextPng(text string) ([]byte, error) {
	c, err := Encode(text)
	if err != nil {
		return nil, err
	}
	return Png(c, 0, -1)
}
