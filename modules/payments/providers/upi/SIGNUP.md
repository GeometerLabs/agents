# UPI: what a shop needs

- **The shop's own UPI ID** (for example `glowsalon@okicici`) and the name its customers see in their UPI app. Nothing to open, sign or upload: the shop already has it. No gateway account, no KYC with a gateway, no gateway fee.
- **The owner's phone** with WhatsApp, to tap "Received ₹200" after seeing the money in their UPI app, and "Refund sent" after paying a refund back. Nothing confirms a UPI payment automatically without a licensed provider (RBI's merchant-KYC rules apply to every gateway), so this tap is the price of no paperwork.
- **To check before a real shop:** whether the customers' UPI apps accept a prefilled request to a personal UPI ID (some flag an unsigned request; a business UPI ID avoids it), and whether Meta approves a message template carrying a `upi://` link (the QR picture is sent as well, because WhatsApp does not make `upi://` tappable).
- **What Geometer never does:** open, hold or see the shop's account or the customer's money. A UPI ID cannot be checked without paying it, so the panel says so and asks the person to read it back to the owner.
