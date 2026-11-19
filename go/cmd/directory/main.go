// The directory of local shops as a service (bundle/services/directory.ts, in Go): internal/directory wired to a port, a database file, a signing key and the network. It runs on Geometer's
// Operator server only, as its own container (`directory`), on the `pages` network (reached by the door, which forwards /search, /order, /feed-changed, /mcp and
// /.well-known/agent-card.json to it) and `egress` (only to read the feeds of servers named in the config's `feeds`). It holds no shop's secret and no shop's data beyond what shops
// publish in their open feeds.
//
// What it keeps, in its own folder (the config's `dataDir`, not in any backup): the index (directory.sqlite, a CACHE rebuilt from the shops' own feeds, THE SAME FILE the TypeScript service
// writes) and its signing key (directory.key, 0600, only for its Agent Card). A feed signed by a key other than the one pinned is HELD and the change is listed for a person:
// `directory changes` lists them, `directory accept <shop page>` accepts one (the shop is read again at once).
//
//	CONFIG=/etc/geometer/directory.json PORT=8799 HOST=0.0.0.0 directory          the service
//	directory changes                                                              the key changes that wait for a person
//	directory accept <shop page>                                                   accept one
//
// Every DIRECTORY_TICK_MS (20 s) it reads the feeds that are due: hinted by a notice (at most once a minute per feed), never read, or not read for six hours.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/directory"
	"github.com/GeometerLabs/agents/go/internal/signing"
)

// config is the directory's config file (bundle/generate/configs.ts directoryConfig writes it).
type config struct {
	Origin   string   `json:"origin"`
	Served   []string `json:"served"`
	DoorURL  string   `json:"doorUrl"`
	DataDir  string   `json:"dataDir"`
	Feeds    []string `json:"feeds"`
	Provider struct {
		Organization string `json:"organization"`
		URL          string `json:"url"`
	} `json:"provider"`
	Area      string `json:"area"`
	Assistant *struct {
		MonthlyMicroInr float64                `json:"monthlyMicroInr"`
		DailyCalls      float64                `json:"dailyCalls"`
		PerBuyerPerDay  float64                `json:"perBuyerPerDay"`
		Model           *directory.ModelConfig `json:"model"`
		AgentTokenFile  string                 `json:"agentTokenFile"`
		Provider        string                 `json:"provider"`
	} `json:"assistant"`
}

func logLine(line string) { fmt.Fprintln(os.Stderr, line) }

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// loadKey is the directory's signing key: read from its folder, or made there on the first start (0600; the folder is its own volume).
func loadKey(dataDir string) (*signing.Key, error) {
	file := filepath.Join(dataDir, "directory.key")
	if b, err := os.ReadFile(file); err == nil {
		return signing.FromText(strings.TrimSpace(string(b)))
	}
	key, text, err := signing.Generate()
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(file, []byte(text+"\n"), 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// assistantFrom is the assistant the config describes, or nil (and a plain line to say why) when it cannot be one. Off is the safe answer.
func assistantFrom(c *config) *directory.Assistant {
	a := c.Assistant
	if a == nil {
		return nil
	}
	bearer := ""
	if a.AgentTokenFile != "" {
		b, err := os.ReadFile(a.AgentTokenFile)
		bearer = strings.TrimSpace(string(b))
		if err != nil || bearer == "" {
			logLine(fmt.Sprintf("directory: the assistant's credential file %s cannot be read or is empty, so the assistant is off", a.AgentTokenFile))
			return nil
		}
	}
	raw := map[string]any{"monthlyMicroInr": a.MonthlyMicroInr, "daily": map[string]any{"buyer": a.DailyCalls}}
	whole := a.PerBuyerPerDay == float64(int64(a.PerBuyerPerDay)) && a.PerBuyerPerDay >= 1
	if !budget.Valid(raw) || !whole {
		logLine("directory: the assistant's budget in the config is not usable, so the assistant is off")
		return nil
	}
	cfg := directory.AssistantConfig{
		Budget:         &budget.Config{MonthlyMicroInr: int64(a.MonthlyMicroInr), Daily: map[string]int64{"buyer": int64(a.DailyCalls)}},
		PerBuyerPerDay: int(a.PerBuyerPerDay), Provider: a.Provider, Bearer: bearer, Log: logLine,
	}
	if a.Model != nil {
		if a.Model.Wire != "openai" {
			logLine(`directory: the assistant's model speaks the "` + a.Model.Wire + `" wire and this service speaks only "openai", so the assistant is off`)
			return nil
		}
		cfg.Model = *a.Model
	}
	return directory.NewAssistant(cfg)
}

func main() {
	file := env("CONFIG", "/etc/geometer/directory.json")
	raw, err := os.ReadFile(file)
	if err != nil {
		log.Fatalf("directory: %v", err)
	}
	var c config
	if err := json.Unmarshal(raw, &c); err != nil {
		log.Fatalf("directory: the config is not JSON: %v", err)
	}
	if err := os.MkdirAll(c.DataDir, 0o700); err != nil {
		log.Fatalf("directory: %v", err)
	}
	index, err := directory.OpenIndex(filepath.Join(c.DataDir, "directory.sqlite"))
	if err != nil {
		log.Fatalf("directory: %v", err)
	}
	defer index.Close()
	// the person's side: list the key changes that wait, or accept one (run beside the service, in its container, through `docker exec`)
	if len(os.Args) > 1 && os.Args[1] == "changes" {
		list := index.KeyChanges()
		if len(list) == 0 {
			fmt.Println("No key change waits.")
		}
		for _, k := range list {
			fmt.Printf("%s  pinned %s  offered %s  seen %s\n", k.Page, k.PinnedKeyID, k.OfferedKeyID, time.UnixMilli(k.SeenAt).UTC().Format("2006-01-02T15:04:05.000Z"))
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "accept" {
		page := ""
		if len(os.Args) > 2 {
			page = os.Args[2]
		}
		if index.AcceptKeyChange(page, time.Now().UnixMilli()) {
			fmt.Println("Accepted: the shop's feed is read again within a minute.")
			return
		}
		fmt.Println("No key change waits for that shop page.")
		os.Exit(1)
	}
	now := time.Now().UnixMilli()
	for _, u := range c.Feeds {
		if directory.FeedAllowed(u, c.Served, c.Feeds) {
			index.AddFeed(u, "config", now)
		} else {
			logLine("directory: " + u + " is not a feed address it will read")
		}
	}
	fetch := directory.NewFetcher(c.Served, c.DoorURL, nil, nil)
	key, err := loadKey(c.DataDir)
	if err != nil {
		log.Fatalf("directory: the signing key: %v", err)
	}
	assistant := assistantFrom(&c)
	card, err := directory.DirectoryCard(directory.CardOptions{Origin: c.Origin, Organization: c.Provider.Organization, ProviderURL: c.Provider.URL, Area: c.Area, Assistant: assistant != nil, Key: key})
	if err != nil {
		log.Fatalf("directory: the card: %v", err)
	}
	handler := directory.NewHandler(directory.HTTPDeps{
		Search: directory.SearchDeps{Index: index, Checker: directory.NewChecker(fetch, nil), Origin: c.Origin}, Origin: c.Origin,
		Card: func() map[string]any { return card }, Served: c.Served, Config: c.Feeds, Assistant: assistant, Log: logLine,
	})
	port, _ := strconv.Atoi(env("PORT", "8799"))
	server := &http.Server{Addr: fmt.Sprintf("%s:%d", env("HOST", "127.0.0.1"), port), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second}
	shops, items := index.Counts()
	logLine(fmt.Sprintf("The directory listens for %s: %d items from %d shops; %d key changes wait for a person.", c.Origin, items, shops, len(index.KeyChanges())))

	// read the feeds that are due: now, then every beat (a hint waits at most that long after its minute; a first read is at once)
	beat := 20_000
	if v, err := strconv.Atoi(os.Getenv("DIRECTORY_TICK_MS")); err == nil && v > 0 {
		beat = v
	}
	stop := make(chan struct{})
	go func() {
		running := false
		tick := func() {
			if running {
				return
			}
			running = true
			defer func() { running = false }()
			done := directory.RefreshDue(directory.ReadDeps{Index: index, Fetch: fetch}, 4)
			// what a person needs to hear: a held shop, a refused feed, a dropped one (a feed address is public; nothing about a buyer is ever here)
			for u, result := range done {
				if result != "held" && result != "refused" && result != "dropped" {
					continue
				}
				extra := ""
				switch result {
				case "held":
					extra = fmt.Sprintf(" (a key change waits for a person: %d in all)", len(index.KeyChanges()))
				case "refused":
					why := "not a good feed"
					if f := index.Feed(u); f != nil && f.Error != nil {
						why = *f.Error
					}
					extra = " (" + why + ")"
				}
				logLine("directory: " + u + " was " + result + extra)
			}
		}
		tick()
		t := time.NewTicker(time.Duration(beat) * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				tick()
			case <-stop:
				return
			}
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		close(stop)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("directory: %v", err)
	}
}
