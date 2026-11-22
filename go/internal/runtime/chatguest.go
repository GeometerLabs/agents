package runtime

// How the owner sees a chat guest (modules/channels/chat-guest.ts): "Chat guest 3", never the conversation's own name ("chat:" and 16 hex digits). The number is given in order at
// the guest's first send and kept in the saved chat state (ChatGuest.N, ChannelState.Guests), so it is the same on the owner's page, in "what needs me", the cards and the shop's
// messages to the owner. The owner answers a guest as "g-3" ("tell chat guest 3 ...", which the rules read as g-3). The words in front of the number are generated
// (gen_chat_words.ts, CHAT_GUEST).

import (
	"regexp"
	"strconv"
)

// GuestRef is chat-guest.ts GUEST_REF: the reference the owner may type for a guest.
var GuestRef = regexp.MustCompile(`^g-(\d{1,6})$`)

// GuestLabel is chat-guest.ts guestLabel: "Chat guest 3" for a chat guest (the words alone when the number is no longer kept), and the conversation itself for anyone else.
func GuestLabel(cs *ChannelState, conversation, lang string) string {
	if !IsChatConversation(conversation) {
		return conversation
	}
	words := chatWords.Guest[lang]
	if words == "" {
		words = chatWords.Guest["en"]
	}
	if cs != nil {
		if g := cs.Guest(conversation); g != nil && g.N != 0 {
			return words + " " + strconv.FormatInt(g.N, 10)
		}
	}
	return words
}

// ConversationOfGuest is chat-guest.ts conversationOfNumber: the conversation of guest number n, when the shop still holds that guest ("" when not).
func ConversationOfGuest(cs *ChannelState, n int64) string {
	found := ""
	if cs != nil {
		cs.EachGuest(func(conversation string, g *ChatGuest) {
			if found == "" && g.N == n {
				found = conversation
			}
		})
	}
	return found
}
