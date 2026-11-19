# qr (Go twin of modules/qr)

What it is: the UPI QR the owner-marked payment desk shows. `qr.go` is the encoder (ISO/IEC 18004, byte mode, level M, versions 1 to 40, hand-written, no dependency), `image.go` the inline SVG and the PNG. The Bookings runtime reaches the TypeScript through `modules/payments/owner-marked/qr-image.ts` (checked with the import graph from `server/main.ts`: `qr.ts`, `svg.ts`, `png.ts` and `qr-image.ts` are all reached), so a Go Bookings runtime needs it.

## Proof

`go/scripts/vectors/qr.ts` runs the TypeScript encoder on 126 texts (UPI links, Devanagari and emoji text, every forced mask, every minimum version, and for each version 1 to 40 the longest text that fits and one byte more) and writes the matrix: the whole matrix as rows of 0/1 for codes up to 45 modules, the SHA-256 of the rows for all. The Go test must give the same version, size, mask and matrix, and the same error words for a text too long or a mask that does not exist. SVG text is compared byte for byte over 44 combinations of 4 texts and 11 option sets (border 0 to 10, a label with `& < > "`, width, an empty label, a negative width).

## PNG: what is identical and what is not

`png.ts` compresses with Node's zlib at level 9. The bytes zlib writes depend on the implementation; Go's `compress/flate` writes other bytes for the same data, and stored (uncompressed) blocks would not match Node's either. So the PNG is the same picture but not the same file: signature, IHDR and IEND are byte-identical, the scanlines before compression (one-bit greyscale, filter byte 0, white pad bits) are byte-identical (compared by length and SHA-256 over 40 combinations of 4 texts and 10 option sets), the IDAT is a valid zlib stream of them, and the test also decodes the PNG with `image/png` and compares every pixel with the code. Nothing needs the files equal: the picture is fetched by WhatsApp from a random address.

## Differences

- `PngOptions.Scale` is a pointer so that an explicit 0 is the TypeScript's error ("scale and border must be whole numbers") and nil is the default 8. A scale or border that is not a whole number cannot be written in Go.
- Go keeps a string's bytes as they are; `TextEncoder` turns a lone surrogate into U+FFFD. JSON-decoded text is valid UTF-8, so the bytes are the same.
