package voice

// How long a voice note is, read from the audio itself (modules/voice/ogg.ts, webm.ts): neither Meta's webhook nor the speech service gives a length, and the length is needed for
// the limit and for the cost. Ogg Opus is a WhatsApp voice note (and a recording from Firefox); WebM Opus is a recording from Android's Chrome, which cannot record Ogg. Each reader
// checks the file's own first bytes, so the type a browser claimed decides nothing. Any other kind of file has no length here, and the sender is asked to type.

import (
	"encoding/binary"
	"math"
	"math/bits"
)

var oggMagic = []byte("OggS")

func isPageAt(b []byte, i int) bool {
	return i >= 0 && i+27 <= len(b) && string(b[i:i+4]) == string(oggMagic)
}

// OggOpusSeconds is ogg.ts oggOpusSeconds: the last page's granule position (samples at 48 kHz, RFC 7845) less the header's pre-skip, over 48,000; false when it is not one we can
// read.
func OggOpusSeconds(b []byte) (float64, bool) {
	if !isPageAt(b, 0) {
		return 0, false
	}
	head := 27 + int(b[26])
	if head+12 > len(b) || string(b[head:head+8]) != "OpusHead" {
		return 0, false
	}
	preSkip := int64(b[head+10]) | int64(b[head+11])<<8
	last := -1
	for i := len(b) - 27; i >= 0; i-- { // the last whole page, so a file that ends mid-page still gives its length
		if isPageAt(b, i) {
			last = i
			break
		}
	}
	if last < 0 {
		return 0, false
	}
	granule := binary.LittleEndian.Uint64(b[last+6 : last+14])
	if granule == math.MaxUint64 || granule == 0 { // -1 means "no packet finishes on this page"
		return 0, false
	}
	samples := float64(granule) - float64(preSkip) // `Number(granule) - preSkip`
	if samples <= 0 {
		return 0, false
	}
	return samples / 48_000, true
}

// The EBML element ids webm.ts reads (marker bits kept, as the specification writes them).
const (
	idEBML          = 0x1a45dfa3
	idDocType       = 0x4282
	idSegment       = 0x18538067
	idInfo          = 0x1549a966
	idTimecodeScale = 0x2ad7b1
	idDuration      = 0x4489
	idTracks        = 0x1654ae6b
	idTrackEntry    = 0xae
	idTrackNumber   = 0xd7
	idCodecID       = 0x86
	idCluster       = 0x1f43b675
	idTimecode      = 0xe7
	idSimpleBlock   = 0xa3
	idBlockGroup    = 0xa0
	idBlock         = 0xa1
)

// masters are the containers the walk steps into; every other element is stepped over.
var masters = map[int]bool{idSegment: true, idInfo: true, idTracks: true, idTrackEntry: true, idCluster: true, idBlockGroup: true}

// readID is webm.ts readId: an element's id and its length in bytes.
func readID(b []byte, at int) (id, n int, ok bool) {
	if at >= len(b) || b[at] == 0 {
		return 0, 0, false
	}
	n = bits.LeadingZeros8(b[at]) + 1 // Math.clz32(first) - 23 for a byte
	if n > 4 || at+n > len(b) {
		return 0, 0, false
	}
	for i := 0; i < n; i++ {
		id = id*256 + int(b[at+i])
	}
	return id, n, true
}

// readSize is webm.ts readSize: an element's data size (unknown: every value bit set) and the size field's own length.
func readSize(b []byte, at int) (size int, known bool, n int, ok bool) {
	if at >= len(b) || b[at] == 0 {
		return 0, false, 0, false
	}
	n = bits.LeadingZeros8(b[at]) + 1
	if n > 8 || at+n > len(b) {
		return 0, false, 0, false
	}
	mask := 0xff >> n
	value := int(b[at]) & mask
	allOnes := value == mask
	for i := 1; i < n; i++ {
		value = value*256 + int(b[at+i])
		if b[at+i] != 0xff {
			allOnes = false
		}
	}
	return value, !allOnes, n, true
}

func uintAt(b []byte, at, n int) int {
	v := 0
	for i := 0; i < n; i++ {
		v = v*256 + int(b[at+i])
	}
	return v
}

// opusPacketMs is webm.ts opusPacketMs: one Opus packet's length from its TOC byte (the frame size by configuration, and how many frames).
func opusPacketMs(b []byte, at, end int) (float64, bool) {
	if at >= end {
		return 0, false
	}
	toc := b[at]
	config := int(toc >> 3)
	var frameMs float64
	switch {
	case config < 12:
		frameMs = []float64{10, 20, 40, 60}[config%4]
	case config < 16:
		frameMs = []float64{10, 20}[config%2]
	default:
		frameMs = []float64{2.5, 5, 10, 20}[config%4]
	}
	frames := 0
	switch code := toc & 3; {
	case code == 0:
		frames = 1
	case code < 3:
		frames = 2
	case at+1 < end:
		frames = int(b[at+1] & 0x3f)
	}
	if frames == 0 {
		return 0, false
	}
	return frameMs * float64(frames), true
}

// WebmOpusSeconds is webm.ts webmOpusSeconds: the start of the last Opus block plus its own length (or the Duration element when there are no blocks); false when it is not a WebM
// or Matroska file with an Opus track we can read.
func WebmOpusSeconds(b []byte) (float64, bool) {
	hid, hn, ok := readID(b, 0)
	if !ok || hid != idEBML {
		return 0, false
	}
	hsize, hknown, hsn, ok := readSize(b, hn)
	if !ok || !hknown {
		return 0, false
	}
	headEnd := hn + hsn + hsize
	docType := ""
	for at := hn + hsn; at < headEnd; {
		id, n, ok := readID(b, at)
		if !ok {
			return 0, false
		}
		size, known, sn, ok := readSize(b, at+n)
		if !ok || !known {
			return 0, false
		}
		data := at + n + sn
		if id == idDocType {
			end := min(data+size, len(b))
			if data < end {
				docType = string(b[data:end]) // String.fromCharCode over bytes: the ASCII "webm" or "matroska"
			}
		}
		at = data + size
	}
	if docType != "webm" && docType != "matroska" {
		return 0, false
	}
	scaleNs := 1_000_000.0 // TimecodeScale's default: timecodes in milliseconds
	var durationTicks *float64
	codecs := map[int]string{}
	type trackEntry struct {
		number   int
		hasNum   bool
		codec    string
		hasCodec bool
	}
	var entry *trackEntry
	clusterTicks, hasCluster := 0, false
	lastStart := -1
	lastMs := 0.0
	blocks := 0
	closeEntry := func() {
		if entry != nil && entry.hasNum && entry.hasCodec {
			codecs[entry.number] = entry.codec
		}
		entry = nil
	}
	for at := headEnd; at < len(b); {
		id, n, ok := readID(b, at)
		if !ok {
			break
		}
		size, known, sn, ok := readSize(b, at+n)
		if !ok {
			break
		}
		data := at + n + sn
		if masters[id] {
			if id == idTrackEntry {
				closeEntry()
				entry = &trackEntry{}
			}
			if id == idCluster {
				closeEntry()
				hasCluster = false
			}
			at = data // step in: the children follow
			continue
		}
		if !known {
			break // only containers may have an unknown size
		}
		end := data + size
		switch {
		case id == idTimecodeScale && size <= 8 && end <= len(b):
			if v := uintAt(b, data, size); v != 0 {
				scaleNs = float64(v)
			}
		case id == idDuration && end <= len(b) && (size == 4 || size == 8):
			var d float64
			if size == 4 {
				d = float64(math.Float32frombits(binary.BigEndian.Uint32(b[data:])))
			} else {
				d = math.Float64frombits(binary.BigEndian.Uint64(b[data:]))
			}
			durationTicks = &d
		case id == idTrackNumber && entry != nil && size <= 8 && end <= len(b):
			entry.number, entry.hasNum = uintAt(b, data, size), true
		case id == idCodecID && entry != nil && end <= len(b):
			entry.codec, entry.hasCodec = string(b[data:end]), true
		case id == idTimecode && size <= 8 && end <= len(b):
			closeEntry()
			clusterTicks, hasCluster = uintAt(b, data, size), true
		case (id == idSimpleBlock || id == idBlock) && hasCluster:
			closeEntry()
			track, tknown, tn, tok := readSize(b, data)
			head := data + tn
			limit := min(end, len(b))
			if tok && tknown && head+3 <= limit && (len(codecs) == 0 || codecs[track] == "A_OPUS") {
				rel := int(int16(uint16(b[head])<<8 | uint16(b[head+1]))) // a signed 16-bit offset, as `(b[head] << 24 >> 16) | b[head + 1]`
				laced := b[head+2]&0x06 != 0
				start := clusterTicks + rel
				if start >= lastStart {
					lastStart = start
					lastMs = 20
					if !laced {
						if ms, ok := opusPacketMs(b, head+3, limit); ok {
							lastMs = ms
						}
					}
				}
				blocks++
			}
		}
		at = end
	}
	closeEntry()
	if len(codecs) > 0 {
		opus := false
		for _, c := range codecs {
			opus = opus || c == "A_OPUS"
		}
		if !opus {
			return 0, false
		}
	}
	if blocks > 0 && lastStart >= 0 {
		s := float64(lastStart)*scaleNs/1e9 + lastMs/1000
		if s > 0 && !math.IsInf(s, 0) && !math.IsNaN(s) {
			return s, true
		}
		return 0, false
	}
	if durationTicks != nil && *durationTicks > 0 && !math.IsInf(*durationTicks, 0) {
		return *durationTicks * scaleNs / 1e9, true
	}
	return 0, false
}
