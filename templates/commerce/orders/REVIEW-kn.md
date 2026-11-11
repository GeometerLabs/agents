# Review sheet: Kannada (kn), Orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Orders agent says or understands in Kannada. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Annapurna Tiffins' (a made-up tiffin service): 2 × veg thali, a total of ₹240, an advance of ₹120.

What to look for first: (1) is each message polite, short and something a food shop would really send; (2) are "advance", "pickup", "delivery", "cut-off", "refund" and "owner" the words people use; (3) is the owner's "approve" / "deny" / "received" left in Latin letters, as the owner types it.

Amounts are always written as ₹1,200 with Western digits; items, quantities, days, times, places and links are filled in from the shop's record, never translated.

## 1. Messages to the customer (54)

| Template id | When it is sent | Text (Kannada) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `menu` | A first hello, or a greeting: the menu with its prices, and the list of items to pick from | ನಮಸ್ಕಾರ! Annapurna Tiffins-ಗೆ ಸ್ವಾಗತ. ನಮ್ಮ ಮೆನು: veg thali ₹120, chicken meal ₹160, curd ₹20. ಏನು ಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ, ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿ ಎಂದು ತಿಳಿಸಿ. | Hello! Welcome to Annapurna Tiffins. Our menu: veg thali ₹120, chicken meal ₹160, curd ₹20. Tell me what you would like, how many, which day, and pickup or delivery. |  |
| `pick_items` | The words above the list of items | ನಮಸ್ಕಾರ! Annapurna Tiffins-ಗೆ ಸ್ವಾಗತ. ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು? | Hello! Welcome to Annapurna Tiffins. What would you like to order? |  |
| `ask_when` | The order has items but no day: which day | ನಿಮ್ಮ 2 × veg thali ಯಾವ ದಿನಕ್ಕೆ ಬೇಕು? | Which day would you like your 2 × veg thali for? |  |
| `ask_how` | The order has no way yet, and the shop delivers: pickup or delivery (two buttons) | ನೀವೇ ಬಂದು ತೆಗೆದುಕೊಳ್ಳುತ್ತೀರಾ, ಅಥವಾ ಡೆಲಿವರಿ ಬೇಕೇ? | Would you like to pick it up, or have it delivered? |  |
| `ask_slot` | The order has a day but no slot: pick a time from the list of slots still open | ಗುರುವಾರ, 12 ನವೆಂಬರ್ ಯಾವ ಸಮಯ? ಕೆಳಗಿನಿಂದ ಒಂದು ಸಮಯ ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ನಿಮಗೆ ಇಷ್ಟವಾದ ಸಮಯ ಬರೆಯಿರಿ. | Which time on Thu 12 Nov? Pick a slot below, or write the time you prefer. |  |
| `ask_address` | A delivery order: where to deliver, and the places the shop delivers to | ಎಲ್ಲಿಗೆ ಡೆಲಿವರಿ ಮಾಡಬೇಕು? ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರದೇಶ ಮತ್ತು ಪೂರ್ಣ ವಿಳಾಸ ಬರೆಯಿರಿ. ನಾವು ಡೆಲಿವರಿ ಮಾಡುವ ಸ್ಥಳಗಳು: Kakkanad, Edappally, Infopark. | Where should we deliver? Please write your area and full address. We deliver to: Kakkanad, Edappally, Infopark. |  |
| `confirm_details` | The customer wrote a weekday: the full date is read back, and they say yes | ಖಚಿತಪಡಿಸಲು: 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್. ಮುಂದುವರಿಯಲು "ಹೌದು" ಎಂದು ಉತ್ತರಿಸಿ. | Just to be sure: 2 × veg thali on Thu 12 Nov. Reply "yes" to continue. |  |
| `confirm_buttons` | The words above the Yes / No buttons of that read-back | ಖಚಿತಪಡಿಸಲು: 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್. ಇದು ಸರಿಯೇ? | Just to be sure: 2 × veg thali on Thu 12 Nov. Is that right? |  |
| `price_floor` | The customer asked for a lower price: the menu price, and no lower | veg thali ಬೆಲೆ ₹120. ಕ್ಷಮಿಸಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ. | Our veg thali is ₹120, and I can't go lower than that. |  |
| `too_many_items` | One order has more items than the shop allows | ಕ್ಷಮಿಸಿ, ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ 10 ವಸ್ತುಗಳು ಮಾತ್ರ. ದಯವಿಟ್ಟು ಚಿಕ್ಕ ಆರ್ಡರ್ ಕಳುಹಿಸಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ. | Sorry, one order can have at most 10 items. Please send a smaller order, or talk to the owner. |  |
| `out_of_stock` | More of an item than is left for the day: how many are left | ಕ್ಷಮಿಸಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್ ಕ್ಕೆ veg thali 3 ಮಾತ್ರ ಉಳಿದಿದೆ. ದಯವಿಟ್ಟು ಆರ್ಡರ್ ಬದಲಿಸಿ, ಅಥವಾ ಬೇರೆ ದಿನ ಆಯ್ಕೆಮಾಡಿ. | Sorry, only 3 veg thali left for Thu 12 Nov. Please change the order, or pick another day. |  |
| `sold_out` | An item is sold out for the day | ಕ್ಷಮಿಸಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್ ಕ್ಕೆ veg thali ಖಾಲಿಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಏನಾದರೂ ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ಬೇರೆ ದಿನ. | Sorry, veg thali is sold out for Thu 12 Nov. Please pick something else, or another day. |  |
| `day_full` | The shop takes no more orders for that day | ಕ್ಷಮಿಸಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್ ಕ್ಕೆ ಇನ್ನು ಆರ್ಡರ್ ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನ ಆಯ್ಕೆಮಾಡಿ. | Sorry, we cannot take any more orders for Thu 12 Nov. Please pick another day. |  |
| `after_cutoff` | Orders for that day and slot have closed: when they closed | ಕ್ಷಮಿಸಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ಆರ್ಡರ್‌ಗಳು ಬುಧವಾರ, 11 ನವೆಂಬರ್, ರಾತ್ರಿ 8:00 ಕ್ಕೆ ಮುಗಿದಿವೆ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನ ಅಥವಾ ಸಮಯ ಆಯ್ಕೆಮಾಡಿ. | Sorry, orders for Thu 12 Nov, 12:00 pm to 1:00 pm closed at Wed 11 Nov, 8:00 pm. Please pick another day or time. |  |
| `outside_area` | A delivery address names no place on the shop's list: the places it delivers to | ಕ್ಷಮಿಸಿ, ಆ ವಿಳಾಸಕ್ಕೆ ನಾವು ಡೆಲಿವರಿ ಮಾಡುವುದಿಲ್ಲ. ನಾವು ಡೆಲಿವರಿ ಮಾಡುವ ಸ್ಥಳಗಳು: Kakkanad, Edappally, Infopark. ಬದಲಿಗೆ ನೀವೇ ಬಂದು ತೆಗೆದುಕೊಳ್ಳಬಹುದು. | Sorry, we do not deliver to that address. We deliver to: Kakkanad, Edappally, Infopark. You can pick up instead. |  |
| `quote_and_link` | The order is held: the items, the day and slot, the total, the advance and the payment link (UPI: with the UPI ID, and the owner confirms) | 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್. ಒಟ್ಟು ₹240. ಖಚಿತಪಡಿಸಲು ₹120 ಇಲ್ಲಿ ಪಾವತಿಸಿ: https://rzp.io/i/example (ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು 30 ನಿಮಿಷ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.) | 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: https://rzp.io/i/example (I'll hold your order for 30 minutes.) |  |
| `already_waiting` | The customer writes again while an order is held: the same link, not a second order | ನಿಮ್ಮ ಆರ್ಡರ್ (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ಖಚಿತಪಡಿಸಲು ₹120 ಪಾವತಿಸಿ: https://rzp.io/i/example | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is held. Pay ₹120 to confirm: https://rzp.io/i/example |  |
| `link_failed` | The payment link could not be made: nothing is ordered, the owner is told | ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನೂ ಆರ್ಡರ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. | Sorry, I couldn't create the payment link just now, so nothing is ordered. I've told the owner. Please try again in a few minutes. |  |
| `order_confirmed` | The payment record shows the advance (Razorpay): the order is confirmed, what is left to pay and the cancellation rule | ಆರ್ಡರ್ ಖಚಿತವಾಗಿದೆ! 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್. ನಿಮ್ಮ ₹120 ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ₹120 ಪಿಕಪ್ ಸಮಯದಲ್ಲಿ ಪಾವತಿಸಬೇಕು. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ 6 ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ. | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. We have received your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `hold_expired` | The hold ended before the advance was recorded | ಮುಂಗಡ ಹಣ ಸಮಯಕ್ಕೆ ಸಿಗದ ಕಾರಣ ನಿಮ್ಮ ಆರ್ಡರ್ (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) ಕಾಯ್ದಿರಿಸಿದ್ದನ್ನು ಬಿಡುಗಡೆ ಮಾಡಲಾಗಿದೆ. ಇನ್ನೂ ಆರ್ಡರ್ ಮಾಡಬೇಕಾದರೆ ನನಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ. | The hold on your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) has ended because the advance was not received in time. Message me if you'd still like to order. |  |
| `stock_gone_refund` | A payment arrived after the hold ended and the stock is gone: it is refunded | ನಿಮ್ಮ ₹120 ಪಾವತಿ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಬಂದಿದೆ, ಮತ್ತು ಗುರುವಾರ, 12 ನವೆಂಬರ್ ಕ್ಕೆ 2 × veg thali ಈಗ ಲಭ್ಯವಿಲ್ಲ. ₹120 ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ. | Your payment of ₹120 arrived after the hold on your order ended, and 2 × veg thali for Thu 12 Nov is no longer available. ₹120 is being refunded to you. |  |
| `cutoff_passed_refund` | A payment arrived after the hold ended and orders have closed: it is refunded | ನಿಮ್ಮ ₹120 ಪಾವತಿ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಬಂದಿದೆ, ಮತ್ತು ಗುರುವಾರ, 12 ನವೆಂಬರ್ ರ ಆರ್ಡರ್‌ಗಳು ಮುಗಿದಿವೆ (ಬುಧವಾರ, 11 ನವೆಂಬರ್, ರಾತ್ರಿ 8:00). ₹120 ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ. | Your payment of ₹120 arrived after the hold on your order ended, and orders for Thu 12 Nov have closed (Wed 11 Nov, 8:00 pm). ₹120 is being refunded to you. |  |
| `refund_unused` | A payment arrived for an order that is no longer active: it is refunded | ನಿಮ್ಮ ₹120 ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಅದಕ್ಕೆ ಈಗ ಯಾವುದೇ ಆರ್ಡರ್ ಇಲ್ಲ. ₹120 ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ. | Your payment of ₹120 arrived, but there is no active order for it. ₹120 is being refunded to you. |  |
| `duplicate_refund` | The advance was paid twice: the extra is refunded | ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ₹120 ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ. | You paid the advance twice. The extra ₹120 is being refunded. |  |
| `duplicate_refund_pending` | The advance was paid twice and the extra is above the refund limit: waiting for the owner | ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ₹120 ಮಾಲೀಕರು ಒಪ್ಪಿದ ನಂತರ ಮರಳಿ ಕೊಡಲಾಗುವುದು. | You paid the advance twice. The extra ₹120 will be refunded once the owner approves. |  |
| `cancelled_refund` | A cancellation inside the window: the advance is refunded | ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ₹120 ಮುಂಗಡ ಹಣ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. Your ₹120 advance is being refunded. |  |
| `cancelled_refund_pending` | A cancellation inside the window with a refund above the limit: waiting for the owner | ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ₹120 ಮರಳಿ ಕೊಡುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ಖಚಿತಪಡಿಸುತ್ತಾರೆ. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will confirm your ₹120 refund shortly. |  |
| `cancelled_late` | A cancellation outside the window: the owner decides about the advance | ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಪ್ರಾರಂಭಕ್ಕೆ 6 ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಸಮಯ ಇರುವುದರಿಂದ, ನಿಮ್ಮ ₹120 ಮುಂಗಡ ಹಣದ ಬಗ್ಗೆ ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿ ನಿಮಗೆ ತಿಳಿಸುತ್ತಾರೆ. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. As it is less than 6 hours before the start, the owner will decide about your ₹120 advance and message you. |  |
| `cancelled_no_advance` | An order cancelled before anything was paid | ಗುರುವಾರ, 12 ನವೆಂಬರ್ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ. | Your order for Thu 12 Nov is cancelled. Nothing was charged. |  |
| `cancelled_draft` | An order dropped before it had a day | ಸರಿ, ಆ ಆರ್ಡರ್ ಅನ್ನು ಬಿಟ್ಟಿದ್ದೇನೆ. ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ. | Okay, I have dropped that order. Nothing was charged. |  |
| `no_order_found` | The customer asked to change or cancel and has no order | ಬದಲಾಯಿಸಲು ಯಾವುದೇ ಆರ್ಡರ್ ಸಿಗಲಿಲ್ಲ. ಏನು ಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ ತಿಳಿಸಿ, ನಾನು ಆರ್ಡರ್ ಮಾಡುತ್ತೇನೆ. | I couldn't find an order to change. Tell me what you'd like, how many and which day, and I'll set it up. |  |
| `refund_approved` | The owner approved the refund | ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. ₹120 ಮರಳಿ ಬರುತ್ತಿದೆ. | The owner approved your refund. ₹120 is on its way. |  |
| `refund_denied` | The owner said no to the refund | ₹120 ಮುಂಗಡ ಹಣವನ್ನು ಮರಳಿ ಕೊಡದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ. | The owner has decided not to refund the ₹120 advance. |  |
| `refund_checking` | A refund could not be sent yet: it is being checked | ನಿಮ್ಮ ₹120 ರೀಫಂಡ್ ಅನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ. ಖಚಿತವಾದ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. | We are checking your ₹120 refund and will message you as soon as it is confirmed. |  |
| `refund_expired` | The owner did not answer a refund request in time: nothing was sent | ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ನಿಮ್ಮ ₹120 ರೀಫಂಡ್ ಬಗ್ಗೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಅದನ್ನು ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು Annapurna Tiffins ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ. | The owner did not answer in time about your ₹120 refund, so it has not been sent. Please contact Annapurna Tiffins directly. |  |
| `big_order_asked` | A big order (above the owner's line) waits for the owner | ನಿಮ್ಮ ಆರ್ಡರ್ (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) ದೊಡ್ಡದಾಗಿದೆ, ಆದ್ದರಿಂದ ಮಾಲೀಕರ ಒಪ್ಪಿಗೆ ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ. | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is a big one, so I have asked the owner to approve it. You will hear back here. |  |
| `big_order_denied` | The owner said no to a big order | ಕ್ಷಮಿಸಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು ಮಾಲೀಕರು ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ. | Sorry, the owner cannot take your order for Thu 12 Nov. Nothing was charged. |  |
| `didnt_understand` | The message was not understood | ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ ತಿಳಿಸಿ. | Sorry, I didn't understand. Please tell me what you would like to order, how many, and which day. |  |
| `voice_note` | A voice note: it cannot be listened to yet, so they are asked to type | ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸಿ; ನನಗೆ ಈಗ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ. | Please type your message; I can't listen to voice notes yet. |  |
| `ask_cancel` | The customer tapped Cancel order: are you sure (Yes / No buttons) | ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದು ಮಾಡಬೇಕೇ? | Do you want to cancel your order for Thu 12 Nov, 12:00 pm to 1:00 pm? |  |
| `kept` | The customer said no to cancelling: the order stays | ಸರಿ, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ಹಾಗೆಯೇ ಇರುತ್ತದೆ. | Okay, your order for Thu 12 Nov, 12:00 pm to 1:00 pm stays as it is. |  |
| `told_owner` | The customer tapped Talk to the owner: the owner has been asked to message them | ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ. | I've told the owner that you would like to talk. They will message you here. |  |
| `couldnt_tell_owner` | The owner could not be told just now | ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. | Sorry, I couldn't reach the owner just now. Please try again in a few minutes. |  |
| `upi_order_confirmed` | UPI shop: the owner marked the advance received: the order is confirmed | ಆರ್ಡರ್ ಖಚಿತವಾಗಿದೆ! 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್. ನಿಮ್ಮ ₹120 ಮುಂಗಡ ಹಣವನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ₹120 ಪಿಕಪ್ ಸಮಯದಲ್ಲಿ ಪಾವತಿಸಬೇಕು. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ 6 ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ. | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. The owner has confirmed your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `upi_qr_caption` | UPI shop: the words under the QR picture | ಆರ್ಡರ್ o-3 ಗಾಗಿ Annapurna Tiffins ಗೆ UPI ಮೂಲಕ ₹120 ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. | Scan to pay ₹120 by UPI to Annapurna Tiffins for order o-3. |  |
| `upi_paid_claim` | UPI shop: the customer says they paid or sends a screenshot (nothing is marked paid) | ಧನ್ಯವಾದ. ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ ₹120 ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪಾವತಿಯ ಪುರಾವೆ ಅಲ್ಲ, ಆದ್ದರಿಂದ ದಯವಿಟ್ಟು ಆ ಸಂದೇಶಕ್ಕಾಗಿ ಕಾಯಿರಿ. | Thank you. The owner will look for your ₹120 payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message. |  |
| `upi_nothing_waiting` | UPI shop: the customer says they paid and no advance is waiting | ಧನ್ಯವಾದ. ಈಗ ನಿಮ್ಮ ಯಾವುದೇ UPI ಪಾವತಿ ಬಾಕಿ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ. ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ದಯವಿಟ್ಟು ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ. | Thank you. No UPI payment is waiting for you just now, so there is nothing for the owner to confirm. If you paid for something else, please talk to the owner. |  |
| `upi_late_received` | UPI shop: the owner marked the advance after the hold ended: the order is not confirmed | ನಿಮ್ಮ ₹120 ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಗುರುವಾರ, 12 ನವೆಂಬರ್ ರ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಖಚಿತಪಡಿಸಿದರು, ಆದ್ದರಿಂದ ಆರ್ಡರ್ ಖಚಿತವಾಗಿಲ್ಲ. ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡುವ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. | The owner confirmed your ₹120 payment after the hold on your order for Thu 12 Nov had ended, so the order is not confirmed. The owner will contact you about ordering again or sending the money back. |  |
| `upi_refund_owed` | UPI shop: a refund the owner will send (the agent never sends it) | ಮಾಲೀಕರು ₹120 ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. | The owner will send ₹120 back to you by UPI. I'll message you when they mark it sent. |  |
| `upi_cancelled_refund_owed` | UPI shop: a cancellation inside the window: the owner will send the refund | ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಮಾಲೀಕರು ನಿಮ್ಮ ₹120 ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will send your ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_extra_refund_owed` | UPI shop: the owner marked more than the advance: the owner will send the extra back | ನೀವು ಮುಂಗಡ ಹಣಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಳುಹಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ₹120 ಅನ್ನು ಮಾಲೀಕರು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. | You paid more than the advance. The owner will send the extra ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_refund_sent` | UPI shop: the owner marked the refund sent (only then is the customer told) | ಆರ್ಡರ್ o-3 ರ ನಿಮ್ಮ ₹120 ರೀಫಂಡ್ ಅನ್ನು UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. | The owner has marked your ₹120 refund for order o-3 as sent by UPI. Please check your UPI app. |  |
| `orders_paused` | The shop's licence is in its wind-down: the answer to a customer who asks to order. No order, no link, nothing kept for later | ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನೇರವಾಗಿ Annapurna Tiffins ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ. | Online ordering is paused for now. Please contact Annapurna Tiffins directly. |  |
| `wait_over` | The shop's system did not answer for 15 minutes from the message (a Guard was down) and the request was not finished: the customer is told so, that the message is on the owner's to-do list, and to write again later or contact the shop. Nothing else is promised | ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ: ಆರ್ಡರ್ ವ್ಯವಸ್ಥೆ ಈಗ ಪ್ರತಿಕ್ರಿಯಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಸಂದೇಶ ಮಾಲೀಕರ ಮಾಡಬೇಕಾದ ಕೆಲಸಗಳ ಪಟ್ಟಿಯಲ್ಲಿದೆ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಬರೆಯಿರಿ, ಅಥವಾ ನೇರವಾಗಿ Annapurna Tiffins ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ. | Sorry, I could not finish your request: the ordering system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact Annapurna Tiffins directly. |  |

## 2. Messages to the owner (37)

Most owner messages are also WhatsApp templates, because they are sent by the agent on its own and WhatsApp then carries only an approved template. Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Kannada) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `owner_order_confirmed` | A pickup order was confirmed: what to prepare, for when, the total, the advance and what to collect | ಹೊಸ ಆರ್ಡರ್ o-3, ಗ್ರಾಹಕರು +919811111111: 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್. ಒಟ್ಟು ₹240, ಮುಂಗಡ ₹120 ಸಿಕ್ಕಿದೆ, ₹120 ಪಡೆಯಬೇಕು. ಈಗ ಏನೂ ಮಾಡಬೇಕಿಲ್ಲ. | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_delivery_confirmed` | A delivery order was confirmed: the same, with the address the customer wrote | ಹೊಸ ಆರ್ಡರ್ o-3, ಗ್ರಾಹಕರು +919811111111: 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್, ವಿಳಾಸ: Flat 4, Lake View Apartments, Kakkanad. ಒಟ್ಟು ₹240, ಮುಂಗಡ ₹120 ಸಿಕ್ಕಿದೆ, ₹120 ಪಡೆಯಬೇಕು. ಈಗ ಏನೂ ಮಾಡಬೇಕಿಲ್ಲ. | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup, address: Flat 4, Lake View Apartments, Kakkanad. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_big_order` | An order above the owner's line: approve or deny, with the order's reference | ಅನುಮತಿ ಬೇಕು: +919811111111 ಅವರಿಗೆ 2 × veg thali ಬೇಕು, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ, ಪಿಕಪ್. ಒಟ್ಟು ₹240. ಪಾವತಿಗೆ ಅನುಮತಿಸಲು "approve o-3" ಎಂದು, ನಿರಾಕರಿಸಲು "deny o-3" ಎಂದು ಉತ್ತರಿಸಿ. | Approval needed: +919811111111 wants 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. Reply "approve o-3" to let them pay, or "deny o-3". |  |
| `owner_order_cancelled` | A confirmed order was cancelled: do not prepare it | ಗ್ರಾಹಕರು +919811111111 ಆರ್ಡರ್ o-3 ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ: 2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ. ದಯವಿಟ್ಟು ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಬೇಡಿ. | Customer +919811111111 cancelled order o-3: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm. Please do not prepare it. |  |
| `owner_late_cancellation` | A cancellation outside the window: approve (refund) or deny (keep), with the order's reference | ಗ್ರಾಹಕರು +919811111111: ಆರ್ಡರ್ o-3 (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) ಪ್ರಾರಂಭಕ್ಕೆ 6 ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ಮುಂಗಡ ₹120. ಹಿಂತಿರುಗಿಸಲು "approve o-3" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny o-3" ಎಂದು ಉತ್ತರಿಸಿ. | Customer +919811111111 cancelled order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) less than 6 hours before the start. Advance ₹120. Reply "approve o-3" to refund it or "deny o-3" to keep it. |  |
| `owner_duplicate_payment` | The advance was paid twice: the extra was refunded | ಗ್ರಾಹಕರು +919811111111: ಆರ್ಡರ್ o-3 (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) — ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ₹120 ಮರಳಿ ಕೊಡಲಾಗಿದೆ. | Customer +919811111111 paid the advance twice for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). The extra ₹120 was refunded. |  |
| `owner_payment_unused` | A payment arrived for an order that could not be taken: it was refunded | ಗ್ರಾಹಕರು +919811111111: ಆರ್ಡರ್ o-3 (ಗುರುವಾರ, 12 ನವೆಂಬರ್) ಗಾಗಿ ₹120 ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಆ ಆರ್ಡರ್ ಆಗ ಚಾಲ್ತಿಯಲ್ಲಿ ಇರಲಿಲ್ಲ (ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು ಮತ್ತು ಮತ್ತೆ ತೆಗೆದುಕೊಳ್ಳಲು ಆಗಲಿಲ್ಲ, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). ₹120 ಮರಳಿ ಕೊಡಲಾಗಿದೆ. | A ₹120 payment from +919811111111 arrived for order o-3 (Thu 12 Nov), but it was no longer active (its hold had ended and it could not be taken again, or it was cancelled). ₹120 was refunded. |  |
| `owner_link_failed` | The payment link for an order could not be made | ಗ್ರಾಹಕರು +919811111111 ಅವರ ಆರ್ಡರ್ o-3 ಗೆ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ಏನೂ ಆರ್ಡರ್ ಆಗಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪಾವತಿ ಖಾತೆಯನ್ನು ನೋಡಿ. | Could not make the payment link for order o-3 from +919811111111. Nothing is ordered. Please check your payment account. |  |
| `owner_message_held` | A message was held back because it did not match the order record | ಗ್ರಾಹಕರು +919811111111: ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಸಂದೇಶ ಆರ್ಡರ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. | A message to +919811111111 was held back because it did not match the order record. Nothing was sent. |  |
| `owner_opted_out` | A customer sent STOP | ಗ್ರಾಹಕರು +919811111111 STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಇನ್ನು ಅವರಿಗೆ ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ. | Customer +919811111111 sent STOP. No more messages will go to them. |  |
| `owner_unknown_command` | The owner's reply was not approve or deny | ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. "approve" ಅಥವಾ "deny" ಎಂದು ಬರೆದು, ನಂತರ ಆರ್ಡರ್ ರೆಫರೆನ್ಸ್ ಬರೆಯಿರಿ. | I didn't understand that. Reply "approve" or "deny" followed by the order reference. |  |
| `owner_wants_to_talk` | A customer tapped Talk to the owner (at most once an hour for the same customer) | ಗ್ರಾಹಕರು +919811111111 ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ. | Customer +919811111111 would like to talk to you. Please message them. |  |
| `owner_ai_allowance` | Button mode, told once a month: the shop's monthly AI allowance is used up | ಸೂಚನೆ: Annapurna Tiffins-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಈಗ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತದೆ. ಆರ್ಡರ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಸಾಮಾನ್ಯ ಸೇವೆ ಮರಳುತ್ತದೆ. | Notice: this month's AI allowance for Annapurna Tiffins is used up, so the agent now answers with buttons and lists. It still takes orders, and every limit still holds. The person who set it up has been told. Normal service returns next month. |  |
| `owner_ai_off` | Button mode, told once: the AI was switched off from outside | ಸೂಚನೆ: Annapurna Tiffins-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಮಾಡಲಾಗಿದೆ. ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಆರ್ಡರ್ ತೆಗೆದುಕೊಳ್ಳುವುದನ್ನು ಮುಂದುವರಿಸುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. | Notice: the AI that reads messages for Annapurna Tiffins has been switched off for now. The agent keeps taking orders with buttons and lists, and every limit still holds. The person who set it up has been told. |  |
| `owner_ai_fault` | Button mode, told at most once a day: a model did not answer, so buttons are used for a few minutes | ಸೂಚನೆ: Annapurna Tiffins-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದೆ. ಆರ್ಡರ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಏಜೆಂಟ್ ಮತ್ತೆ AI ಪ್ರಯತ್ನಿಸುತ್ತದೆ. | Notice: the AI that reads messages for Annapurna Tiffins is not answering right now, so the agent is using buttons and lists. It still takes orders, and every limit still holds. It will try the AI again in a few minutes. |  |
| `owner_refund_needs_approval` | A refund above the limit waits for the owner's one-use code (sent by the approvals relay, never by the agent) | ಅನುಮತಿ ಬೇಕು: +919811111111 (ಆರ್ಡರ್ o-3, ಗುರುವಾರ, 12 ನವೆಂಬರ್) ಅವರಿಗೆ ₹120 ರೀಫಂಡ್. 24 ಗಂಟೆಯೊಳಗೆ "approve K7M2QX" ಅಥವಾ "deny K7M2QX" ಎಂದು ಉತ್ತರಿಸಿ. | Approval needed: refund ₹120 for +919811111111 (order o-3, Thu 12 Nov). Reply "approve K7M2QX" or "deny K7M2QX" within 24 hours. |  |
| `owner_approval_done` | The owner approved with the code: the refund is being sent | ಧನ್ಯವಾದ. ಗ್ರಾಹಕರು +919811111111: ₹120 ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು. | Thank you. The ₹120 refund for +919811111111 is being sent, and they will be told. |  |
| `owner_approval_denied` | The owner denied with the code: nothing is sent | ಅರ್ಥವಾಯಿತು. ಗ್ರಾಹಕರು +919811111111: ₹120 ರೀಫಂಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು. | Understood. The ₹120 refund for +919811111111 will not be sent, and they will be told. |  |
| `owner_approval_expired` | The owner answered after the request had run out: nothing was refunded | ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಆ ವಿನಂತಿಯ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಮರಳಿ ಕೊಟ್ಟಿಲ್ಲ: ಗ್ರಾಹಕರು +919811111111, ₹120. | That request ran out before you answered, so nothing was refunded: ₹120 for +919811111111. |  |
| `owner_approval_failed` | The owner's answer could not be recorded just now: send it again | ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಈಗ ದಾಖಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕಳುಹಿಸಿ. | I could not record your answer just now. Please send it again in a few minutes. |  |
| `owner_approval_waiting` | A refund needs several people: this person's approval is in and more are needed | ಧನ್ಯವಾದ. +919811111111 ಅವರ ₹120 ರೀಫಂಡ್‌ಗೆ ನಿಮ್ಮ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ. ಇನ್ನೂ ಇತರರಿಂದ ಬೇಕಾದ ಅನುಮತಿಗಳು: 1. ಅವು ಸಿಕ್ಕ ನಂತರವೇ ಇದನ್ನು ಕಳುಹಿಸಲಾಗುವುದು. | Thank you. Your approval of the ₹120 refund for +919811111111 is recorded. Approvals still needed from the others: 1. It is sent only once they are given. |  |
| `owner_approval_closed` | A refund needs several people: the others approved it, so this person's answer is no longer needed | ಸೂಚನೆ: +919811111111 ಅವರ ₹120 ರೀಫಂಡ್‌ಗೆ ಇತರರು ಅನುಮತಿ ನೀಡಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಈಗ ನಿಮ್ಮ ಉತ್ತರ ಬೇಕಿಲ್ಲ. ಧನ್ಯವಾದ. | The ₹120 refund for +919811111111 has been approved by the others, so your answer is no longer needed. Thank you. |  |
| `owner_approval_refused` | A refund needs several people: one of them refused it, so it is not sent | ಸೂಚನೆ: +919811111111 ಅವರ ₹120 ರೀಫಂಡ್ ಅನ್ನು ಅನುಮತಿ ನೀಡುವವರಲ್ಲಿ ಒಬ್ಬರು ನಿರಾಕರಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು. | The ₹120 refund for +919811111111 was refused by one of the people who approve refunds, so it will not be sent, and they will be told. |  |
| `owner_refund_settled` | A person at the server checked an uncertain refund and marked it as made: it is done and not sent again | ರೀಫಂಡ್ ಆಗಿದೆ: +919811111111 ಅವರ ₹120. ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ಪರಿಶೀಲಿಸಿ ಆಗಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ. | Refund done: ₹120 for +919811111111. The person who set up your agent checked it and marked it as made, so it is not sent a second time. |  |
| `owner_upi_expected` | UPI shop: tells the owner what payment to look for in their UPI app, with the one-use code | ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ಗ್ರಾಹಕರು +919811111111 ಆರ್ಡರ್ o-3 (2 × veg thali, ಗುರುವಾರ, 12 ನವೆಂಬರ್, ಮಧ್ಯಾಹ್ನ 12:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ವರೆಗೆ) ಗಾಗಿ ₹120 ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received P4XR9T" ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ. | UPI payment to check: customer +919811111111 will pay the ₹120 advance for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). When it shows in your UPI app, tap Received or reply "received P4XR9T". If a different amount came, reply "received P4XR9T" and the amount. |  |
| `owner_upi_claim` | UPI shop: the customer says they paid (a screenshot is not proof): the owner is asked to look | ಗ್ರಾಹಕರು +919811111111 ಆರ್ಡರ್ o-3 ರ ₹120 ಮುಂಗಡ ಹಣ ಕಳುಹಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಹಣ ಇದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. | Customer +919811111111 says they have paid the ₹120 advance for order o-3. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received P4XR9T". |  |
| `owner_upi_marked` | UPI shop: the answer to the owner's Received, the order confirmed | ಧನ್ಯವಾದ. ಆರ್ಡರ್ o-3 ರ ₹120 ಬಂದಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ್ದೀರಿ. | Thank you. ₹120 for order o-3 is marked paid by you. |  |
| `owner_upi_part` | UPI shop: the answer to the owner's Received, part paid, with the code for the rest | ಆರ್ಡರ್ o-3 ಗೆ ನೀವು ₹120 ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದರೆ ಮುಂಗಡ ಹಣ ₹120, ಆದ್ದರಿಂದ ಇನ್ನೂ ಖಚಿತವಾಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಆರ್ಡರ್ ಕಾಯ್ದಿರುತ್ತದೆ. ಉಳಿದ ₹100 ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. | You marked ₹120 for order o-3, but the advance is ₹120, so it is not confirmed yet. The order stays held until the hold ends. When the other ₹100 arrives, tap Received or reply "received P4XR9T". |  |
| `owner_upi_already` | UPI shop: the owner used a code that was already used: counted once | ಆ ಪಾವತಿ ಈಗಾಗಲೇ ದಾಖಲಾಗಿದೆ. ಅದನ್ನು ಒಂದೇ ಬಾರಿ ಎಣಿಸಲಾಗುತ್ತದೆ. | That payment is already marked. It is counted once. |  |
| `owner_upi_unknown` | UPI shop: the owner used a code the agent never gave | ಆ ಕೋಡ್ ನನಗೆ ಗೊತ್ತಿಲ್ಲ. ಆ ಪಾವತಿಯ ಬಗ್ಗೆ ನನ್ನ ಇತ್ತೀಚಿನ ಸಂದೇಶದಲ್ಲಿರುವ ಕೋಡ್ ಬಳಸಿ. | I don't know that code. Please use the code in my latest message about the payment. |  |
| `owner_upi_late` | UPI shop: the owner marked the advance after the hold ended: take the order by hand or send the money back | ಆರ್ಡರ್ o-3 ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದ ನಂತರ ನೀವು ₹120 ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದ್ದರಿಂದ ಅದು ತಾನಾಗಿ ಮತ್ತೆ ಖಚಿತವಾಗಲಿಲ್ಲ. ಗ್ರಾಹಕರು +919811111111 ಅವರ ಆರ್ಡರ್ ಅನ್ನು ನೀವೇ ಮತ್ತೆ ತೆಗೆದುಕೊಳ್ಳಿ, ಅಥವಾ ₹120 ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸಿ. ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಅಥವಾ "ಆರ್ಡರ್‌ಗೆ ಇಟ್ಟಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded P4XR9T" ಅಥವಾ "kept P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. | You marked ₹120 received for order o-3 after its hold had ended, so it was not confirmed again by itself. Take customer +919811111111's order again yourself, or send the ₹120 back by UPI. Then tap Refund sent or Kept for order, or reply "refunded P4XR9T" or "kept P4XR9T". |  |
| `owner_upi_refund_owed` | UPI shop: a refund the owner must send from their UPI app, with the code | ಮರಳಿ ಕಳುಹಿಸಬೇಕು: ಗ್ರಾಹಕರು +919811111111 (ಆರ್ಡರ್ o-3) ಅವರಿಗೆ UPI ಮೂಲಕ ₹120. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. | Refund to send: customer +919811111111 (order o-3) is owed ₹120 by UPI. The agent never sends money. After you send it, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_reminder` | UPI shop: a reminder of a refund still owed (once a day, three times at most) | ನೆನಪಿಸುವುದು: ಗ್ರಾಹಕರು +919811111111 (ಆರ್ಡರ್ o-3) ಅವರಿಗೆ ₹120 ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded P4XR9T" ಎಂದು ಉತ್ತರಿಸಿ. | Reminder: customer +919811111111 (order o-3) is still owed ₹120. After you send it by UPI, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_marked` | UPI shop: the answer to the owner's Refund sent | ಧನ್ಯವಾದ. ಆರ್ಡರ್ o-3 ರ ₹120 ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಾಗಿದೆ, ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. | Thank you. The ₹120 refund for order o-3 is marked sent, and the customer has been told. |  |
| `owner_upi_refund_kept` | UPI shop: the owner kept the money for an order they take by hand | ಸರಿ. ಆರ್ಡರ್ o-3 ರ ₹120 ಅನ್ನು ನೀವೇ ತೆಗೆದುಕೊಳ್ಳುವ ಆರ್ಡರ್‌ಗಾಗಿ ಇಡಲಾಗಿದೆ. ಇನ್ನು ಏನನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿಲ್ಲ. | Okay. The ₹120 for order o-3 is kept for an order you take by hand. Nothing more is owed back. |  |
| `owner_licence_paused` | The one notice to the owner when the licence winds down: online ordering is paused, who to contact. Never about money | ಸೂಚನೆ: Annapurna Tiffins-ನ ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಿರುವ ಆರ್ಡರ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ. ಈ ಬಗ್ಗೆ ದಯವಿಟ್ಟು Divya, Sri Sai Digital ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ. | Notice: online ordering for Annapurna Tiffins is paused for now. Existing orders, cancellations and refunds still go through. Please contact Divya, Sri Sai Digital. |  |
| `owner_licence_stopped` | The one notice to the owner at the licence's final stop: the partner's service has ended, what is still open, and that hello@geometer.dev will connect the owner with another local partner | ಸೂಚನೆ: Annapurna Tiffins-ನ ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ನಿಂತಿದೆ, ಏಕೆಂದರೆ Divya, Sri Sai Digital ನೀಡುತ್ತಿದ್ದ ಸೇವೆ ಮುಗಿದಿದೆ. ಮುಂದಿನ ಆರ್ಡರ್‌ಗಳು: 4. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಇದನ್ನು ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ. | Notice: online ordering for Annapurna Tiffins has stopped, because the service from Divya, Sri Sai Digital has ended. Orders still to come: 4. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you. |  |

### The words on the buttons and the lists

Some of the messages above come with buttons (up to 3, each 20 letters at most) or a list that the customer taps instead of typing. A label never carries an amount or a date.

| Id | Text (Kannada) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `yes` | ಹೌದು | Yes |  |
| `no` | ಇಲ್ಲ | No |  |
| `owner` | ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತು | Talk to the owner |  |
| `cancel` | ಆರ್ಡರ್ ರದ್ದು | Cancel order |  |
| `cancelYes` | ಹೌದು, ರದ್ದು | Yes, cancel |  |
| `keep` | ಹಾಗೇ ಇರಲಿ | No, keep it |  |
| `pickItem` | ವಸ್ತು ಆಯ್ಕೆಮಾಡಿ | Pick an item |  |
| `pickTime` | ಸಮಯ ಆಯ್ಕೆಮಾಡಿ | Pick a time |  |
| `pickup` | ಪಿಕಪ್ | Pickup |  |
| `delivery` | ಡೆಲಿವರಿ | Delivery |  |
| `paid` | ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ | I have paid |  |
| `received` | ಬಂದಿದೆ | Received |  |
| `refundSent` | ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ | Refund sent |  |
| `keptForBooking` | ಆರ್ಡರ್‌ಗೆ ಇಟ್ಟಿದೆ | Kept for order |  |

## 3. Dates as the agent writes them

| Weekday | Written in Kannada | Native reviewer: OK / change to … |
| --- | --- | --- |
| Sunday | ಭಾನುವಾರ |  |
| Monday | ಸೋಮವಾರ |  |
| Tuesday | ಮಂಗಳವಾರ |  |
| Wednesday | ಬುಧವಾರ |  |
| Thursday | ಗುರುವಾರ |  |
| Friday | ಶುಕ್ರವಾರ |  |
| Saturday | ಶನಿವಾರ |  |

| Month | Written in Kannada | Native reviewer: OK / change to … |
| --- | --- | --- |
| January | ಜನವರಿ |  |
| February | ಫೆಬ್ರವರಿ |  |
| March | ಮಾರ್ಚ್ |  |
| April | ಏಪ್ರಿಲ್ |  |
| May | ಮೇ |  |
| June | ಜೂನ್ |  |
| July | ಜುಲೈ |  |
| August | ಆಗಸ್ಟ್ |  |
| September | ಸೆಪ್ಟೆಂಬರ್ |  |
| October | ಅಕ್ಟೋಬರ್ |  |
| November | ನವೆಂಬರ್ |  |
| December | ಡಿಸೆಂಬರ್ |  |

Dates are written weekday, day, month ("ಗುರುವಾರ, 12 ನವೆಂಬರ್"); a time window is written "from … to …" with the part of the day before each time.

## 4. Item names in the example shop (Annapurna Tiffins)

| Item | Names in Kannada (the first is what the agent says; the rest are what customers may call it) | Native reviewer: OK / change to … |
| --- | --- | --- |
| veg thali | (the example shop writes English and Hindi: this item has no name in this language) |  |
| chicken meal | (the example shop writes English and Hindi: this item has no name in this language) |  |
| curd | (the example shop writes English and Hindi: this item has no name in this language) |  |

## 5. What the agent understands from a customer

Words in Latin letters are how people type the language on WhatsApp. They are listed in one row, with the English ones, because the lists are shared by the languages.

| Meaning | English | Words and phrases (Kannada letters first, then the Latin letters people type it in) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| an order (words that mean the customer wants something) | order, want, need | ಬುಕ್ · ಬುಕಿಂಗ್ · ಅಪಾಯಿಂಟ್ಮೆಂಟ್ · ಬೇಕು · ಬೇಕಾಗಿದೆ · ಬೇಕಿತ್ತು — Latin letters: order · orders · want · need · get me · send · book · tiffin · i'd like · i would like · chahiye · chahie · bhej do · mangwana · venam · beku · bekittu |  |
| pickup | pickup, collect, take away | ಪಿಕಪ್ · ಪಿಕ್ ಅಪ್ · ನಾನೇ ಬಂದು — Latin letters: pickup · pick up · pick-up · collect · takeaway · take away · take-away · come and take · aake le · lene aunga · lene aaunga |  |
| delivery | delivery, deliver | ಡೆಲಿವರಿ · ಮನೆಗೆ ತಲುಪಿಸ · ತಲುಪಿಸ — Latin letters: deliver · delivery · home delivery · send it to · bhej do · bhejna · pahuncha |  |
| I have paid (a claim; checked against the payment record, never believed on its own) | paid, I have paid | ಪಾವತಿಸಿದ್ದೇನೆ · ಪಾವತಿಸಿದೆ · ಹಣ ಕಳುಹಿಸಿದ್ದೇನೆ · ಪಾವತಿ ಮಾಡಿದ್ದೇನೆ — Latin letters: paid · i paid · i have paid · have paid · payment done · payment made · sent the money · money sent · transferred · paid it · advance paid · bhar diya · pay kar diya · payment kar diya · paid kar diya · de diya · paise bhej diye · adachu · payment cheythu · paid aanu · paavatisiddene · payment madide |  |
| money back | refund, money back | ರೀಫಂಡ್ · ಮರುಪಾವತಿ · ವಾಪಸ್ — Latin letters: refund · refunded · money back · give back · return my money · get back my money · paise wapas · wapas |  |
| talk to the owner | owner, talk to | ಮಾಲೀಕ · ಮಾತನಾಡ · ಕರೆ ಮಾಡಿ — Latin letters: owner · talk to · call me · speak to · manager · malik |  |
| a quantity in words (one to ten in English and Hindi, one to five in Malayalam and Kannada) | one, two, three | ಒಂದು · ಎರಡು · ಮೂರು · ನಾಲ್ಕು · ಐದು — Latin letters: one · two · three · four · five · six · seven · eight · nine · ten · ek · teen · char · chaar · paanch · panch · chhe · chhah · saat · aath · nau · das · onnu · randu · moonnu · munnu · naalu · anchu · ondu · eradu · mooru · naalku · aidu |  |
| yes (exact) | yes | ಹೌದು · ಸರಿ · ಸರಿಯಾಗಿದೆ · ಓಕೆ · ಒಪ್ಪಿಗೆ · ಆಯ್ತು · ಆಗಲಿ · houdu · sari · aytu · ayithu · agali |  |
| no (exact) | no | ಬೇಡ · ಇಲ್ಲ · ಅಲ್ಲ · beda · illa · alla |  |
| hello (exact) | hello | ನಮಸ್ಕಾರ · ಹಲೋ · ಹಾಯ್ · namaskara |  |
| cancel | cancel | ರದ್ದು · ರದ್ದುಗೊಳಿಸಿ · ರದ್ದು ಮಾಡಿ · ಕ್ಯಾನ್ಸಲ್ · ಕ್ಯಾನ್ಸೆಲ್ · raddu |  |
| STOP, on its own or in a few words (exact) | stop | ಸ್ಟಾಪ್ · ನಿಲ್ಲಿಸಿ · ನಿಲ್ಲಿಸು |  |
| STOP, as a phrase (the start; the last word may continue) | stop the messages | ಮೆಸೇಜ್ ನಿಲ್ಲಿಸ · ಸಂದೇಶ ನಿಲ್ಲಿಸ · ಮೆಸೇಜ್ ಬೇಡ · ಸಂದೇಶ ಬೇಡ · ಮೆಸೇಜ್ ಕಳುಹಿಸಬೇಡ · message beda · message nillisi |  |
| rupee, after an amount: "200 …" | rupees | ರೂಪಾಯಿ · ರೂ · rupayi · rupayige · ruppayi |  |
| "rules", near a word for "forget" (a trick) | rules, instructions | ನಿಯಮ · ನಿರ್ದೇಶನ · ಸೂಚನೆ |  |
| "forget", near a word for "rules" (a trick) | forget, ignore, break | ಮರೆ · ಮರೆತ · ನಿರ್ಲಕ್ಷಿಸ · ಉಲ್ಲಂಘಿಸ · ಬಿಡ |  |
| Latin-letter words that show the customer writes Kannada | (language hints) | indu · ivattu · gante · gantege · beku · bekagilla · madi · maadi · houdu · sari · aytu · naadiddu · sanje · belagge · mundina · beda · naanu · nanage · nimma · madtira · maaditira |  |

The shop's own item names and its slot names ("lunch", "dinner") are the shop's settings, written by the person who sets the shop up: they are not in this list.

### Whole sentences, and what the agent reads from them

| Customer writes | Meaning | The agent reads | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| ನಾಳೆ 2 veg thali ಪಿಕಪ್ | 2 veg thali tomorrow, pickup | order, items 2×veg-thali, pickup |  |
| ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ | I paid | paid |  |
| ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿ | Cancel my order | cancel |  |
| ನನಗೆ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಬೇಕು | I want to talk to the owner | owner |  |
| ರೀಫಂಡ್ ಬೇಕು | I want a refund | refund |  |
| ಮೆಸೇಜ್ ನಿಲ್ಲಿಸಿ | Stop the messages | stop |  |

## 6. The monthly report

The owner's monthly text is five short lines of "label: number". Every number, amount and date is counted from the record and written by the same formatters as the messages; only the words around them are below.

### The five lines, with sample numbers

```text
Annapurna Tiffins · ಫೆಬ್ರವರಿ 2027 · ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ
ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ಮುಂಗಡ: ₹24,000 · ಪಿಕಪ್‌ನಲ್ಲಿ ಪಡೆಯಬೇಕಾದದ್ದು: ₹9,000 (ಆರ್ಡರ್‌ಗಳು: 6) · ಮಾಲೀಕರು ಕಳುಹಿಸಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ರೀಫಂಡ್: ₹600
ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು: 41 · ರದ್ದಾದವು: 3 · ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು: 3 · ನೀವು ಒಪ್ಪಿದ್ದು: 2 · ನೀವು ಬೇಡ ಎಂದದ್ದು: 1
ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು: 7 (ದಿನದ ಸ್ಟಾಕ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು: 3 · ಕಟ್-ಆಫ್ ನಂತರದ ಆರ್ಡರ್‌ಗಳು: 2 · ಡೆಲಿವರಿ ಪ್ರದೇಶದ ಹೊರಗಿನ ವಿಳಾಸಗಳು: 1 · …)
ಪರಿಶೀಲಿಸದ್ದು: ಪಿಕಪ್‌ನಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ · ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ (UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ನೀವು ದಾಖಲಿಸುತ್ತೀರಿ) · ನಿಜವಾದ WhatsApp · ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ · ಇನ್ನೂ 16 ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ). ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.
```

### The monthly report on WhatsApp, with sample numbers

```text
ಮಾಸಿಕ ವರದಿ: Annapurna Tiffins · ಫೆಬ್ರವರಿ 2027
ಸಂಗ್ರಹವಾದ ಮುಂಗಡ: ₹24,000 · ಮರಳಿ ಕೊಟ್ಟದ್ದು: ₹600 · ಪಿಕಪ್‌ನಲ್ಲಿ ಪಡೆಯಬೇಕಾದದ್ದು: ₹9,000 (ಆರ್ಡರ್‌ಗಳು: 6)
ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು: 41 · ರದ್ದಾದವು: 3
ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು: 3 · ನೀವು ಒಪ್ಪಿದ್ದು: 2 · ನೀವು ಬೇಡ ಎಂದದ್ದು: 1
ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು: 7
ಪರಿಶೀಲಿಸದ್ದು: ಪಿಕಪ್‌ನಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ · ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ (UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ನೀವು ದಾಖಲಿಸುತ್ತೀರಿ) · ನಿಜವಾದ WhatsApp · ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ · ಇನ್ನೂ 16 ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ). ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.
ಕೋಡ್: 7K2M-9QXD · ಪೂರ್ಣ ವರದಿ: https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-kn.html
ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ.
ಸಿದ್ಧಪಡಿಸಿದವರು: Divya, Sri Sai Digital · Geometer
★ ಇನ್ನೋವೇಟರ್
```

### Every word and phrase of the report

| Id | Text (Kannada) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `agent` | ಆರ್ಡರ್ ಏಜೆಂಟ್ | Orders agent |  |
| `monthlyReport` | ಮಾಸಿಕ ವರದಿ | Monthly report |  |
| `goLiveCertificate` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ | Go-live certificate |  |
| `fullReport` | ಪೂರ್ಣ ವರದಿ | Full report |  |
| `helpLine` | ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ. | Write to support. A person answers. |  |
| `promise` | ಪಾವತಿ ದಾಖಲೆ (ಅಥವಾ UPI ಯಲ್ಲಿ ನಿಮ್ಮ ದೃಢೀಕರಣ) ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ; ಪ್ರತಿ ರೀಫಂಡ್ ದಾಖಲಾಗುತ್ತದೆ. | No order confirmed without the payment record (or your confirmation for UPI); every refund tracked. |  |
| `label.collected` | ಸಂಗ್ರಹವಾದ ಮುಂಗಡ | Advance collected |  |
| `label.stillToCollect` | ಪಿಕಪ್‌ನಲ್ಲಿ ಪಡೆಯಬೇಕಾದದ್ದು | To collect at pickup |  |
| `label.givenBack` | ಮರಳಿ ಕೊಟ್ಟದ್ದು | Given back |  |
| `label.ordersTaken` | ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು | Orders taken |  |
| `label.cancelled` | ರದ್ದಾದವು | Cancelled |  |
| `label.wasAsked` | ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು | You were asked |  |
| `label.approved` | ನೀವು ಒಪ್ಪಿದ್ದು | You approved |  |
| `label.saidNo` | ನೀವು ಬೇಡ ಎಂದದ್ದು | You said no |  |
| `label.stoppedByLimits` | ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು | Stopped by your limits |  |
| `label.notChecked` | ಪರಿಶೀಲಿಸದ್ದು | Not checked |  |
| `label.orders` | ಆರ್ಡರ್‌ಗಳು | orders |  |
| `stop.price-at-or-above-menu` | ಮೆನುವಿಗಿಂತ ಕಡಿಮೆ ಬೆಲೆ | Prices below your menu |  |
| `stop.order-size` | ತುಂಬ ವಸ್ತುಗಳ ಆರ್ಡರ್‌ಗಳು | Orders with too many items |  |
| `stop.within-stock` | ದಿನದ ಸ್ಟಾಕ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು | Orders past the day's stock |  |
| `stop.within-day-cap` | ದಿನದ ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು | Orders past the day's limit |  |
| `stop.before-cutoff` | ಕಟ್-ಆಫ್ ನಂತರದ ಆರ್ಡರ್‌ಗಳು | Orders after the cut-off |  |
| `stop.within-delivery-area` | ಡೆಲಿವರಿ ಪ್ರದೇಶದ ಹೊರಗಿನ ವಿಳಾಸಗಳು | Addresses outside your delivery area |  |
| `stop.confirm-only-when-recorded` | ಪಾವತಿ ದಾಖಲೆ ಇಲ್ಲದ "ಖಚಿತ" | "Confirmed" with no payment on record |  |
| `stop.one-advance-per-order` | ಒಂದು ಆರ್ಡರ್‌ನ ಎರಡನೇ ಮುಂಗಡ | A second advance on one order |  |
| `stop.refund-limit` | ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ | Refunds above your limit |  |
| `stop.message-matches-record` | ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶಗಳು | Messages that did not match the record |  |
| `stop.opt-out` | STOP ನಂತರದ ಸಂದೇಶಗಳು | Messages after STOP |  |
| `handRun` | ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ. | Checks were run by hand. |  |
| `sourceTag.stand-in` | ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ | stand-in services, test money |  |
| `sourceTag.test-mode` | ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ | test mode, test money |  |
| `more` | ಇನ್ನೂ 12 ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ) | and 12 more (see the full report) |  |
| `notChecked.cash` | ಪಿಕಪ್‌ನಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ | balance paid in cash or UPI at pickup |  |
| `notChecked.upi` | Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು | payments outside Razorpay |  |
| `notChecked.whatsapp` | ನಿಜವಾದ WhatsApp | real WhatsApp |  |
| `notChecked.razorpay` | ನಿಜವಾದ Razorpay | real Razorpay |  |
| `notChecked.review` | ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ | a native speaker's review of the wording |  |
| `languageName.hi` | ಹಿಂದಿ | Hindi |  |
| `languageName.en` | ಇಂಗ್ಲಿಷ್ | English |  |
| `languageName.ml` | ಮಲಯಾಳಂ | Malayalam |  |
| `languageName.kn` | ಕನ್ನಡ | Kannada |  |
| `upiLabel.collected` | ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ಮುಂಗಡ | Advance marked paid by owner |  |
| `upiLabel.givenBack` | ಮಾಲೀಕರು ಕಳುಹಿಸಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ರೀಫಂಡ್ | Refunds marked sent by owner |  |
| `upiLabel.notChecked` | ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ (UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ನೀವು ದಾಖಲಿಸುತ್ತೀರಿ) | automatic payment checking (with UPI you mark each payment) |  |
| `notTested.balance-at-pickup` | ಉಳಿದ ಬೆಲೆ, ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿಯಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಡುವುದು (ಮುಂಗಡವನ್ನು ಮಾತ್ರ ದಾಖಲಿಸಲಾಗುತ್ತದೆ) | The rest of the price, paid in cash or by UPI at pickup or delivery (only the advance is tracked) |  |
| `notTested.kitchen-and-delivery` | ಆಹಾರ ತಯಾರಾಯಿತೇ, ತೆಗೆದುಕೊಂಡರೇ ಅಥವಾ ತಲುಪಿತೇ ಎಂಬುದು (ಸ್ಲಾಟ್ ಮುಗಿದಾಗ ಆರ್ಡರ್ ಮುಗಿದಿದೆ ಎಂದು ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ) | Whether the food was made, collected or delivered (an order is completed when its slot ends) |  |
| `notTested.order-changes` | ಖಚಿತವಾದ ಆರ್ಡರ್‌ನಲ್ಲಿ ಬದಲಾವಣೆ (ಗ್ರಾಹಕರು ರದ್ದು ಮಾಡಿ ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡುತ್ತಾರೆ) | Changing a confirmed order (a customer cancels and orders again) |  |
| `notTested.payments-outside-razorpay` | Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು (ಈ ಅಂಗಡಿ Razorpay ಮೂಲಕ ಪಡೆಯುತ್ತದೆ) | Payments outside Razorpay (this shop takes Razorpay) |  |
| `notTested.real-whatsapp` | ನಿಜವಾದ WhatsApp | Real WhatsApp |  |
| `notTested.real-razorpay` | ನಿಜವಾದ Razorpay (ಟೆಸ್ಟ್ ಮೋಡ್ ಅಥವಾ ಲೈವ್) | Real Razorpay (test mode or live) |  |
| `notTested.webhook-signatures` | ವೆಬ್‌ಹುಕ್ ಸಹಿಗಳು | Webhook signatures |  |
| `notTested.real-model` | ನಿಜವಾದ AI ಮಾದರಿ (ನಿಯಮಗಳು ಮತ್ತು ನಕಲಿ ಮಾದರಿಗಳನ್ನು ಓಡಿಸಲಾಯಿತು; ಸಂದೇಶಗಳು ನಿಗದಿತ ಟೆಂಪ್ಲೇಟ್‌ಗಳು) | A real AI model (the rules and stand-in models were run; messages are fixed templates) |  |
| `notTested.other-languages` | ತಮಿಳು, ತೆಲುಗು ಮತ್ತು ಇತರ ಭಾಷೆಗಳು | Tamil, Telugu and other languages |  |
| `notTested.native-review` | ಹಿಂದಿ, ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ | A native speaker's review of the Hindi, Malayalam and Kannada wording |  |
| `notTested.restart-mid-step` | ಒಂದು ಹಂತದ ನಡುವೆ ಕ್ರ್ಯಾಶ್ ಅಥವಾ ಮರುಪ್ರಾರಂಭ | A crash or restart in the middle of a step |  |
| `notTested.same-instant` | ಒಂದೇ ಕ್ಷಣದಲ್ಲಿ ಕೊನೆಯ ಭಾಗವನ್ನು ತೆಗೆದುಕೊಳ್ಳುವ ಇಬ್ಬರು ಗ್ರಾಹಕರು | Two customers taking the last portion at the exact same instant |  |
| `notTested.number-words` | ಒಂದರಿಂದ ಹತ್ತು (ಇಂಗ್ಲಿಷ್ ಮತ್ತು ಹಿಂದಿಯಲ್ಲಿ) ಮತ್ತು ಒಂದರಿಂದ ಐದು (ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡದಲ್ಲಿ) ಹೊರತಾದ ಪದಗಳಲ್ಲಿ ಬರೆದ ಪ್ರಮಾಣಗಳು | Quantities written in words other than one to ten (English and Hindi) and one to five (Malayalam and Kannada) |  |
| `notTested.other-faults` | ಕೈ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಹೇಳಿದ ದೋಷಗಳನ್ನು ಬಿಟ್ಟು ಬೇರೆ ದೋಷಗಳು | Faults beyond the ones the hand check lists |  |
| `notTested.upi-not-automatic` | ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ: UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರೇ ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸುತ್ತಾರೆ | automatic payment checking: with UPI the owner marks each payment received |  |
| `notTested.real-upi` | ನಿಜವಾದ UPI ಆ್ಯಪ್‌ನಿಂದ ನಿಜವಾದ UPI ID ಗೆ ಪಾವತಿ (ಮಾಲೀಕರ ದಾಖಲಾತಿಯನ್ನು ಪ್ರಯತ್ನಿಸಲಾಯಿತು, ಪಾವತಿಯನ್ನಲ್ಲ) | a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment) |  |
| `notTested.own-settings` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಉದಾಹರಣೆ ಅಂಗಡಿ Annapurna Tiffins ಮೇಲೆ ನಡೆದವು ಎಂದು) | These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Annapurna Tiffins) |  |
| `notTested.other-settings` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು) | These checks on this shop's own settings (the go-live certificate says they ran on different settings) |  |
| `notTested.no-go-live-certificate` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ) | These checks on this shop's own settings (no go-live certificate was given) |  |
| `notTested.go-live-untrusted` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ) | These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used) |  |
| `notTested.situations-skipped` | ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆಸಲಾಗದ ಸಂದರ್ಭಗಳು (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿ ಅವುಗಳ ಹೆಸರುಗಳಿವೆ) | Situations these settings could not run (named in the go-live certificate) |  |
| `notCounted.balance-at-pickup` | ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿಯಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ: ದಾಖಲೆಯಲ್ಲಿ ಮುಂಗಡ ಮಾತ್ರ ಇದೆ | The rest of the price, paid in cash or by UPI at pickup or delivery: the record only holds the advance |  |
| `notCounted.kitchen-and-delivery` | ಆಹಾರ ತಯಾರಾಯಿತೇ, ತೆಗೆದುಕೊಂಡರೇ ಅಥವಾ ತಲುಪಿತೇ ಎಂಬುದು | Whether the food was made, collected or delivered |  |
| `notCounted.read-receipts` | ಗ್ರಾಹಕರು ಸಂದೇಶ ಓದಿದರೇ ಇಲ್ಲವೇ | Whether a customer read a message |  |
| `notCounted.outside-agent` | ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು Razorpay, UPI ಆ್ಯಪ್ ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು) | Anything done outside the agent (by you or anyone else, in Razorpay, your UPI app or WhatsApp) |  |
| `notCounted.rule-breaks` | ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ಅದನ್ನು ತಡೆದದ್ದು ಮಾತ್ರ ಇದೆ | Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing |  |
| `cert.date` | ದಿನಾಂಕ | Date |  |
| `cert.held` | 26 ಸಂದರ್ಭಗಳಲ್ಲಿ 25 ಸರಿಯಾಗಿ ನಿಂತವು. 1 ತಪ್ಪಿದವು. 12 ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ. | Held 25 of 26 situations. 1 failed. 12 not tested. |  |
| `cert.intro` | ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಕಳೆದುಹೋದ ಉತ್ತರಗಳು, ಎರಡು ಬಾರಿ ಅಥವಾ ತಡವಾಗಿ ಬಂದ ಪಾವತಿ, ಕಟ್ಟದೆ "ಕಟ್ಟಿದ್ದೇವೆ" ಎನ್ನುವ ಗ್ರಾಹಕರು, ಸ್ಟಾಕ್‌ಗಿಂತ ಹೆಚ್ಚು ಅಥವಾ ಕಟ್-ಆಫ್ ನಂತರದ ಆರ್ಡರ್‌ಗಳು, ರೀಫಂಡ್ ಕೋರಿಕೆಗಳು, ಏಜೆಂಟ್ ಅನ್ನು ಮೋಸಗೊಳಿಸಲು ಯತ್ನಿಸುವ ಗ್ರಾಹಕರು. | Before switching on, we tried situations that could go wrong: lost replies, a payment arriving twice or late, customers saying they paid when they had not, orders past the stock or after the cut-off, requests for refunds, and customers trying to trick the agent. |  |
| `cert.yourLimits` | ನಿಮ್ಮ ಮಿತಿಗಳು | Your limits |  |
| `cert.paidRule` | ಪಾವತಿ ದಾಖಲೆ (ಅಥವಾ UPI ಯಲ್ಲಿ ನಿಮ್ಮ ದಾಖಲಾತಿ) ಪೂರ್ತಿ ಮುಂಗಡ ತೋರಿಸುವವರೆಗೆ ಯಾವ ಆರ್ಡರ್ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ | No order is confirmed until the payment record (or your UPI mark) shows the whole advance |  |
| `cert.menu` | ಮೆನು ಮತ್ತು ಒಂದು ದಿನದಲ್ಲಿ ಗರಿಷ್ಠ ಮಾಡುವುದು: Veg thali ₹120 (12) · Curd ₹20 (30) | Menu and the most made in a day: Veg thali ₹120 (12) · Curd ₹20 (30) |  |
| `cert.orderLimits` | ಒಂದು ದಿನಕ್ಕೆ ಗರಿಷ್ಠ 8 ಆರ್ಡರ್, ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ 10 ವಸ್ತುಗಳು, 7 ದಿನ ಮುಂಚಿತವಾಗಿಯವರೆಗೆ | At most 8 orders a day, 10 items in one order, up to 7 days ahead |  |
| `cert.cutoff` | ಸಾಮಾನ್ಯ ಕಟ್-ಆಫ್: 1 ದಿನ ಮೊದಲು 20:00 ಕ್ಕೆ ಆರ್ಡರ್‌ಗಳು ಮುಚ್ಚುತ್ತವೆ | The usual cut-off: orders close at 20:00, 1 day before |  |
| `cert.advance` | ಬೆಲೆಯ 50% ಅನ್ನು ಮುಂಗಡವಾಗಿ ಪಡೆಯಲಾಗುತ್ತದೆ; ಅದಕ್ಕಾಗಿ ಆರ್ಡರ್ ಅನ್ನು 30 ನಿಮಿಷ ಹಿಡಿದಿಡಲಾಗುತ್ತದೆ | 50% of the price is paid as the advance; the order is held 30 minutes for it |  |
| `cert.delivery` | ಡೆಲಿವರಿ ಇಲ್ಲಿಗೆ ಮಾತ್ರ: Kakkanad, Edappally, Infopark | Delivery only to: Kakkanad, Edappally, Infopark |  |
| `cert.noDelivery` | ಪಿಕಪ್ ಮಾತ್ರ, ಡೆಲಿವರಿ ಇಲ್ಲ | Pickup only, no delivery |  |
| `cert.window` | ಸ್ಲಾಟ್‌ಗೆ ಕನಿಷ್ಠ 6 ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿದರೆ ಮುಂಗಡ ಹಣ ಮರಳಿಸಲಾಗುತ್ತದೆ; ನಂತರದ್ದು ನಿಮ್ಮ ತೀರ್ಮಾನ | Cancel at least 6 hours before the slot and the advance is refunded; later, it is your call |  |
| `cert.refund` | ₹300 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಮಾತ್ರ | Refunds above ₹300 only with your OK |  |
| `cert.approve` | ₹1,000 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್ ಯಾವುದೇ ಪಾವತಿ ಕೇಳುವ ಮೊದಲು ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತದೆ | An order above ₹1,000 waits for your OK before any payment is asked |  |
| `cert.noApprove` | ಗಾತ್ರದ ಕಾರಣದಿಂದ ಮಾತ್ರ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುವುದಿಲ್ಲ | No order waits for your OK because of its size |  |
| `cert.notAGrade` | ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ. | This counts the situations tried. It does not grade the agent. |  |
| `cert.didNotHold` | ತಪ್ಪಿದವು | Did not hold |  |
| `cert.handRunLine` | ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp ಅಥವಾ ಪಾವತಿಯ ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ (stand-in services). ಟೆಸ್ಟ್ ಹಣ ಮಾತ್ರ. | Checks were run by hand against stand-in services, not real WhatsApp or payments. Test money only. |  |
| `cert.checkedOn` | ಪರಿಶೀಲನೆ ನಡೆದದ್ದು | Checks run on |  |
| `goLive.heading` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ | Go-live checks |  |
| `goLive.own` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ. | The go-live checks ran on this shop's own settings, in the go-live certificate of 2 Nov 2026. |  |
| `goLive.example` | 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಅಂಗಡಿ Annapurna Tiffins ಮೇಲೆ ನಡೆದವು, ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ. | The go-live certificate of 2 Nov 2026 says its checks ran on the example shop, Annapurna Tiffins, not on this shop's own settings. |  |
| `goLive.different` | 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ. | The go-live certificate of 2 Nov 2026 says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave. |  |
| `goLive.untrusted` | ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಈ ಏಜೆಂಟ್‌ನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ. | A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used. |  |
| `goLive.none` | ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ. | No go-live certificate was given, so this document does not say what the go-live checks ran on. |  |
| `goLive.signedWith` | ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು key-3f9a1c ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ. | The go-live certificate is signed with key-3f9a1c. A key does not show who holds it. |  |
| `page.numbers` | ಅಂಕಿಅಂಶಗಳು | The numbers |  |
| `page.item` | ಏನು | What |  |
| `page.count` | ಎಷ್ಟು | How many |  |
| `page.amount` | ಮೊತ್ತ | Amount |  |
| `page.ordersTaken` | ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು | Orders taken |  |
| `page.ordersCompleted` | ಮುಗಿದ ಆರ್ಡರ್‌ಗಳು | Orders completed |  |
| `page.ordersCancelled` | ಖಚಿತವಾದ ನಂತರ ರದ್ದಾದ ಆರ್ಡರ್‌ಗಳು | Orders cancelled after they were confirmed |  |
| `page.holdsRanOut` | ಮುಂಗಡ ಬರುವ ಮೊದಲೇ ಮುಗಿದ ಹೋಲ್ಡ್‌ಗಳು | Holds that ran out before an advance |  |
| `page.soldHeading` | ಈ ತಿಂಗಳ ದಿನಗಳ ಆರ್ಡರ್‌ಗಳು | Orders for days in this month |  |
| `page.soldOrders` | ಖಚಿತವಾದ ಅಥವಾ ಮುಗಿದ ಆರ್ಡರ್‌ಗಳು | Confirmed or completed orders |  |
| `page.pickup` | ಪಿಕಪ್ | Pickup |  |
| `page.delivery` | ಡೆಲಿವರಿ | Delivery |  |
| `page.itemsSold` | ಮಾರಾಟವಾದ ವಸ್ತುಗಳು | Items sold |  |
| `page.noItems` | ಯಾವುದೂ ಇಲ್ಲ | None |  |
| `page.messagesHeading` | ಸಂದೇಶಗಳು | Messages |  |
| `page.toYou` | ನಿಮಗೆ, ಮಾಲೀಕರಿಗೆ | To you, the owner |  |
| `page.heldBack` | ಕಳುಹಿಸುವ ಮೊದಲು ತಡೆದದ್ದು | Held back before sending |  |
| `page.stoppedHeading` | ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು | What your limits stopped |  |
| `page.rule` | ಮಿತಿ | Limit |  |
| `page.times` | ಬಾರಿ | Times |  |
| `page.stoppedCustomers` | STOP ಕಳುಹಿಸಿದ ಗ್ರಾಹಕರು | Customers who sent STOP |  |
| `page.notCountedHeading` | ಎಣಿಸದ್ದು | Not counted |  |
| `page.notTestedHeading` | ಪರಿಶೀಲಿಸದ್ದು | Not tested |  |
| `page.unconfirmed` | ದೃಢವಾಗದ ಅಥವಾ ವಿಫಲವಾದದ್ದು | Left unconfirmed or failed |  |
| `page.checkHeading` | ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ | Check this document |  |
| `page.code` | ಕೋಡ್ | Code |  |
| `page.digest` | ಡೈಜೆಸ್ಟ್ | Digest |  |
| `page.countedFrom` | ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು | Counted from |  |
| `page.setUpBy` | ಸಿದ್ಧಪಡಿಸಿದವರು | Set up by |  |
| `page.madeOn` | ಮಾಡಿದ ದಿನ | Made on |  |
| `page.signedBy` | ಸಹಿ ಮಾಡಿದವರು | Signed by |  |
| `page.notSigned` | ಸಹಿ ಇಲ್ಲ | Not signed |  |
| `page.scanToCheck` | ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಪಾಲುದಾರ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ. | Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you. |  |
| `page.signatureNote` | ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ. | A signature shows who made this document and that it has not changed. It does not show that what it counts is complete. |  |
| `page.notAGrade` | ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ. | These are counts of what the record shows. They do not grade the agent. |  |
| `page.period` | ಅವಧಿ | Period |  |
| `page.showWhatWeDid` | ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸ | Show what we did ▸ |  |
| `page.byActionHeading` | ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ | What the agent did, by action |  |
| `page.action` | ಕೆಲಸ | Action |  |
| `page.agentVersion` | ಏಜೆಂಟ್ ಆವೃತ್ತಿ | Agent version |  |
| `page.limitsDigest` | ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್ | Limits digest |  |
| `page.recordDigest` | ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್ | Record digest |  |
| `page.liveServices` | ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು | Live services |  |

