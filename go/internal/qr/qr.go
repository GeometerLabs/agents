// Package qr makes the UPI QR code the owner-marked payment desk shows: the Go twin of modules/qr/{qr.ts, svg.ts, png.ts}. The encoder is written by hand, as the TypeScript is, so the
// program has no dependency: text in byte mode (UTF-8) at error-correction level M, any version 1 to 40, the mask chosen by the standard's penalty rules. It follows ISO/IEC 18004:2015
// (the bit stream 7.4, Reed-Solomon over GF(256) with x^8+x^4+x^3+x^2+1 in 7.5, the block split and interleave 7.6, the function patterns and the data order 7.7, the eight masks and
// four penalty rules 7.8, the format and version information with their BCH codes 7.9 and 7.10), and its matrix is bit-for-bit the TypeScript's: the tests compare the matrices the
// TypeScript made for texts of every size class (testdata/qr-vectors.json).
//
// Level M and byte mode are fixed on purpose, as in the TypeScript: a UPI link is plain ASCII except for a payee name in another script, and level M is what payment QR codes use.
//
// Go and TypeScript differ in one place: TextEncoder turns a lone UTF-16 surrogate into U+FFFD, while a Go string holds bytes as they are. Text that came from JSON or from
// a Go string literal is valid UTF-8, so the bytes are the same; a string with invalid bytes is encoded as its raw bytes.
package qr

import (
	"errors"
	"fmt"
	"math"
)

// ecPerBlockM and blocksM are ISO/IEC 18004 table 9 for level M, version 1 to 40 (index 0 is version 1): the error-correction codewords per block, and the number of blocks.
var ecPerBlockM = [40]int{10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28}
var blocksM = [40]int{1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49}

// levelMBits is level M's two bits in the format information (L = 01, M = 00, Q = 11, H = 10).
const levelMBits = 0

// Code is a QR code: Dark[y][x] is true for a dark module, row by row from the top left, with no quiet zone (the picture adds it).
type Code struct {
	Version int
	// Size is the modules on a side: 17 + 4 * Version.
	Size int
	// Mask is the mask that was used (0 to 7).
	Mask int
	Dark [][]bool
}

// ---- GF(256) and Reed-Solomon ------------------------------------------------------------------------------------------------------

var expTable [512]byte
var logTable [256]byte

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		expTable[i] = byte(x)
		logTable[x] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= 0x11d
		}
	}
	for i := 255; i < 512; i++ {
		expTable[i] = expTable[i-255]
	}
}

func mul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return expTable[int(logTable[a])+int(logTable[b])]
}

// generator is the generator polynomial of degree n, (x - a^0)...(x - a^(n-1)): its coefficients from the highest power down, the leading 1 left out.
func generator(n int) []byte {
	poly := []byte{1}
	for i := 0; i < n; i++ {
		next := make([]byte, len(poly)+1)
		for j := range poly {
			next[j] ^= poly[j]
			next[j+1] ^= mul(poly[j], expTable[i])
		}
		poly = next
	}
	return poly[1:]
}

// ReedSolomon is the n error-correction codewords of these data codewords: the remainder of data * x^n divided by the generator.
func ReedSolomon(data []byte, n int) []byte {
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

// ---- sizes -------------------------------------------------------------------------------------------------------------------------

// rawModules is the modules left for data and error correction once the function patterns are drawn.
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

// DataCodewords is how many data codewords a version holds at level M.
func DataCodewords(version int) int {
	return rawModules(version)/8 - ecPerBlockM[version-1]*blocksM[version-1]
}

func countBits(version int) int {
	if version <= 9 {
		return 8
	}
	return 16
}

// segmentBits are the bits a byte-mode segment of n bytes needs: the mode (4), the count (8 bits up to version 9, 16 above), the bytes.
func segmentBits(version, n int) int { return 4 + countBits(version) + 8*n }

// ByteCapacity is the most bytes a level-M code of this version can carry in byte mode.
func ByteCapacity(version int) int {
	bits := DataCodewords(version)*8 - 4 - countBits(version)
	limit := 65535
	if version <= 9 {
		limit = 255
	}
	if c := bits / 8; c < limit {
		return c
	}
	return limit
}

// VersionFor is the smallest version (at least minVersion) that holds this many bytes at level M, or 0 when none does.
func VersionFor(byteLength, minVersion int) int {
	if minVersion < 1 {
		minVersion = 1
	}
	for v := minVersion; v <= 40; v++ {
		if segmentBits(v, byteLength) <= DataCodewords(v)*8 {
			return v
		}
	}
	return 0
}

// ---- the codewords -----------------------------------------------------------------------------------------------------------------

// dataCodewordsFor is the data codewords for these bytes in this version: mode, count, the bytes, the terminator, then the pad bytes 0xEC 0x11 in turn.
func dataCodewordsFor(b []byte, version int) ([]byte, error) {
	var bits []byte
	put := func(value, length int) {
		for i := length - 1; i >= 0; i-- {
			bits = append(bits, byte(value>>uint(i))&1)
		}
	}
	put(0b0100, 4)
	put(len(b), countBits(version))
	for _, x := range b {
		put(int(x), 8)
	}
	capacity := DataCodewords(version) * 8
	if len(bits) > capacity {
		return nil, errors.New("the text does not fit this version")
	}
	term := capacity - len(bits)
	if term > 4 {
		term = 4
	}
	put(0, term)
	put(0, (8-len(bits)%8)%8)
	var out []byte
	for i := 0; i < len(bits); i += 8 {
		var n byte
		for _, bit := range bits[i : i+8] {
			n = n<<1 | bit
		}
		out = append(out, n)
	}
	for pad := byte(0xec); len(out) < DataCodewords(version); pad ^= 0xec ^ 0x11 {
		out = append(out, pad)
	}
	return out, nil
}

// finalCodewords is the data codewords split into blocks, each with its error correction, interleaved as the standard sends them.
func finalCodewords(data []byte, version int) []byte {
	blocks := blocksM[version-1]
	ecLen := ecPerBlockM[version-1]
	raw := rawModules(version) / 8
	shortBlocks := blocks - raw%blocks
	shortLen := raw / blocks // a short block's length, data and error correction together
	type block struct{ data, ec []byte }
	split := make([]block, 0, blocks)
	k := 0
	for i := 0; i < blocks; i++ {
		n := shortLen - ecLen
		if i >= shortBlocks {
			n++
		}
		d := data[k : k+n]
		k += n
		split = append(split, block{d, ReedSolomon(d, ecLen)})
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

// ---- the matrix --------------------------------------------------------------------------------------------------------------------

// alignmentPositions is where the alignment patterns' centres are, on each axis (annex E).
func alignmentPositions(version int) []int {
	if version == 1 {
		return nil
	}
	count := version/7 + 2
	size := 17 + 4*version
	step := 26
	if version != 32 {
		// Math.ceil((size - 13) / (count * 2 - 2)) * 2
		step = int(math.Ceil(float64(size-13)/float64(count*2-2))) * 2
	}
	out := []int{6}
	for pos := size - 7; len(out) < count; pos -= step {
		out = append(out[:1], append([]int{pos}, out[1:]...)...) // splice(1, 0, pos)
	}
	return out
}

// formatBits is the 15 format bits for level M and a mask: BCH(15,5) with the generator 0x537, then XOR 0x5412.
func formatBits(mask int) int {
	data := levelMBits<<3 | mask
	rem := data
	for i := 0; i < 10; i++ {
		rem = rem<<1 ^ (rem>>9)*0x537
	}
	return (data<<10 | rem) ^ 0x5412
}

// versionBits is the 18 version bits (version 7 and up): BCH(18,6) with the generator 0x1F25.
func versionBits(version int) int {
	rem := version
	for i := 0; i < 12; i++ {
		rem = rem<<1 ^ (rem>>11)*0x1f25
	}
	return version<<12 | rem
}

type grid struct {
	size        int
	dark, fixed [][]bool
}

func matrix(size int) [][]bool {
	m := make([][]bool, size)
	for i := range m {
		m[i] = make([]bool, size)
	}
	return m
}

func emptyGrid(size int) *grid { return &grid{size: size, dark: matrix(size), fixed: matrix(size)} }

func (g *grid) setFixed(x, y int, dark bool) { g.dark[y][x] = dark; g.fixed[y][x] = true }

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func drawFunctionPatterns(g *grid, version int) {
	size := g.size
	for i := 0; i < size; i++ { // timing patterns
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
				d := max2(abs(dx), abs(dy))
				g.setFixed(x, y, d != 2 && d != 4) // dark ring, light ring, dark 3x3 centre, light separator
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
				continue // under a finder
			}
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					g.setFixed(align[i]+dx, align[j]+dy, max2(abs(dx), abs(dy)) != 1)
				}
			}
		}
	}
	drawFormat(g, 0) // reserve the format areas (drawn again with the real mask)
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

func drawFormat(g *grid, mask int) {
	bits := formatBits(mask)
	bit := func(i int) bool { return (bits>>uint(i))&1 == 1 }
	size := g.size
	for i := 0; i <= 5; i++ { // around the top-left finder
		g.setFixed(8, i, bit(i))
	}
	g.setFixed(8, 7, bit(6))
	g.setFixed(8, 8, bit(7))
	g.setFixed(7, 8, bit(8))
	for i := 9; i < 15; i++ {
		g.setFixed(14-i, 8, bit(i))
	}
	for i := 0; i < 8; i++ { // the copy, split between the other two finders
		g.setFixed(size-1-i, 8, bit(i))
	}
	for i := 8; i < 15; i++ {
		g.setFixed(8, size-15+i, bit(i))
	}
	g.setFixed(8, size-8, true) // the dark module
}

// functionModules says which modules of a code of this version are fixed patterns (finders, timing, alignment, format and version areas).
func functionModules(version int) [][]bool {
	g := emptyGrid(17 + 4*version)
	drawFunctionPatterns(g, version)
	return g.fixed
}

// dataModuleOrder is the data modules in the order the bits go into them: two columns at a time from the bottom right, up and down in turn, skipping the timing column and every
// fixed module.
func dataModuleOrder(version int) [][2]int {
	fixed := functionModules(version)
	size := len(fixed)
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
				if !fixed[y][x] {
					out = append(out, [2]int{x, y})
				}
			}
		}
	}
	return out
}

// drawCodewords puts the codewords' bits into the data modules in order; a remainder bit past the last codeword stays light.
func drawCodewords(g *grid, version int, codewords []byte) {
	for i, p := range dataModuleOrder(version) {
		if i < len(codewords)*8 {
			g.dark[p[1]][p[0]] = (codewords[i>>3]>>uint(7-i&7))&1 == 1
		}
	}
}

// maskFlips is whether the mask flips the module at (x, y): ISO/IEC 18004 table 10. All values are non-negative, so Go's % is JavaScript's.
func maskFlips(mask, x, y int) (bool, error) {
	switch mask {
	case 0:
		return (x+y)%2 == 0, nil
	case 1:
		return y%2 == 0, nil
	case 2:
		return x%3 == 0, nil
	case 3:
		return (x+y)%3 == 0, nil
	case 4:
		return (y/2+x/3)%2 == 0, nil
	case 5:
		return (x*y)%2+(x*y)%3 == 0, nil
	case 6:
		return ((x*y)%2+(x*y)%3)%2 == 0, nil
	case 7:
		return ((x+y)%2+(x*y)%3)%2 == 0, nil
	}
	return false, fmt.Errorf("no mask %d", mask)
}

func applyMask(g *grid, mask int) error {
	for y := 0; y < g.size; y++ {
		for x := 0; x < g.size; x++ {
			if g.fixed[y][x] {
				continue
			}
			flip, err := maskFlips(mask, x, y)
			if err != nil {
				return err
			}
			if flip {
				g.dark[y][x] = !g.dark[y][x]
			}
		}
	}
	return nil
}

// penalty is the standard's four penalty rules (7.8.3), added up; the mask with the lowest total is used.
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
			// rule 1: five or more of the same colour in a row: 3, and 1 more for each beyond five
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
			// rule 3: the finder's 1:1:3:1:1 with four light modules on one side: 40 each
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
	// rule 2: each 2x2 block of one colour: 3
	for y := 0; y+1 < size; y++ {
		for x := 0; x+1 < size; x++ {
			c := dark[y][x]
			if c == dark[y][x+1] && c == dark[y+1][x] && c == dark[y+1][x+1] {
				score += 3
			}
		}
	}
	// rule 4: 10 for each full 5% the share of dark modules is away from 50%. The arithmetic is float64 as in JavaScript: Math.floor(Math.abs(dark*100/(size*size) - 50) / 5) * 10.
	darkCount := 0
	for _, row := range dark {
		for _, d := range row {
			if d {
				darkCount++
			}
		}
	}
	score += int(math.Floor(math.Abs(float64(darkCount*100)/float64(size*size)-50)/5)) * 10
	return score
}

// Options is encodeQr's options: MinVersion 0 is 1, and Mask (when not nil) forces one mask, for tests; left out, the penalty rules pick.
type Options struct {
	MinVersion int
	Mask       *int
}

// Encode makes the QR code of a text: byte mode (UTF-8), level M. A text too long for version 40 is an error with the TypeScript's words; a forced mask outside 0 to 7 is
// "no mask N".
func Encode(text string, opt Options) (*Code, error) {
	b := []byte(text)
	version := VersionFor(len(b), opt.MinVersion)
	if version == 0 {
		return nil, fmt.Errorf("The text is %d bytes, more than a QR code at level M can hold.", len(b))
	}
	data, err := dataCodewordsFor(b, version)
	if err != nil {
		return nil, err
	}
	codewords := finalCodewords(data, version)
	size := 17 + 4*version
	base := emptyGrid(size)
	drawFunctionPatterns(base, version)
	drawCodewords(base, version, codewords)
	masks := []int{0, 1, 2, 3, 4, 5, 6, 7}
	if opt.Mask != nil {
		masks = []int{*opt.Mask}
	}
	var best *grid
	bestMask, bestScore := 0, 0
	for _, mask := range masks {
		g := &grid{size: size, dark: matrix(size), fixed: base.fixed}
		for y := range base.dark {
			copy(g.dark[y], base.dark[y])
		}
		if err := applyMask(g, mask); err != nil {
			return nil, err
		}
		drawFormat(g, mask)
		score := penalty(g.dark)
		if best == nil || score < bestScore {
			best, bestMask, bestScore = g, mask, score
		}
	}
	return &Code{Version: version, Size: size, Mask: bestMask, Dark: best.dark}, nil
}
