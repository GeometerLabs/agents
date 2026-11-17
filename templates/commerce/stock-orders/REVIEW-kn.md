# Review sheet: Kannada (kn), Stock orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Stock orders agent says in Kannada. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Glow Unisex Salon's (a made-up salon): 10 boxes of hair colour at ₹450 a box from Ravi Traders, a total of ₹4,500.

What to look for first: (1) is each message polite, short and something a salon owner and a wholesaler would really send to each other; (2) are "order", "supplier", "budget", "approve", "box" and "received" the words people use; (3) the owner's typed words "yes CODE", "no CODE", "received po-3", "paid po-3", "cancel po-3" and "send po-3" stay in Latin letters, as they are typed.

Amounts are always written as ₹4,500 with Western digits; items, units, quantities, suppliers and order numbers are filled in from the shop's record, never translated.

## 1. Messages to the supplier (6)

The order and every ask after it are WhatsApp templates (the supplier has usually not written for a day). Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Kannada) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `supplier_order` | To the supplier: the order itself, as a WhatsApp template (the supplier has usually not written in the last day) | ಹೊಸ ಆರ್ಡರ್ po-3 (Glow Unisex Salon ಅವರಿಂದ): 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ಇದನ್ನು ಪೂರೈಸಲು ಸಾಧ್ಯವಾದರೆ "OK" ಎಂದು, ಸಾಧ್ಯವಿಲ್ಲದಿದ್ದರೆ "NO" ಎಂದು ಉತ್ತರಿಸಿ. | New order po-3 from Glow Unisex Salon: 10 × hair colour (box), ₹450 per box, total ₹4,500. Please reply OK to confirm you can supply it, or NO if you cannot. |  |
| `supplier_check` | To the supplier: a silent supplier is asked again about the same order (a reminder, not a new order) | ಈ ಮೊದಲು ಕಳುಹಿಸಿದ ಆರ್ಡರ್ po-3 ಬಗ್ಗೆ ನೆನಪೋಲೆ (Glow Unisex Salon ಅವರಿಂದ): 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ಇದು ಅದೇ ಆರ್ಡರ್, ಹೊಸದಲ್ಲ. ಪೂರೈಸಲು ಸಾಧ್ಯವಾದರೆ "OK" ಎಂದು, ಸಾಧ್ಯವಿಲ್ಲದಿದ್ದರೆ "NO" ಎಂದು ಉತ್ತರಿಸಿ. | Reminder about order po-3 from Glow Unisex Salon, sent earlier: 10 × hair colour (box), ₹450 per box, total ₹4,500. This is the same order, not a new one. Please reply OK to confirm, or NO if you cannot supply it. |  |
| `supplier_which` | To the supplier: a bare OK while several orders wait for their answer | Glow Unisex Salon ಅವರ ಹಲವು ಆರ್ಡರ್‌ಗಳು ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿವೆ (po-3). ಆರ್ಡರ್ ಸಂದೇಶದ ಬಟನ್ ಬಳಸಿ, ಅಥವಾ "OK" ಅಥವಾ "NO" ಎಂದು ಬರೆದು ಆರ್ಡರ್ ಸಂಖ್ಯೆ ಸೇರಿಸಿ. | Several orders from Glow Unisex Salon are waiting for your answer (po-3). Please answer with the button on the order message, or write OK or NO followed by the order number. |  |
| `supplier_unclear` | To the supplier: their message was not an OK or a NO | ನಿಮ್ಮ ಸಂದೇಶಕ್ಕೆ ಧನ್ಯವಾದ. Glow Unisex Salon ಅವರ ಆರ್ಡರ್ po-3 ಗೆ ಉತ್ತರಿಸಲು "OK" ಅಥವಾ "NO" ಎಂದು ಬರೆಯಿರಿ, ಅಥವಾ ಆರ್ಡರ್ ಸಂದೇಶದ ಬಟನ್ ಬಳಸಿ. | Thank you for your message. To answer order po-3 from Glow Unisex Salon, please reply OK or NO, or use the button on the order message. |  |
| `supplier_thanks_yes` | To the supplier: their OK is noted | ಧನ್ಯವಾದ. ಆರ್ಡರ್ po-3 ಅನ್ನು ನೀವು ಖಚಿತಪಡಿಸಿದ್ದೀರಿ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ. | Thank you. Order po-3 is noted as confirmed by you. |  |
| `supplier_thanks_no` | To the supplier: their NO is noted | ಧನ್ಯವಾದ. ಆರ್ಡರ್ po-3 ಅನ್ನು ನೀವು ಪೂರೈಸಲಾಗದು ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ. | Thank you. Order po-3 is noted as not supplied by you. |  |

## 2. Messages to the owner (37)

| Template id | When it is sent | Text (Kannada) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `card` | To the owner: the order for approval, with the budget, and the code to approve or decline | ಒಪ್ಪಿಗೆಗಾಗಿ ಆರ್ಡರ್ po-3: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500, Ravi Traders ಅವರಿಂದ. ಈ ತಿಂಗಳು ನಿಮ್ಮ ₹20,000 ಬಜೆಟ್‌ನಲ್ಲಿ ₹0 ಮೀಸಲಿಡಲಾಗಿದೆ, ಈ ಆರ್ಡರ್ ನಂತರ ₹15,500 ಉಳಿಯುತ್ತದೆ. ಬಟನ್ ಒತ್ತಿ ಒಪ್ಪಿ, ಅಥವಾ "yes K7M2QX" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇಡವಾದರೆ "no K7M2QX" ಎಂದು ಉತ್ತರಿಸಿ. | Order po-3 for your approval: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. This month ₹0 of your ₹20,000 budget is reserved, so ₹15,500 is left after this order. Approve with the button, or reply "yes K7M2QX". To decline reply "no K7M2QX". |  |
| `card_changed` | To the owner: the order changed since a card was shown, so the new card follows | ಆ ಕಾರ್ಡ್ ನಂತರ ಆರ್ಡರ್ ಬದಲಾಗಿದೆ, ಹಾಗಾಗಿ ಹಳೆಯ ಕಾರ್ಡ್ ಮಾನ್ಯವಲ್ಲ ಮತ್ತು ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಈಗಿನ ಕಾರ್ಡ್ ಇಲ್ಲಿದೆ: | The order changed since that card, so the earlier card no longer counts and nothing was sent. Here is the card as it is now: |  |
| `card_closed` | To the owner: a card that was answered or replaced is used again | ಆ ಕಾರ್ಡ್‌ಗೆ ಈಗಾಗಲೇ ಉತ್ತರಿಸಲಾಗಿದೆ ಅಥವಾ ಹೊಸ ಕಾರ್ಡ್ ಬಂದಿದೆ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಿಲ್ಲ. | That card was already answered or replaced, so nothing was done. |  |
| `card_expired` | To the owner: a card ran out (a day) and nothing was sent | ಆ ಕಾರ್ಡ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ, ಹಾಗಾಗಿ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಈಗಲೂ ಬೇಕಿದ್ದರೆ ಮತ್ತೆ ಹೇಳಿ. | That card ran out, so nothing was sent. Ask me again if you still want it. |  |
| `card_unknown` | To the owner: a code that no card has | ಆ ಕೋಡ್‌ನ ಕಾರ್ಡ್ ನನ್ನ ಬಳಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಿಲ್ಲ. | I have no card with that code, so nothing was done. |  |
| `order_declined` | To the owner: the owner declined; nothing was sent | ಆರ್ಡರ್ po-3 ಬೇಡವೆಂದು ಹೇಳಲಾಗಿದೆ. Ravi Traders ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. | Order po-3 is declined. Nothing was sent to Ravi Traders. |  |
| `order_approved` | To the owner: approved, the budget reserved, sending now | ಆರ್ಡರ್ po-3 ಒಪ್ಪಲಾಗಿದೆ: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500, Ravi Traders ಅವರಿಂದ. ಈ ತಿಂಗಳ ಬಜೆಟ್‌ನಿಂದ ₹4,500 ಮೀಸಲಿಡಲಾಗಿದೆ, ₹15,500 ಉಳಿದಿದೆ. ಈಗ ಪೂರೈಕೆದಾರರಿಗೆ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ. | Order po-3 is approved: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. ₹4,500 is now reserved from this month's budget and ₹15,500 is left. Sending it to the supplier now. |  |
| `sent_ok` | To the owner: the order message went to the supplier | ಆರ್ಡರ್ po-3 ಅನ್ನು Ravi Traders ಅವರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಅವರು ಇನ್ನೂ ಉತ್ತರಿಸಿಲ್ಲ. ಮೌನವಾಗಿದ್ದರೆ ನಾನು ಮತ್ತೆ ಕೇಳುತ್ತೇನೆ. | Order po-3 went to Ravi Traders. They have not answered yet. I will ask again if they stay silent. |  |
| `sent_unknown` | To the owner: WhatsApp did not confirm the order message; it will not be sent again | ಆರ್ಡರ್ po-3 Ravi Traders ಅವರಿಗೆ ತಲುಪಿತೇ ಎಂದು WhatsApp ಖಚಿತಪಡಿಸಲಿಲ್ಲ. ನಾನು ಆರ್ಡರ್ ಅನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಬದಲಿಗೆ Ravi Traders ಅವರನ್ನು po-3 ಬಗ್ಗೆ ಕೇಳಿ, ಅವರು ಹೇಳಿದ್ದನ್ನು ನಿಮಗೆ ತಿಳಿಸುತ್ತೇನೆ. | Order po-3 may or may not have reached Ravi Traders: WhatsApp did not confirm it. I will not send the order again. I will ask Ravi Traders about po-3 instead, and tell you what they say. |  |
| `send_failed` | To the owner: WhatsApp refused the order message; nothing went out | ಆರ್ಡರ್ po-3 Ravi Traders ಅವರಿಗೆ ಹೋಗಲಿಲ್ಲ: WhatsApp ನಿರಾಕರಿಸಿತು, ಹಾಗಾಗಿ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಬಜೆಟ್ ಮೀಸಲಾಗಿಯೇ ಇದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು "send po-3" ಎಂದು, ಬಿಡಲು "cancel po-3" ಎಂದು ಬರೆಯಿರಿ. | Order po-3 did not go to Ravi Traders: WhatsApp refused it, so nothing was sent. The budget stays reserved. Reply "send po-3" to try again, or "cancel po-3" to release it. |  |
| `send_blocked` | To the owner: a check held the order message back (for example the supplier asked for no more messages) | ಆರ್ಡರ್ po-3 ಅನ್ನು Ravi Traders ಅವರಿಗೆ ಕಳುಹಿಸಲಿಲ್ಲ: ಒಂದು ಪರಿಶೀಲನೆ ತಡೆಯಿತು, ಉದಾಹರಣೆಗೆ ಅವರು ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದಿದ್ದರೆ. ಏನೂ ಹೋಗಿಲ್ಲ. ಬಜೆಟ್ ಬಿಡುಗಡೆ ಮಾಡಲು "cancel po-3" ಎಂದು ಬರೆಯಿರಿ. | Order po-3 was not sent to Ravi Traders: a check held it back, for example because they asked for no more messages. Nothing went out. Reply "cancel po-3" to release the budget. |  |
| `owner_supplier_accepted` | To the owner: the supplier said OK (a template; it says this is not delivery) | ಪೂರೈಕೆದಾರ Ravi Traders ಆರ್ಡರ್ po-3 ಖಚಿತಪಡಿಸಿದ್ದಾರೆ: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ಅವರು ಪೂರೈಸುತ್ತಾರೆ ಎಂದರ್ಥ, ಸರಕು ಬಂದಿದೆ ಎಂದಲ್ಲ. ಬಂದಾಗ "received po-3" ಎಂದು ಬರೆಯಿರಿ. | Order po-3 confirmed by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. This means they will supply it, not that it has arrived. When it comes, reply "received po-3". |  |
| `owner_supplier_declined` | To the owner: the supplier said NO (a template); the budget is released | ಪೂರೈಕೆದಾರ Ravi Traders ಆರ್ಡರ್ po-3 ಅನ್ನು ನಿರಾಕರಿಸಿದ್ದಾರೆ: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ಸರಕು ಬರುವುದಿಲ್ಲ, ಮೀಸಲಿಟ್ಟ ಹಣ ಈ ತಿಂಗಳ ಬಜೆಟ್‌ಗೆ ಮರಳಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಪೂರೈಕೆದಾರರನ್ನು ಆರಿಸಿ. | Order po-3 was declined by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. Nothing is coming, and the money reserved is released back to this month's budget. Please choose another supplier. |  |
| `owner_supplier_silent` | To the owner: no answer after the last follow-up (a template) | ಪೂರೈಕೆದಾರ Ravi Traders ಅವರಿಂದ ಆರ್ಡರ್ po-3 ಗೆ 24 ಗಂಟೆಗಳ ನಂತರವೂ ಉತ್ತರ ಬಂದಿಲ್ಲ: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ನಾನು ಮತ್ತೆ ಕೇಳಿದ್ದೇನೆ ಮತ್ತು ಹೊಸ ಆರ್ಡರ್ ಕಳುಹಿಸುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಕರೆ ಮಾಡಿ. ಆರ್ಡರ್ ಖಚಿತವಾಗಿಲ್ಲ. | No answer yet to order po-3 from the supplier, Ravi Traders, after 24 hours: 10 × hair colour (box), ₹450 per box, total ₹4,500. I asked again and will not send a new order. Please call them. The order is not confirmed. |  |
| `owner_supplier_stopped` | To the owner: a supplier asked for no more messages | ಪೂರೈಕೆದಾರ Ravi Traders ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದಿದ್ದಾರೆ, ಹಾಗಾಗಿ ನಾನು ಅವರಿಗೆ ಮತ್ತೆ ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಅವರಿಗಾಗಿ ಕಾಯುತ್ತಿರುವ ಆರ್ಡರ್ ಕಳುಹಿಸಲ್ಪಡದೆ ಉಳಿಯುತ್ತದೆ, ಯಾವುದೆಂದು ತಿಳಿಸುತ್ತೇನೆ. | Supplier Ravi Traders asked for no more messages, so I will not message them again. Any order waiting for them stays unsent, and I will tell you which. |  |
| `received_full` | To the owner: all of the order is marked received (the owner's own mark) | ಪೂರ್ತಿ ಸರಕು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ po-3, 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500. ಇದು ನಿಮ್ಮ ದಾಖಲೆ, ಪೂರೈಕೆದಾರರದ್ದಲ್ಲ. ಪಾವತಿ ಬೇರೆ ವಿಷಯ: ಪಾವತಿಸಿದಾಗ "paid po-3" ಎಂದು ಬರೆಯಿರಿ. | Marked received, all of it: order po-3, 10 × hair colour (box), ₹450 per box, total ₹4,500. This is your mark, not the supplier's. Payment is separate: reply "paid po-3" when you have paid. |  |
| `received_part` | To the owner: part of the order is marked received | ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ po-3 (ಹೇರ್ ಕಲರ್) ನ 10 ರಲ್ಲಿ 4 ಬಂದಿದೆ. 6 ಬರಬೇಕಿದೆ. ಉಳಿದದ್ದು ಬಂದಾಗ "received po-3 6" ಎಂದು ಬರೆಯಿರಿ. | Marked: 4 of 10 received for order po-3 (hair colour). 6 still to come. Reply "received po-3 6" when the rest arrives. |  |
| `received_wrong` | To the owner: the wrong item is marked | ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ po-3 (ಹೇರ್ ಕಲರ್) ಗೆ ತಪ್ಪು ಸರಕು ಬಂದಿದೆ. ಅದನ್ನು ಬಂದಿದೆ ಎಂದು ಎಣಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು Ravi Traders ಅವರೊಂದಿಗೆ ಮಾತನಾಡಿ: ನಾನು ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. | Marked: the wrong item came for order po-3 (hair colour). It is not counted as received. Please sort it out with Ravi Traders: I sent them nothing. |  |
| `receive_too_many` | To the owner: more marked received than is still to come | ನೀವು 9 ಎಂದು ಬರೆದಿದ್ದೀರಿ, ಆದರೆ ಆರ್ಡರ್ po-3 ನ 6 ಮಾತ್ರ ಬರಬೇಕಿದೆ. ಏನೂ ದಾಖಲಿಸಿಲ್ಲ. ನಿಜವಾಗಿ ಏನು ಬಂತು ಎಂದು ತಿಳಿಸಿ. | You wrote 9, but only 6 of order po-3 are still to come. Nothing was marked. Please tell me what actually arrived. |  |
| `order_not_open` | To the owner: a command that cannot apply to the order now, with what it is waiting on | ಆರ್ಡರ್ po-3 ಅನ್ನು ಈಗ ಹಾಗೆ ಬದಲಿಸಲಾಗದು: ಅದು ಕಳುಹಿಸಲಾಗಿದೆ, ಉತ್ತರ ಬಂದಿಲ್ಲ. | Order po-3 cannot be changed that way now: it is sent, no answer yet. |  |
| `paid_outside_noted` | To the owner: the owner's note that they paid outside the chat | ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ po-3 ಗೆ ನೀವೇ ಈ ಚಾಟ್‌ನ ಹೊರಗೆ ಪಾವತಿಸಿದ್ದೀರಿ. ನಾನು ಏನನ್ನೂ ಪಾವತಿಸಿಲ್ಲ ಮತ್ತು ಪರಿಶೀಲಿಸಲೂ ಆಗದು: ಇದು ನಿಮ್ಮ ದಾಖಲೆ ಮಾತ್ರ. | Noted: you paid for order po-3 yourself, outside this chat. I paid nothing and cannot check it: it is only your mark. |  |
| `cannot_change` | To the owner: an approved order cannot be changed | ಆರ್ಡರ್ po-3 ಈಗಾಗಲೇ ಒಪ್ಪಲಾಗಿದೆ, ಹಾಗಾಗಿ ಬದಲಿಸಲಾಗದು. ತಪ್ಪಿದ್ದರೆ Ravi Traders ಅವರಿಗೆ ನೇರವಾಗಿ ಹೇಳಿ, ನಂತರ ನನಗೆ ಹೊಸ ವಿನಂತಿ ಕಳುಹಿಸಿ. | Order po-3 is already approved, so it cannot be changed. If it is wrong, ask Ravi Traders directly, then send me a new request. |  |
| `cancelled` | To the owner: an order is cancelled before it went to the supplier | ಆರ್ಡರ್ po-3 ರದ್ದಾಗಿದೆ. ಏನೂ ಕಳುಹಿಸಿಲ್ಲ, ಅದು ಮೀಸಲಿಟ್ಟ ಬಜೆಟ್ ಬಿಡುಗಡೆಯಾಗಿದೆ. | Order po-3 is cancelled. Nothing was sent, and any budget it held is released. |  |
| `cannot_cancel` | To the owner: an order already with the supplier cannot be cancelled here | ಆರ್ಡರ್ po-3 ಈಗಾಗಲೇ Ravi Traders ಅವರ ಬಳಿ ಇದೆ, ಹಾಗಾಗಿ ಇಲ್ಲಿಂದ ರದ್ದುಮಾಡಲಾಗದು. ದಯವಿಟ್ಟು ಅವರಿಗೆ ನೀವೇ ತಿಳಿಸಿ. | Order po-3 is already with Ravi Traders, so I cannot cancel it from here. Please tell them yourself. |  |
| `no_such_order` | To the owner: an order number the agent does not have | ನನ್ನ ಬಳಿ ಆರ್ಡರ್ po-3 ಇಲ್ಲ. | I have no order po-3. |  |
| `ask_line` | To the owner: more than one way to order an item; a list of the ways follows | ಹೇರ್ ಕಲರ್ ಅನ್ನು ಆರ್ಡರ್ ಮಾಡಲು ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಮಾರ್ಗಗಳಿವೆ. ನಿಮ್ಮ ಅರ್ಥ ಯಾವುದು? | There is more than one way to order hair colour. Which one do you mean? |  |
| `ask_qty` | To the owner: how many (a low-stock mark with no usual quantity) | Ravi Traders ಅವರಿಂದ ಹೇರ್ ಕಲರ್ ನ ಎಷ್ಟು ಬಾಕ್ಸ್ ಆರ್ಡರ್ ಮಾಡಲಿ? ಒಂದು ಸಂಖ್ಯೆ ಬರೆಯಿರಿ. | How many box of hair colour from Ravi Traders should I order? Reply with a number. |  |
| `item_unknown` | To the owner: an item that is not in the catalogue, with what can be ordered | ಅದು ನಿಮ್ಮ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ. ನಾನು ಆರ್ಡರ್ ಮಾಡಬಲ್ಲದ್ದು: ಹೇರ್ ಕಲರ್. | I do not have that in your catalogue, so nothing was ordered. I can order: hair colour. |  |
| `blocked_supplier` | To the owner: the supplier is not on the approved list, or is paused | ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: Ravi Traders ನಿಮ್ಮ ಒಪ್ಪಿದ ಪೂರೈಕೆದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ, ಅಥವಾ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. | Nothing was ordered: Ravi Traders is not on your approved supplier list, or is paused. Nothing was sent to anyone. |  |
| `blocked_cap` | To the owner: the order is above the most one order may be worth | ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), ಒಂದು ಬಾಕ್ಸ್ಗೆ ₹450, ಒಟ್ಟು ₹4,500 ಒಂದು ಆರ್ಡರ್‌ನ ₹12,000 ಮಿತಿಗಿಂತ ಹೆಚ್ಚು. ಕಡಿಮೆ ಆರ್ಡರ್ ಮಾಡಿ, ಅಥವಾ ಮಿತಿ ಬದಲಿಸಲು ನಿಮ್ಮ ಆಪರೇಟರ್‌ಗೆ ಹೇಳಿ. | Nothing was ordered: 10 × hair colour (box), ₹450 per box, total ₹4,500 is more than the ₹12,000 one order may be worth. Order less, or ask your Operator to change the limit. |  |
| `blocked_budget` | To the owner: the order is more than is left of the month's budget | ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: ₹4,500 ಈ ತಿಂಗಳ (Nov 2026) ₹20,000 ಬಜೆಟ್‌ನಲ್ಲಿ ಉಳಿದಿರುವ ₹15,500 ಗಿಂತ ಹೆಚ್ಚು. | Nothing was ordered: ₹4,500 is more than the ₹15,500 left of this month's ₹20,000 budget (Nov 2026). |  |
| `blocked_qty` | To the owner: a quantity above the most one order may have (a typing slip) | ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: 9 ಒಂದು ಆರ್ಡರ್‌ನ 200 ಕ್ಕಿಂತ ಹೆಚ್ಚು, ಇದು ಟೈಪಿಂಗ್ ತಪ್ಪಿನಂತೆ ಕಾಣುತ್ತದೆ. ದಯವಿಟ್ಟು ಸಂಖ್ಯೆಯನ್ನು ಮತ್ತೆ ಬರೆಯಿರಿ. | Nothing was ordered: 9 is more than 200 in one order, which looks like a typing slip. Please write the number again. |  |
| `already_open` | To the owner: a low-stock mark for something already on order | Ravi Traders ಅವರಿಂದ ಹೇರ್ ಕಲರ್ ಗಾಗಿ ಆರ್ಡರ್ po-3 ಈಗಾಗಲೇ ತೆರೆದಿದೆ, ಹಾಗಾಗಿ ಇನ್ನೊಂದನ್ನು ಮಾಡಿಲ್ಲ. ನೋಡಲು "status" ಎಂದು ಬರೆಯಿರಿ. | Order po-3 for hair colour from Ravi Traders is already open, so I did not make another. Reply "status" to see it. |  |
| `status` | To the owner: the open orders and the month's budget | ತೆರೆದ ಸ್ಟಾಕ್ ಆರ್ಡರ್‌ಗಳು: po-3: 10 × ಹೇರ್ ಕಲರ್ (ಬಾಕ್ಸ್), Ravi Traders ಅವರಿಂದ, ₹4,500, ಪೂರೈಕೆದಾರರು ಒಪ್ಪಿದ್ದಾರೆ, ಸರಕು ಇನ್ನೂ ಬಂದಿಲ್ಲ ಈ ತಿಂಗಳು (Nov 2026) ನಿಮ್ಮ ₹20,000 ಬಜೆಟ್‌ನಲ್ಲಿ ₹0 ಮೀಸಲಿಡಲಾಗಿದೆ. | Open stock orders: po-3: 10 × hair colour (box) from Ravi Traders, ₹4,500, supplier confirmed, not received yet This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `status_empty` | To the owner: no open orders, and the month's budget | ತೆರೆದ ಸ್ಟಾಕ್ ಆರ್ಡರ್‌ಗಳಿಲ್ಲ. ಈ ತಿಂಗಳು (Nov 2026) ನಿಮ್ಮ ₹20,000 ಬಜೆಟ್‌ನಲ್ಲಿ ₹0 ಮೀಸಲಿಡಲಾಗಿದೆ. | No open stock orders. This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `didnt_understand` | To the owner: the message was not understood, with examples | ನಿಮಗೆ ಏನು ಬೇಕೆಂದು ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಉದಾಹರಣೆಗೆ ಹೀಗೆ ಬರೆಯಬಹುದು: "order 10 ಬಾಕ್ಸ್ ಹೇರ್ ಕಲರ್ from Ravi Traders", "received po-3", "paid po-3" ಅಥವಾ "status". | I could not tell what you want. You can write, for example, "order 10 box hair colour from Ravi Traders", "received po-3", "paid po-3" or "status". |  |
| `owner_message_held` | To the owner: a message about an order was held back because it did not match the record | ಆರ್ಡರ್ po-3 ಬಗ್ಗೆ ಒಂದು ಸಂದೇಶ ನನ್ನ ದಾಖಲೆಗೆ ಹೊಂದದ ಕಾರಣ ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ತಪ್ಪಾದದ್ದು ಏನೂ ಹೋಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಆರ್ಡರ್ ನೋಡಿ. | I held back a message about order po-3 because it did not match my record. Nothing wrong was sent. Please check the order. |  |

### The words for what an order is waiting on (the status list)

| Id | Text (Kannada) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `awaiting` | ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ | waiting for your approval |  |
| `sending` | ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ | being sent |  |
| `sent` | ಕಳುಹಿಸಲಾಗಿದೆ, ಉತ್ತರ ಬಂದಿಲ್ಲ | sent, no answer yet |  |
| `unknown` | ಪೂರೈಕೆದಾರರಿಗೆ ತಲುಪಿತೇ ಎಂದು ಖಚಿತವಿಲ್ಲ | may not have reached the supplier |  |
| `accepted` | ಪೂರೈಕೆದಾರರು ಒಪ್ಪಿದ್ದಾರೆ, ಸರಕು ಇನ್ನೂ ಬಂದಿಲ್ಲ | supplier confirmed, not received yet |  |
| `part` | ಸ್ವಲ್ಪ ಸರಕು ಬಂದಿದೆ | part received |  |
| `failed` | ಕಳುಹಿಸಲಿಲ್ಲ (WhatsApp ನಿರಾಕರಿಸಿತು) | not sent (WhatsApp refused it) |  |
| `blocked` | ಕಳುಹಿಸಲಿಲ್ಲ (ತಡೆಹಿಡಿಯಲಾಗಿದೆ) | not sent (held back) |  |

### The words on the buttons and the list

A button is at most 20 letters and a label never carries an amount. A tap carries an id, so no one's words are read from these.

| Id | Text (Kannada) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `approve` | ಒಪ್ಪಿ | Approve |  |
| `decline` | ಬೇಡ | Decline |  |
| `supplierYes` | ಸರಿ | OK |  |
| `supplierNo` | ಪೂರೈಸಲಾಗದು | Cannot supply |  |
| `choose` | ಆರಿಸಿ | Choose |  |

## 3. Months and weekdays as the agent writes them

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

The agent names the month of the budget in English letters ("Nov 2026") in every language; a reviewer may ask for the local name.

