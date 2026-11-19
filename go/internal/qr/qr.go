// Package qr is the QR code encoder of modules/qr (qr.ts, svg.ts, png.ts) in Go: text in byte mode (UTF-8), error-correction level M, versions 1 to 40, the mask chosen by
// the standard's penalty rules (ISO/IEC 18004:2015). It is a line-for-line port so that the matrix, and therefore the SVG text, is byte-for-byte what the TypeScript makes
// (the Go tests compare against vectors the TypeScript produced, scripts/gen_qr_vectors.ts). The only place the two languages differ is the text's bytes: the TypeScript's
// TextEncoder turns a lone surrogate into U+FFFD, and Go's conversion of a string does the same for invalid UTF-8, so a Go string holding valid UTF-8 gives the same bytes.
package qr

import (
	"fmt"
)

// For level M, version 1 to 40 (index 0 is version 1): error-correction codewords per block and the number of blocks. ISO/IEC 18004 table 9.
var ecPerBlockM = [40]int{10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28}
var blocksM = [40]int{1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49}

// Code is an encoded QR code. Dark[y][x] is true for a dark module, row by row from the top left; there is no quiet zone (the picture adds it).
type Code struct {
	Version int
	Size    int // modules on a side: 17 + 4 x version
	Mask    int // the mask used (0 to 7)
	Dark    [][]bool
}

// ---- GF(256) and Reed-Solomon ----

var expTab [512]byte
var logTab [256]byte

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		expTab[i] = byte(x)
		logTab[x] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= 0x11d
		}
	}
	for i := 255; i < 512; i++ {
		expTab[i] = expTab[i-255]
	}
}

func mul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return expTab[int(logTab[a])+int(logTab[b])]
}

// generator is the degree-n generator polynomial, highest power first, the leading 1 left out.
func generator(n int) []byte {
	poly := []byte{1}
	for i := 0; i < n; i++ {
		next := make([]byte, len(poly)+1)
		for j := range poly {
			next[j] ^= poly[j]
			next[j+1] ^= mul(poly[j], expTab[i])
		}
		poly = next
	}
	return poly[1:]
}

func reedSolomon(data []byte, n int) []byte {
	gen := generator(n)
	rem := make([]byte, n)
	for _, b := range data {
		factor := b ^ rem[0]
		copy(rem, rem[1:])
		rem[n-1] = 0
		for i := 0; i < n; i++ {
			rem[i] ^= mul(gen[i], factor)
		}
	}
	return rem
}

// ---- sizes ----

func rawModules(version int) int {
	n := (16*version+128)*version + 64
	if version >= 2 {
		align := version/7 + 2
		n -= (25*align-10)*align - 55
		if version >= 7 {
			n -= 36
		}
	}
	return n
}

func dataCodewords(version int) int {
	return rawModules(version)/8 - ecPerBlockM[version-1]*blocksM[version-1]
}

func countBits(version int) int {
	if version <= 9 {
		return 8
	}
	return 16
}

func segmentBits(version, n int) int { return 4 + countBits(version) + 8*n }

// versionFor is the smallest version (at least minVersion) that holds n bytes at level M, or 0 when none does.
func versionFor(n, minVersion int) int {
	if minVersion < 1 {
		minVersion = 1
	}
	for v := minVersion; v <= 40; v++ {
		if segmentBits(v, n) <= dataCodewords(v)*8 {
			return v
		}
	}
	return 0
}

// ---- codewords ----

func dataCodewordsFor(b []byte, version int) []byte {
	var bits []byte
	put := func(value, length int) {
		for i := length - 1; i >= 0; i-- {
			bits = append(bits, byte((value>>uint(i))&1))
		}
	}
	put(0b0100, 4)
	put(len(b), countBits(version))
	for _, c := range b {
		put(int(c), 8)
	}
	capacity := dataCodewords(version) * 8
	pad := capacity - len(bits)
	if pad < 0 {
		panic("qr: the text does not fit this version")
	}
	if pad > 4 {
		pad = 4
	}
	put(0, pad)
	put(0, (8-len(bits)%8)%8)
	var out []byte
	for i := 0; i < len(bits); i += 8 {
		var n byte
		for _, bit := range bits[i : i+8] {
			n = n<<1 | bit
		}
		out = append(out, n)
	}
	for p := byte(0xec); len(out) < dataCodewords(version); p ^= 0xec ^ 0x11 {
		out = append(out, p)
	}
	return out
}

func finalCodewords(data []byte, version int) []byte {
	blocks := blocksM[version-1]
	ecLen := ecPerBlockM[version-1]
	raw := rawModules(version) / 8
	shortBlocks := blocks - raw%blocks
	shortLen := raw / blocks
	type block struct{ data, ec []byte }
	var split []block
	k := 0
	for i := 0; i < blocks; i++ {
		l := shortLen - ecLen
		if i >= shortBlocks {
			l++
		}
		d := data[k : k+l]
		k += l
		split = append(split, block{d, reedSolomon(d, ecLen)})
	}
	var out []byte
	for i := 0; i <= shortLen-ecLen; i++ {
		for _, b := range split {
			if i < len(b.data) {
				out = append(out, b.data[i])
			}
		}
	}
	for i := 0; i < ecLen; i++ {
		for _, b := range split {
			out = append(out, b.ec[i])
		}
	}
	return out
}

// ---- the matrix ----

func alignmentPositions(version int) []int {
	if version == 1 {
		return nil
	}
	count := version/7 + 2
	size := 17 + 4*version
	step := 26
	if version != 32 {
		// Math.ceil((size - 13) / (count*2 - 2)) * 2 in integers
		d := count*2 - 2
		step = ((size - 13 + d - 1) / d) * 2
	}
	out := []int{6}
	for pos := size - 7; len(out) < count; pos -= step {
		out = append(out[:1], append([]int{pos}, out[1:]...)...)
	}
	return out
}

func formatBits(mask int) int {
	data := mask // level M is 00 in the two high bits
	rem := data
	for i := 0; i < 10; i++ {
		rem = (rem << 1) ^ ((rem >> 9) * 0x537)
	}
	return ((data << 10) | rem) ^ 0x5412
}

func versionBits(version int) int {
	rem := version
	for i := 0; i < 12; i++ {
		rem = (rem << 1) ^ ((rem >> 11) * 0x1f25)
	}
	return (version << 12) | rem
}

type grid struct {
	size        int
	dark, fixed [][]bool
}

func newGrid(size int) *grid {
	g := &grid{size: size, dark: make([][]bool, size), fixed: make([][]bool, size)}
	for i := range g.dark {
		g.dark[i] = make([]bool, size)
		g.fixed[i] = make([]bool, size)
	}
	return g
}

func (g *grid) setFixed(x, y int, dark bool) { g.dark[y][x] = dark; g.fixed[y][x] = true }

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func (g *grid) drawFunctionPatterns(version int) {
	size := g.size
	for i := 0; i < size; i++ {
		g.setFixed(6, i, i%2 == 0)
		g.setFixed(i, 6, i%2 == 0)
	}
	finder := func(cx, cy int) {
		for dy := -4; dy <= 4; dy++ {
			for dx := -4; dx <= 4; dx++ {
				x, y := cx+dx, cy+dy
				if x < 0 || y < 0 || x >= size || y >= size {
					continue
				}
				d := max(abs(dx), abs(dy))
				g.setFixed(x, y, d != 2 && d != 4)
			}
		}
	}
	finder(3, 3)
	finder(size-4, 3)
	finder(3, size-4)
	align := alignmentPositions(version)
	for i := range align {
		for j := range align {
			if (i == 0 && j == 0) || (i == 0 && j == len(align)-1) || (i == len(align)-1 && j == 0) {
				continue
			}
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					g.setFixed(align[i]+dx, align[j]+dy, max(abs(dx), abs(dy)) != 1)
				}
			}
		}
	}
	g.drawFormat(0)
	if version >= 7 {
		bits := versionBits(version)
		for i := 0; i < 18; i++ {
			bit := (bits>>uint(i))&1 == 1
			a, b := size-11+i%3, i/3
			g.setFixed(a, b, bit)
			g.setFixed(b, a, bit)
		}
	}
}

func (g *grid) drawFormat(mask int) {
	bits := formatBits(mask)
	bit := func(i int) bool { return (bits>>uint(i))&1 == 1 }
	size := g.size
	for i := 0; i <= 5; i++ {
		g.setFixed(8, i, bit(i))
	}
	g.setFixed(8, 7, bit(6))
	g.setFixed(8, 8, bit(7))
	g.setFixed(7, 8, bit(8))
	for i := 9; i < 15; i++ {
		g.setFixed(14-i, 8, bit(i))
	}
	for i := 0; i < 8; i++ {
		g.setFixed(size-1-i, 8, bit(i))
	}
	for i := 8; i < 15; i++ {
		g.setFixed(8, size-15+i, bit(i))
	}
	g.setFixed(8, size-8, true)
}

func dataModuleOrder(version int) [][2]int {
	g := newGrid(17 + 4*version)
	g.drawFunctionPatterns(version)
	size := g.size
	var out [][2]int
	for right := size - 1; right >= 1; right -= 2 {
		if right == 6 {
			right = 5
		}
		for vert := 0; vert < size; vert++ {
			for j := 0; j < 2; j++ {
				x := right - j
				y := vert
				if (right+1)&2 == 0 {
					y = size - 1 - vert
				}
				if !g.fixed[y][x] {
					out = append(out, [2]int{x, y})
				}
			}
		}
	}
	return out
}

func (g *grid) drawCodewords(version int, cw []byte) {
	for i, p := range dataModuleOrder(version) {
		if i < len(cw)*8 {
			g.dark[p[1]][p[0]] = (cw[i>>3]>>(7-uint(i&7)))&1 == 1
		}
	}
}

// masks says whether the mask flips the module at (x, y). ISO/IEC 18004 table 10.
func masks(mask, x, y int) bool {
	switch mask {
	case 0:
		return (x+y)%2 == 0
	case 1:
		return y%2 == 0
	case 2:
		return x%3 == 0
	case 3:
		return (x+y)%3 == 0
	case 4:
		return (y/2+x/3)%2 == 0
	case 5:
		return (x*y)%2+(x*y)%3 == 0
	case 6:
		return ((x*y)%2+(x*y)%3)%2 == 0
	case 7:
		return (((x+y)%2)+((x*y)%3))%2 == 0
	}
	panic("qr: no such mask")
}

func (g *grid) applyMask(mask int) {
	for y := 0; y < g.size; y++ {
		for x := 0; x < g.size; x++ {
			if !g.fixed[y][x] && masks(mask, x, y) {
				g.dark[y][x] = !g.dark[y][x]
			}
		}
	}
}

// penalty is the standard's four penalty rules added up (the mask with the lowest total is used).
func penalty(dark [][]bool) int {
	size := len(dark)
	score := 0
	for _, rows := range []bool{true, false} {
		at := func(x, y int) bool {
			if rows {
				return dark[y][x]
			}
			return dark[x][y]
		}
		for a := 0; a < size; a++ {
			run := 1
			for b := 1; b <= size; b++ {
				if b < size && at(b, a) == at(b-1, a) {
					run++
					continue
				}
				if run >= 5 {
					score += 3 + (run - 5)
				}
				run = 1
			}
			for b := 0; b+11 <= size; b++ {
				word := 0
				for k := 0; k < 11; k++ {
					word <<= 1
					if at(b+k, a) {
						word |= 1
					}
				}
				if word == 0b10111010000 || word == 0b00001011101 {
					score += 40
				}
			}
		}
	}
	for y := 0; y+1 < size; y++ {
		for x := 0; x+1 < size; x++ {
			c := dark[y][x]
			if c == dark[y][x+1] && c == dark[y+1][x] && c == dark[y+1][x+1] {
				score += 3
			}
		}
	}
	darkCount := 0
	for _, row := range dark {
		for _, d := range row {
			if d {
				darkCount++
			}
		}
	}
	// Math.floor(Math.abs(darkCount*100/(size*size) - 50) / 5) * 10, kept in integers: |dark*100 - 50*size^2| / (5*size^2), floored
	total := size * size
	diff := abs(darkCount*100 - 50*total)
	score += (diff / (5 * total)) * 10
	return score
}

// Options of EncodeWith: MinVersion (below 1 means 1) and Mask (0 to 7 forces that mask; negative lets the penalty rules choose).
type Options struct {
	MinVersion int
	Mask       int
}

// Encode makes the QR code of text: byte mode (UTF-8), level M, the smallest version, the penalty rules choosing the mask (encodeQr with no options).
// It returns an error when the text is more than a level-M code can hold.
func Encode(text string) (*Code, error) { return EncodeWith(text, Options{Mask: -1}) }

// EncodeWith is encodeQr with its options (for the tests: a forced mask or a larger version).
func EncodeWith(text string, o Options) (*Code, error) {
	b := []byte(text)
	version := versionFor(len(b), o.MinVersion)
	if version == 0 {
		return nil, fmt.Errorf("The text is %d bytes, more than a QR code at level M can hold.", len(b))
	}
	cw := finalCodewords(dataCodewordsFor(b, version), version)
	size := 17 + 4*version
	base := newGrid(size)
	base.drawFunctionPatterns(version)
	base.drawCodewords(version, cw)
	masksToTry := []int{0, 1, 2, 3, 4, 5, 6, 7}
	if o.Mask >= 0 {
		masksToTry = []int{o.Mask}
	}
	var best *grid
	bestMask, bestScore := 0, 0
	for _, m := range masksToTry {
		g := &grid{size: size, dark: make([][]bool, size), fixed: base.fixed}
		for y := range g.dark {
			g.dark[y] = append([]bool(nil), base.dark[y]...)
		}
		g.applyMask(m)
		g.drawFormat(m)
		s := penalty(g.dark)
		if best == nil || s < bestScore {
			best, bestMask, bestScore = g, m, s
		}
	}
	return &Code{Version: version, Size: size, Mask: bestMask, Dark: best.dark}, nil
}
