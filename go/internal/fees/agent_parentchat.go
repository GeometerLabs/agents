package fees

// W2, a parent's own chat on their private fee page (agent.ts onParentChat, channel.ts parentOfChat), and the public chat's talk (agent.ts onChatTurn's talkToCustomer). Added
// 23 Nov 2026 (go-fees-gaps-23nov); until then Go answered a parent's thread with the public line and never let the shop's talk answer the public chat.
//
// The parent is whoever's page the chat opened from: the thread's conversation is the chat conversation of parentChatHash(parentRef(parent)), so nothing is typed to say who it
// is. The chat talks about THIS parent's own open fees and nothing of another parent's: the shop's talk is given their own open fee as "their child" (publicContext reads the
// parent through parentOfChat), and the fixed answer is the fee line of each open fee (at most three). It never makes a payment link, takes a claim, a waiver or a refund:
// for those the words point to the page's own Pay box; "talk to the owner" tells the owner by the parent's own number and answers in the chat.

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// parentOfChat is channel.ts parentOfChat: the parent whose private-page chat this conversation is, or "".
func (s *Store) parentOfChat(conversation string) string {
	l := s.parentLinks(false)
	if l == nil {
		return ""
	}
	for _, p := range l.Keys {
		if runtime.ChatConversationOf(parentChatHash(ParentRef(p))) == conversation {
			return p
		}
	}
	return ""
}

// chatMoneyKinds are agent.ts onParentChat's `money` kinds: words about paying or the fee go to the fee lines, never to the talk.
var chatMoneyKinds = map[string]bool{"pay": true, "paid": true, "discount": true, "refund": true, "greeting": true, "yes": true, "no": true}

// onParentChat is agent.ts onParentChat.
func (a *Agent) onParentChat(parent, chat string, m messaging.InboundMessage, in intent) error {
	if in.Kind == "owner" {
		return a.onTalkToOwner(parent, chat)
	}
	if !a.takesNewWork() {
		return a.pausedReply(chat, "menu")
	}
	if !chatMoneyKinds[in.Kind] && !m.NoModel && m.Reply == nil && m.Text != "" && a.talkToCustomer(chat, m.Text, in.OverrideAttempt, nil) {
		return nil
	}
	open := a.store.openDues(parent)
	if len(open) == 0 {
		a.tellCustomer(nil, chat, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	if len(open) > 3 {
		open = open[:3]
	}
	for _, d := range open {
		a.tellCustomer(d, chat, []string{"fee_menu"}, sayOpts{offer: &offer{buttons: []string{"owner"}}})
	}
	return nil
}
