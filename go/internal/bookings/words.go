package bookings

// The formatters the Bookings words share with the owner's assistant (internal/assistant: the rupee grouping is proved equal to Node's there), so a rupee amount is written one way.

import "github.com/GeometerLabs/agents/go/internal/assistant"

// assistantINR is format.ts formatInr over paise.
func assistantINR(paise int64) string { return assistant.INR(paise) }
