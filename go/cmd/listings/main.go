// listings runs ONE listings-only shop on its own, for a local try, a test or a small server: the Go twin of templates/commerce/listings/server/main.ts.
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key listings --client <folder>
//
// The folder, the token files and the environment are the TypeScript runtime's, so a shop's folder starts on either. Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes and
// the store is closed.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/testclock"
)

const minToken = 16

func main() {
	args := os.Args[1:]
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> listings --client <folder>")
			return
		}
	}
	if len(args) != 2 || args[0] != "--client" || strings.HasPrefix(args[1], "--") {
		fmt.Fprintln(os.Stderr, "Say which client to run: --client <folder>")
		os.Exit(2)
	}
	if err := run(args[1]); err != nil {
		var ce runtime.ClientError
		if errors.As(err, &ce) {
			fmt.Fprintln(os.Stderr, ce.Error())
		} else {
			fmt.Fprintln(os.Stderr, "The agent could not start: "+err.Error())
		}
		os.Exit(1)
	}
}

func readToken(file, what string) (string, error) {
	if file == "" {
		return "", runtime.ClientError{Msg: "Set INTERNAL_TOKEN_FILE to a file that holds the internal token the inbox sends (for example: openssl rand -hex 32 > token.txt)."}
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", runtime.ClientError{Msg: fmt.Sprintf("I could not read the %s file %s.", what, file)}
	}
	t := strings.TrimSpace(string(b))
	if len(t) < minToken {
		return "", runtime.ClientError{Msg: fmt.Sprintf("The token in %s is too short to be safe (%d characters; at least %d). Make a new one with: openssl rand -hex 32", file, len(t), minToken)}
	}
	return t, nil
}

func run(folder string) error {
	log := func(line string) { fmt.Println(line) }
	client, err := runtime.LoadClient(folder) // refuses a wrong pathway version before anything is opened
	if err != nil {
		return err
	}
	token, err := readToken(os.Getenv("INTERNAL_TOKEN_FILE"), "internal token")
	if err != nil {
		return err
	}
	// never a reason not to start: a shop with no channel token simply has no owner's page
	channelToken := ""
	if f := os.Getenv("CHANNEL_TOKEN_FILE"); f != "" {
		if t, err := readToken(f, "channel token"); err == nil {
			channelToken = t
		} else {
			log("No usable channel token in " + f + " (CHANNEL_TOKEN_FILE): this shop's owner's page is off until the next deploy makes one.")
		}
	}
	key, err := recordKey(client.Config.Mode, os.Getenv("RECORD_KEY_FILE"))
	if err != nil {
		return err
	}
	st, err := store.Open(client.Config.DataDir)
	if err != nil {
		return err
	}
	defer st.Close()
	now := func() int64 { return time.Now().UnixMilli() }
	// the contract tests may run the shop on a TEST clock (internal/testclock says why a real shop never can: a "live" shop refuses to start with one)
	if test, err := testclock.FromEnv(os.Getenv, client.Config.Mode); err != nil {
		return runtime.ClientError{Msg: err.Error()}
	} else if test != nil {
		now = test
	}
	// the shop's own signing key is made here on the first start (or taken from shop-key.json), so it is there before any page asks for it
	if _, err := runtime.LoadShopKey(st, client.Config.DataDir, now(), log); err != nil {
		return err
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return err
		}
		defer acc.Close()
	}
	rt, err := runtime.New(runtime.Options{Client: client, Store: st, Access: acc, Model: runtime.NewModel(client.Config.Talk, log), RecordKey: key, Log: log, Now: now})
	if err != nil {
		return err
	}
	srv, err := runtime.Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick() // any task saved but not finished when the last process stopped runs now
	fmt.Printf("Geometer · Listings only agent (Go) · %s (%s) · %s@%s\n", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}

func recordKey(mode, file string) ([]byte, error) {
	if file == "" {
		if mode == "live" {
			return nil, runtime.ClientError{Msg: "Set RECORD_KEY_FILE to a file that holds the record's key: 64 hex digits, made once and kept with the shop's backups (for example: openssl rand -hex 32 > record.key)."}
		}
		return nil, nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, runtime.ClientError{Msg: fmt.Sprintf("I could not read the record's key file %s (RECORD_KEY_FILE).", file)}
	}
	hexText := strings.TrimSpace(string(b))
	out := make([]byte, 32)
	if len(hexText) != 64 {
		return nil, runtime.ClientError{Msg: fmt.Sprintf("The record's key in %s is not 32 bytes written as hex.", file)}
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
				return nil, runtime.ClientError{Msg: fmt.Sprintf("The record's key in %s is not 32 bytes written as hex.", file)}
			}
		}
		out[i] = v
	}
	return out, nil
}
