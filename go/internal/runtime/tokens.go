package runtime

// The shop's secret files, read the same way by the single-shop binary (cmd/listings) and the shared host (internal/shared): a token is a FILE, never an argument or a value in
// runtime.json, so it stays out of process lists and git. Moved here from cmd/listings so the two cannot drift apart.

import (
	"fmt"
	"os"
	"strings"
)

const minToken = 16

// ReadToken reads a token file: trimmed, and at least minToken characters.
func ReadToken(file, what string) (string, error) {
	if file == "" {
		return "", ClientError{Msg: "Set INTERNAL_TOKEN_FILE to a file that holds the internal token the inbox sends (for example: openssl rand -hex 32 > token.txt)."}
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", ClientError{Msg: fmt.Sprintf("I could not read the %s file %s.", what, file)}
	}
	t := strings.TrimSpace(string(b))
	if len(t) < minToken {
		return "", ClientError{Msg: fmt.Sprintf("The token in %s is too short to be safe (%d characters; at least %d). Make a new one with: openssl rand -hex 32", file, len(t), minToken)}
	}
	return t, nil
}

// RecordKey reads the record's key: 64 hex digits (32 bytes). With no file named, a shop not in "live" mode has none (nil).
func RecordKey(mode, file string) ([]byte, error) {
	if file == "" {
		if mode == "live" {
			return nil, ClientError{Msg: "Set RECORD_KEY_FILE to a file that holds the record's key: 64 hex digits, made once and kept with the shop's backups (for example: openssl rand -hex 32 > record.key)."}
		}
		return nil, nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, ClientError{Msg: fmt.Sprintf("I could not read the record's key file %s (RECORD_KEY_FILE).", file)}
	}
	hexText := strings.TrimSpace(string(b))
	out := make([]byte, 32)
	if len(hexText) != 64 {
		return nil, ClientError{Msg: fmt.Sprintf("The record's key in %s is not 32 bytes written as hex.", file)}
	}
	for i := 0; i < 32; i++ {
		var v byte
		for _, c := range hexText[i*2 : i*2+2] {
			v <<= 4
			switch {
			case c >= '0' && c <= '9':
				v |= byte(c - '0')
			case c >= 'a' && c <= 'f':
				v |= byte(c-'a') + 10
			case c >= 'A' && c <= 'F':
				v |= byte(c-'A') + 10
			default:
				return nil, ClientError{Msg: fmt.Sprintf("The record's key in %s is not 32 bytes written as hex.", file)}
			}
		}
		out[i] = v
	}
	return out, nil
}
