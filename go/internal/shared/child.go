package shared

// A shop's own process: the quarantine of a shop that kept hurting the shared one. The parent runs `<this binary> --one <shop>`; the child starts that one shop, listens on a loopback
// port of its own and prints one line, `listening <port>`, which the parent reads. A child exits (the operating system then releases whatever it held, which is what a goroutine
// cannot be made to do) on ANY strike: a panic, a request past its deadline, or a step stuck longer than StuckAfter. The parent counts each exit as one failure and starts it again.
// The child never takes part in the routing: the parent forwards to its port, and the shop's own token check still runs in the child.

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type procChild struct {
	cmd      *exec.Cmd
	port     int
	done     chan struct{}
	lifeline io.WriteCloser // never written, closed when the process is gone
}

func (c *procChild) Port() int             { return c.port }
func (c *procChild) Done() <-chan struct{} { return c.done }
func (c *procChild) Stop(grace time.Duration) {
	select {
	case <-c.done:
		return
	default:
	}
	_ = c.cmd.Process.Signal(syscall.SIGTERM)
	if !waitFor(c.done, grace) {
		_ = c.cmd.Process.Kill()
		<-c.done
	}
}

// ExecSpawner runs the same binary with --one. Env carries SHOPS_DIR and SECRETS_DIR through (the child reads the same folders).
type ExecSpawner struct {
	Exe       string
	Env       []string
	Log       func(string)
	StartWait time.Duration
}

// Spawn starts the child and waits for its `listening` line.
func (e ExecSpawner) Spawn(name string) (Child, error) {
	cmd := exec.Command(e.Exe, "--one", name)
	// The pipe on its stdin is the child's lifeline: it stays open as long as this process lives and closes when it dies (even by a fatal fault), and the child, seeing it close,
	// stops itself. Without it a child of a dead host would live on holding the shop's store, and the restarted host would start a second one on the same file.
	cmd.Env = append(append([]string(nil), e.Env...), "SHARED_PARENT_PIPE=1")
	lifeline, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	c := &procChild{cmd: cmd, done: make(chan struct{}), lifeline: lifeline}
	ports := make(chan int, 1)
	go func() {
		defer close(c.done)
		sc := bufio.NewScanner(out)
		for sc.Scan() {
			line := sc.Text()
			if rest, ok := strings.CutPrefix(line, "listening "); ok {
				if p, err := strconv.Atoi(strings.TrimSpace(rest)); err == nil {
					select {
					case ports <- p:
					default:
					}
					continue
				}
			}
			e.Log("[" + name + "] " + line)
		}
		_ = cmd.Wait()
	}()
	wait := e.StartWait
	if wait == 0 {
		wait = 30 * time.Second
	}
	select {
	case c.port = <-ports:
		return c, nil
	case <-c.done:
		return nil, fmt.Errorf("it exited before it was listening")
	case <-time.After(wait):
		_ = cmd.Process.Kill()
		<-c.done
		return nil, fmt.Errorf("it was not listening after %s", wait)
	}
}

// RunOne is the child's main: serve the one shop until a signal, or until it strikes.
func RunOne(src Source, start Starter, name string, lim Limits, log func(string)) error {
	lim = lim.filled()
	if !ShopName.MatchString(name) || !src.Ready(name) {
		return fmt.Errorf("the shop %q is not a complete folder", name)
	}
	die := func(why string) {
		log("EXIT: " + why)
		os.Exit(3) // the operating system releases the store; the parent counts one failure
	}
	var shop Shop
	hooks := Hooks{Log: log, OnPanic: func(where string, v any) { die(fmt.Sprintf("a panic in its %s: %v", where, v)) }}
	shop, err := start(src.Paths(name), hooks)
	if err != nil {
		return err
	}
	g := &guard{inner: shop.Handler(), timeout: lim.RequestTimeout, charge: func(why string) { go func() { time.Sleep(100 * time.Millisecond); die(why) }() }} // after the 503 is out
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: g, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 64 << 10}
	go func() { _ = srv.Serve(ln) }()
	go func() { // its own watchdog: a stuck step cannot be killed, but the process can end
		for range time.Tick(lim.WatchEvery) {
			if since := shop.StepSince(); since > 0 && time.Now().UnixMilli()-since > lim.StuckAfter.Milliseconds() {
				die("its runner has been inside one step too long")
			}
		}
	}()
	fmt.Printf("listening %d\n", ln.Addr().(*net.TCPAddr).Port)
	var parentGone <-chan struct{}
	if os.Getenv("SHARED_PARENT_PIPE") == "1" { // only a child started by a host: a hand-run `--one` has no lifeline
		gone := make(chan struct{})
		parentGone = gone
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); close(gone) }()
	}
	return waitSignal(parentGone, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		shop.Close()
	})
}
