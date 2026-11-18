package listings

// A photo the owner uploads: checked by its first bytes (never by the type the phone says), measured, and cleaned of everything that can carry a place or a person (EXIF, XMP,
// IPTC, comments), here, before anything is kept. The Go twin of modules/listings/photo.ts; the cleaned bytes must be the same bytes, because a photo is named by the hash of
// them (`ph-<12 hex>`) and the two runtimes must give a photo the same name.

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
)

const (
	MaxPhotoBytes = 1_500_000
	maxSide       = 4096
)

// PhotoChecked is a photo that passed.
type PhotoChecked struct {
	Type          string
	Width, Height int
	Bytes         []byte
}

// PhotoRefusal is why a photo was refused.
type PhotoRefusal string

var errUnreadable = errors.New("unreadable")

// CheckPhoto reads, measures and cleans an upload.
func CheckPhoto(in []byte) (*PhotoChecked, PhotoRefusal) {
	if len(in) == 0 {
		return nil, "empty"
	}
	if len(in) > MaxPhotoBytes {
		return nil, "too_big"
	}
	switch {
	case len(in) >= 3 && in[0] == 0xff && in[1] == 0xd8 && in[2] == 0xff:
		return cleanJpeg(in)
	case len(in) > 12 && string(in[0:4]) == "RIFF" && string(in[8:12]) == "WEBP":
		return cleanWebp(in)
	}
	return nil, "not_a_photo"
}

func sizeOk(w, h int) bool { return w >= 1 && h >= 1 && w <= maxSide && h <= maxSide }

// keepsSegment says which JPEG segments stay: the frame and tables the image needs, JFIF and a colour profile; not EXIF, XMP, IPTC, other application data or comments.
func keepsSegment(marker byte, body []byte) bool {
	if marker == 0xe0 {
		return true
	}
	if marker == 0xe2 {
		n := len(body)
		if n > 11 {
			n = 11
		}
		return string(body[:n]) == "ICC_PROFILE"
	}
	if marker >= 0xe1 && marker <= 0xef {
		return false
	}
	if marker == 0xfe {
		return false
	}
	return true
}

func cleanJpeg(b []byte) (*PhotoChecked, PhotoRefusal) {
	var kept [][]byte
	width, height := 0, 0
	i := 2
	for {
		if i+4 > len(b) || b[i] != 0xff {
			return nil, "unreadable"
		}
		for i+1 < len(b) && b[i+1] == 0xff {
			i++ // fill bytes
		}
		if i+4 > len(b) {
			return nil, "unreadable"
		}
		marker := b[i+1]
		if marker == 0xd9 {
			return nil, "unreadable" // the end before any image data
		}
		length := int(b[i+2])<<8 | int(b[i+3])
		if length < 2 || i+2+length > len(b) {
			return nil, "unreadable"
		}
		body := b[i+4 : i+2+length]
		if marker == 0xc0 || marker == 0xc1 || marker == 0xc2 {
			if len(body) < 5 {
				return nil, "unreadable"
			}
			height = int(body[1])<<8 | int(body[2])
			width = int(body[3])<<8 | int(body[4])
		}
		if marker == 0xda {
			// the start of the image data: everything from here to the end is the image, copied as it is
			if width == 0 || height == 0 {
				return nil, "unreadable"
			}
			if !sizeOk(width, height) {
				return nil, "too_large_sides"
			}
			out := []byte{0xff, 0xd8}
			for _, k := range kept {
				out = append(out, k...)
			}
			out = append(out, b[i:]...)
			if len(out) < 2 || out[len(out)-2] != 0xff || out[len(out)-1] != 0xd9 {
				return nil, "unreadable" // a cut-off file
			}
			return &PhotoChecked{Type: "image/jpeg", Width: width, Height: height, Bytes: out}, ""
		}
		if keepsSegment(marker, body) {
			kept = append(kept, b[i:i+2+length])
		}
		i += 2 + length
	}
}

type chunk struct {
	id   string
	data []byte
}

func cleanWebp(b []byte) (*PhotoChecked, PhotoRefusal) {
	riff := int(binary.LittleEndian.Uint32(b[4:8]))
	if riff+8 > len(b) || riff < 12 {
		return nil, "unreadable"
	}
	end := riff + 8
	var chunks []chunk
	for i := 12; i+8 <= end; {
		id := string(b[i : i+4])
		size := int(binary.LittleEndian.Uint32(b[i+4 : i+8]))
		if i+8+size > end {
			return nil, "unreadable"
		}
		chunks = append(chunks, chunk{id, b[i+8 : i+8+size]})
		i += 8 + size + size%2
	}
	if len(chunks) == 0 {
		return nil, "unreadable"
	}
	var vp8x *chunk
	var image *chunk
	for i := range chunks {
		c := &chunks[i]
		if c.id == "ANIM" || c.id == "ANMF" {
			return nil, "animated"
		}
		if c.id == "VP8X" && vp8x == nil {
			vp8x = c
		}
		if (c.id == "VP8 " || c.id == "VP8L") && image == nil {
			image = c
		}
	}
	if vp8x != nil && len(vp8x.data) > 0 && vp8x.data[0]&0x02 != 0 {
		return nil, "animated"
	}
	if image == nil {
		return nil, "unreadable"
	}
	d := image.data
	var width, height int
	if image.id == "VP8 " {
		if len(d) < 10 || d[3] != 0x9d || d[4] != 0x01 || d[5] != 0x2a {
			return nil, "unreadable"
		}
		width = int(uint16(d[6])|uint16(d[7])<<8) & 0x3fff
		height = int(uint16(d[8])|uint16(d[9])<<8) & 0x3fff
	} else {
		if len(d) < 5 || d[0] != 0x2f {
			return nil, "unreadable"
		}
		width = 1 + (int(d[2]&0x3f)<<8 | int(d[1]))
		height = 1 + (int(d[4]&0x0f)<<10 | int(d[3])<<2 | int(d[2]&0xc0)>>6)
	}
	if !sizeOk(width, height) {
		return nil, "too_large_sides"
	}
	// keep everything except the chunks that can carry a place or a person; clear the flags that announce them (EXIF 0x08, XMP 0x04)
	var pieces []byte
	for _, c := range chunks {
		if c.id == "EXIF" || c.id == "XMP " {
			continue
		}
		data := append([]byte{}, c.data...)
		if c.id == "VP8X" && len(data) > 0 {
			data[0] &^= 0x08 | 0x04
		}
		head := make([]byte, 8)
		copy(head, c.id)
		binary.LittleEndian.PutUint32(head[4:], uint32(len(data)))
		pieces = append(pieces, head...)
		pieces = append(pieces, data...)
		if len(data)%2 == 1 {
			pieces = append(pieces, 0)
		}
	}
	body := 4 + len(pieces)
	out := make([]byte, 0, 8+body)
	out = append(out, "RIFF"...)
	out = binary.LittleEndian.AppendUint32(out, uint32(body))
	out = append(out, "WEBP"...)
	out = append(out, pieces...)
	return &PhotoChecked{Type: "image/webp", Width: width, Height: height, Bytes: out}, ""
}

// PhotoIDOf names a photo by its own cleaned bytes.
func PhotoIDOf(b []byte) string {
	sum := sha256.Sum256(b)
	return "ph-" + hex.EncodeToString(sum[:])[:12]
}

// Extension is a photo type's file extension in the feed's photo addresses.
var Extension = map[string]string{"image/jpeg": "jpg", "image/webp": "webp"}
