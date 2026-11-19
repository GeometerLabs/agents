// The QR picture of a `upi://pay` link, put where WhatsApp can fetch it: modules/payments/owner-marked/qr-image.ts. WhatsApp does not make a `upi://` link tappable, so the customer
// gets the QR code as an image message (sent by its https address) and the link and the amount as text.
//
//   - On a server (FolderImages): the picture is written under a fresh random folder name into the folder the monthly report's pages are served from (runtime.json `report.pagesDir`,
//     served read-only with no listing at `report.pageBaseUrl`). The name is 128 random bits, so the address cannot be guessed; the picture holds nothing the customer is not sent anyway.
//   - In tests and the hand check (MemoryImages): kept in memory, so a test can read the very bytes that would have been sent.
//
// Where Go differs: the PNG's compressed bytes are not Node's (qr/image.go says why: the same pixels, other zlib bytes); nothing needs them equal.
package ownermarked

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/qr"
)

// ImageMaker makes the picture of this text and hosts it: its https address, or "" when it could not be made (the customer then gets the link as text).
type ImageMaker func(text string) string

// FolderImages is folderQrImages: into a folder served read-only at baseURL (https). log may be nil.
func FolderImages(dir, baseURL string, log func(string)) ImageMaker {
	return func(text string) string {
		fail := func(err error) string {
			if log != nil {
				log(fmt.Sprintf("The UPI QR picture could not be written (%s); the customer gets the link as text.", err.Error()))
			}
			return ""
		}
		tok := make([]byte, 16)
		if _, err := rand.Read(tok); err != nil {
			return fail(err)
		}
		name := hex.EncodeToString(tok)
		png, err := qr.TextPng(text, qr.PngOptions{})
		if err != nil {
			return fail(err)
		}
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			return fail(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name, "upi-qr.png"), png, 0o644); err != nil {
			return fail(err)
		}
		return strings.TrimRight(baseURL, "/") + "/" + name + "/upi-qr.png"
	}
}

// Memory is memoryQrImages: Files maps each address to the PNG bytes behind it.
type Memory struct {
	mu    sync.Mutex
	n     int
	Files map[string][]byte
}

// MemoryImages makes the in-memory maker; Make is its ImageMaker.
func MemoryImages() *Memory { return &Memory{Files: map[string][]byte{}} }

// Make puts the picture of text in memory under the next stand-in address.
func (m *Memory) Make(text string) string {
	png, err := qr.TextPng(text, qr.PngOptions{})
	if err != nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.n++
	link := fmt.Sprintf("https://qr.stand-in/%d/upi-qr.png", m.n)
	m.Files[link] = png
	return link
}
