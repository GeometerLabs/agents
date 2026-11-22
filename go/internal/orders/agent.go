package orders

// The Orders agent: for now a stand-in that takes no event (G2 of wave W4 replaces this file with the Go twin of src/agent.ts). Every event and every beat ends with
// runtime.Unported and the sentence naming it, so the shop starts, answers its health, status and channel reads from its saved state, and its queue says honestly that nothing
// was handled: a task fails at once with the reason (no retries), and nothing is saved by a step that did nothing.

import (
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// agent is one step's agent over the step's state (createAgent). It keeps nothing of its own between steps.
type agent struct {
	kit *Kit
	c   *runtime.StepContext
}

func newAgent(k *Kit, c *runtime.StepContext) *agent { return &agent{kit: k, c: c} }

// Handle is agent.ts handle for one event.
func (a *agent) Handle(ev map[string]any) error {
	return runtime.Unported(fmt.Sprintf("an Orders %v event (the Orders agent is not in Go yet)", ev["kind"]))
}

// Tick is agent.ts handle({kind: "tick"}).
func (a *agent) Tick() error {
	return runtime.Unported("the Orders clock's beat (the Orders agent is not in Go yet)")
}

// GiveUp is agent.ts giveUp.
func (a *agent) GiveUp(ev map[string]any, service string, tell bool) error {
	return runtime.Unported(fmt.Sprintf("giving up on an Orders %v event (the Orders agent is not in Go yet)", ev["kind"]))
}
