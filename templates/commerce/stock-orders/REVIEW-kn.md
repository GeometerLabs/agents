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

## 4. The monthly report

The report says how many orders were placed, answered by the supplier, received in full or in part, and how much of the budget was used. It never says an order was paid unless the owner marked it.

### The monthly report on WhatsApp, with sample numbers

```text
*ಮಾಸಿಕ ವರದಿ: Glow Unisex Salon · ಫೆಬ್ರವರಿ 2027*
ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು: *9* · ಪೂರೈಕೆದಾರರು OK ಎಂದರು: *7* · ಪೂರ್ತಿ ಬಂತು: *4* · ಭಾಗಶಃ ಬಂತು: *1* · ತಪ್ಪು ವಸ್ತು: *1*
ಪೂರೈಕೆದಾರರು ಇಲ್ಲ ಎಂದರು: *1* · ಪೂರೈಕೆದಾರರ ಉತ್ತರ ಇಲ್ಲ: *1* · ರದ್ದಾದ ಅಥವಾ ಕಳುಹಿಸದ: *0*
ಬಳಸಿದ ಬಜೆಟ್: *₹20,000 ರಲ್ಲಿ ₹9,000 · ಹಣ ಕೊಟ್ಟಿದ್ದೆಂದು ಗುರುತಿಸಿದ್ದು (ನಿಮ್ಮ ಟಿಪ್ಪಣಿ): 2*
ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು: *3*
*ಪರಿಶೀಲಿಸದ್ದು*: ನಿಜವಾದ WhatsApp · ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಉತ್ತರಗಳು · ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು · ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ · ಮತ್ತು 10 (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ). ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.
ಕೋಡ್: 7K2M-9QXD · ಪೂರ್ಣ ವರದಿ: https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-kn.html
ನಿಜವಾದುದೇ ಎಂದು ಪರಿಶೀಲಿಸಿ: https://geometer.dev/verify/#sha256:5555555555555555555555555555555555555555555555555555555555555555
ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ.
ಸಿದ್ಧಪಡಿಸಿದವರು: Divya, Sri Sai Digital · Geometer
★ ಇನ್ನೋವೇಟರ್
```

### The owner's text, with sample numbers

```text
Glow Unisex Salon · ಫೆಬ್ರವರಿ 2027 · ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ
ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು: 9 · ಪೂರೈಕೆದಾರರು OK ಎಂದರು: 7 · ಪೂರ್ತಿ ಬಂತು: 4 · ಭಾಗಶಃ ಬಂತು: 1 · ತಪ್ಪು ವಸ್ತು: 1
ಪೂರೈಕೆದಾರರು ಇಲ್ಲ ಎಂದರು: 1 · ಪೂರೈಕೆದಾರರ ಉತ್ತರ ಇಲ್ಲ: 1 · ರದ್ದಾದ ಅಥವಾ ಕಳುಹಿಸದ: 0
ಬಳಸಿದ ಬಜೆಟ್: ₹20,000 ರಲ್ಲಿ ₹9,000 · ಹಣ ಕೊಟ್ಟಿದ್ದೆಂದು ಗುರುತಿಸಿದ್ದು (ನಿಮ್ಮ ಟಿಪ್ಪಣಿ): 2
ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು: 3 (ತಿಂಗಳ ಬಜೆಟ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು: 2 · ನಿಮ್ಮ ಒಪ್ಪಿದ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದ ಪೂರೈಕೆದಾರರು: 1)
ಪರಿಶೀಲಿಸದ್ದು: ನಿಜವಾದ WhatsApp · ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಉತ್ತರಗಳು · ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು · ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ · ಮತ್ತು 10 (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ). ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.
```

### Every word and phrase of the report

| Id | Text (Kannada) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `agent` | ಸ್ಟಾಕ್ ಆರ್ಡರ್ ಏಜೆಂಟ್ | Stock orders agent |  |
| `monthlyReport` | ಮಾಸಿಕ ವರದಿ | Monthly report |  |
| `goLiveCertificate` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ | Go-live certificate |  |
| `fullReport` | ಪೂರ್ಣ ವರದಿ | Full report |  |
| `checkGenuine` | ನಿಜವಾದುದೇ ಎಂದು ಪರಿಶೀಲಿಸಿ | Check it is genuine |  |
| `helpLine` | ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ. | Write to support. A person answers. |  |
| `promise` | ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ಪೂರೈಕೆದಾರರಿಗೆ ಹೋಗುವುದಿಲ್ಲ; ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ. | Nothing goes to a supplier without your approval; the agent pays no one. |  |
| `handRun` | ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ. | Checks were run by hand. |  |
| `sourceTag.stand-in` | ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ | stand-in services, test money |  |
| `sourceTag.test-mode` | ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ | test mode, test money |  |
| `more` | ಮತ್ತು 12 (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ) | and 12 more (see the full report) |  |
| `budgetOf` | ₹20,000 ರಲ್ಲಿ ₹9,000 | ₹9,000 of ₹20,000 |  |
| `label.placed` | ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು | Orders placed |  |
| `label.acknowledged` | ಪೂರೈಕೆದಾರರು OK ಎಂದರು | Supplier said OK |  |
| `label.receivedFull` | ಪೂರ್ತಿ ಬಂತು | Received in full |  |
| `label.partReceived` | ಭಾಗಶಃ ಬಂತು | Part received |  |
| `label.wrongItem` | ತಪ್ಪು ವಸ್ತು | Wrong item |  |
| `label.supplierSaidNo` | ಪೂರೈಕೆದಾರರು ಇಲ್ಲ ಎಂದರು | Supplier said no |  |
| `label.noAnswer` | ಪೂರೈಕೆದಾರರ ಉತ್ತರ ಇಲ್ಲ | No answer from the supplier |  |
| `label.neverSent` | ರದ್ದಾದ ಅಥವಾ ಕಳುಹಿಸದ | Cancelled or never sent |  |
| `label.budgetUsed` | ಬಳಸಿದ ಬಜೆಟ್ | Budget used |  |
| `label.budgetLeft` | ಉಳಿದ ಬಜೆಟ್ | Budget left |  |
| `label.markedPaid` | ಹಣ ಕೊಟ್ಟಿದ್ದೆಂದು ಗುರುತಿಸಿದ್ದು (ನಿಮ್ಮ ಟಿಪ್ಪಣಿ) | Marked paid by you (your note) |  |
| `label.asked` | ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು | You were asked |  |
| `label.approved` | ನೀವು ಒಪ್ಪಿದ್ದು | You approved |  |
| `label.saidNo` | ನೀವು ಇಲ್ಲ ಎಂದಿರಿ | You said no |  |
| `label.stopped` | ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು | Stopped by your limits |  |
| `label.notChecked` | ಪರಿಶೀಲಿಸದ್ದು | Not checked |  |
| `stop.monthly-budget` | ತಿಂಗಳ ಬಜೆಟ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು | Orders over the month's budget |  |
| `stop.per-order-cap` | ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನವು | Orders above your one-order limit |  |
| `stop.order-quantity` | ತಪ್ಪಿನಂತೆ ಕಂಡ ಪ್ರಮಾಣಗಳು | Quantities that looked like a slip |  |
| `stop.approved-supplier-only` | ನಿಮ್ಮ ಒಪ್ಪಿದ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದ ಪೂರೈಕೆದಾರರು | Suppliers not on your approved list |  |
| `stop.approval-matches-order` | ಆರ್ಡರ್‌ಗೆ ಹೊಂದದ ಒಪ್ಪಿಗೆಗಳು | Approvals that no longer matched the order |  |
| `stop.one-order-per-request` | ಒಂದು ಕೋರಿಕೆಯಿಂದ ಎರಡನೇ ಆರ್ಡರ್ | A second order from one request |  |
| `stop.reply-from-supplier` | ಪೂರೈಕೆದಾರರದ್ದಲ್ಲದ ಉತ್ತರಗಳು | Replies that were not the supplier's |  |
| `stop.send-only-when-approved` | ಒಪ್ಪಿಗೆ ಇಲ್ಲದ ಕಳುಹಿಸುವಿಕೆಗಳು | Sends that were not approved |  |
| `stop.message-matches-record` | ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶಗಳು | Messages that did not match the record |  |
| `stop.opt-out` | STOP ನಂತರದ ಸಂದೇಶಗಳು | Messages after STOP |  |
| `stop.other` | ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದ ಬೇರೆ ಏನೋ | Something else your limits held back |  |
| `notChecked.whatsapp` | ನಿಜವಾದ WhatsApp | real WhatsApp |  |
| `notChecked.supplier` | ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಉತ್ತರಗಳು | real suppliers' replies |  |
| `notChecked.paying` | ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು | paying a supplier |  |
| `notChecked.review` | ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ | a native speaker's review of the wording |  |
| `notTested.real-whatsapp` | ನಿಜವಾದ WhatsApp: ನಿಜವಾದ ಖಾತೆ, Meta ಯ ನಿಜವಾದ ಟೆಂಪ್ಲೇಟ್ ಅನುಮೋದನೆ, ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಫೋನ್ | Real WhatsApp: a real account, a real Meta template approval, a real supplier's phone |  |
| `notTested.native-review` | ಹಿಂದಿ, ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ | A native speaker's review of the Hindi, Malayalam and Kannada wording |  |
| `notTested.model-reading` | ಮಾಲೀಕರ ಕೋರಿಕೆಯನ್ನು AI ಮಾದರಿ ಓದುವುದು (ನಿಯಮಗಳ ಓದುಗ ಮಾತ್ರ ಪ್ರಯತ್ನಿಸಲಾಯಿತು; ಓದಲಾಗದ ಕೋರಿಕೆಯ ಬಗ್ಗೆ ಕೇಳಲಾಗುತ್ತದೆ, ಊಹಿಸುವುದಿಲ್ಲ) | An owner's request read by an AI model (only the rule reader was tried; a request it cannot read is asked about, not guessed) |  |
| `notTested.supplier-formats` | ನಿಜವಾದ ಪೂರೈಕೆದಾರರು ಉತ್ತರಿಸುವ ಹಲವು ವಿಧಗಳು (ವಾಯ್ಸ್ ನೋಟ್, ಬಿಲ್‌ನ ಫೋಟೋ, ಬೇರೆ ಲಿಪಿ, ಹಳೆಯ ಸಂದೇಶವನ್ನು ಉಲ್ಲೇಖಿಸುವ ಉತ್ತರ) | The many ways real suppliers answer (a voice note, a photo of a bill, another script, a reply that quotes an older message) |  |
| `notTested.restart` | ಒಪ್ಪಿಗೆಯ ನಡುವೆ ರೀಸ್ಟಾರ್ಟ್ (ಪರಿಶೀಲನೆಗಳಲ್ಲಿ ಎಲ್ಲವೂ ಮೆಮೊರಿಯಲ್ಲಿತ್ತು) | A restart in the middle of an approval (the checks kept everything in memory) |  |
| `notTested.paying` | ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು (ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ; ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿ ನಿಮ್ಮ ಮಾತು ಮಾತ್ರ) | Paying a supplier (the agent pays no one; your own note is only your word) |  |
| `notTested.invoice` | ಪೂರೈಕೆದಾರರ ಇನ್‌ವಾಯ್ಸ್, ಕ್ಯಾಟಲಾಗ್‌ಗಿಂತ ಬೇರೆ ಬೆಲೆ, ಪೂರೈಕೆದಾರರ ಭಾಗಶಃ ಸಾಗಣೆ ಸೂಚನೆ, ಸರಕು ಹಿಂತಿರುಗಿಸುವುದು | A supplier's invoice, a price that differs from the catalogue, a part-shipment note from the supplier, a return of goods |  |
| `notTested.real-month` | ಒಪ್ಪಿಗೆ ತೆರೆದಿರುವಾಗ ತಿಂಗಳು ಬದಲಾಗುವುದು | A month that turns while an approval is open |  |
| `notTested.own-settings` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅವು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Unisex Salon ಮೇಲೆ ನಡೆದವು) | These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Glow Unisex Salon) |  |
| `notTested.other-settings` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು) | These checks on this shop's own settings (the go-live certificate says they ran on different settings) |  |
| `notTested.no-go-live-certificate` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ) | These checks on this shop's own settings (no go-live certificate was given) |  |
| `notTested.go-live-untrusted` | ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ) | These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used) |  |
| `notTested.situations-skipped` | ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆಸಲಾಗದ ಸಂದರ್ಭಗಳು (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿ ಹೆಸರಿಸಲಾಗಿದೆ) | Situations these settings could not run (named in the go-live certificate) |  |
| `notCounted.goods-really-arrived` | ಸರಕು ನಿಜವಾಗಿ ಬಂತೇ ಎಂದು: ನಿಮ್ಮದೇ ದಾಖಲೆಯನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗುತ್ತದೆ | Whether the goods really arrived: only your own mark is counted |  |
| `notCounted.payments` | ಪೂರೈಕೆದಾರರಿಗೆ ಪಾವತಿಗಳು: ಈ ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ ಮತ್ತು ಯಾವ ಪಾವತಿಯನ್ನೂ ನೋಡಲಾಗದು; ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿಯನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗುತ್ತದೆ | Payments to suppliers: this agent pays no one and cannot see a payment; only your own note is counted |  |
| `notCounted.outside-agent` | ಏಜೆಂಟ್‌ನ ಹೊರಗೆ ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು (ಫೋನ್‌ನಲ್ಲಿ, ನೇರವಾಗಿ ಅಥವಾ ಬೇರೆ ಚಾಟ್‌ನಲ್ಲಿ) | Orders placed outside the agent (by phone, in person or in another chat) |  |
| `notCounted.read-receipts` | ಪೂರೈಕೆದಾರರು ಸಂದೇಶ ಓದಿದರೇ ಎಂದು | Whether a supplier read a message |  |
| `notCounted.rule-breaks` | ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ತಡೆಯಲ್ಪಟ್ಟದ್ದು ಮಾತ್ರ ಇದೆ | Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing |  |
| `cert.date` | ದಿನಾಂಕ | Date |  |
| `cert.held` | 15 ಸಂದರ್ಭಗಳಲ್ಲಿ 14 ಸರಿಯಾಗಿ ನಿಂತವು. 1 ತಪ್ಪಿದವು. 12 ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ. | Held 14 of 15 situations. 1 failed. 12 not tested. |  |
| `cert.intro` | ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಆರ್ಡರ್ ಸಂದೇಶದ ಕಳೆದುಹೋದ ಉತ್ತರ, ಎಂದೂ ಉತ್ತರಿಸದ ಪೂರೈಕೆದಾರ, ಬಜೆಟ್‌ನ ಕೊನೆಯ ಭಾಗಕ್ಕೆ ಎರಡು ಆರ್ಡರ್‌ಗಳ ಪೈಪೋಟಿ, ನೀವು ಒಪ್ಪಿದ ನಂತರ ಬದಲಾಗುವ ಪ್ರಮಾಣ ಅಥವಾ ಬೆಲೆ, ನಿಮ್ಮ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದ ಪೂರೈಕೆದಾರ, ಮತ್ತು ತಪ್ಪು ವಸ್ತು ಬರುವುದು. | Before switching on, we tried situations that could go wrong: a lost reply to an order message, a supplier who never answers, two orders racing for the last of the budget, a quantity or price that changes after you approve, a supplier who is not on your list, and a wrong item arriving. |  |
| `cert.yourLimits` | ನಿಮ್ಮ ಮಿತಿಗಳು | Your limits |  |
| `cert.paidRule` | ನೀವು ಅದೇ ಆರ್ಡರ್ ಅನ್ನು ಒಪ್ಪುವವರೆಗೆ ಏನೂ ಪೂರೈಕೆದಾರರಿಗೆ ಹೋಗುವುದಿಲ್ಲ, ಮತ್ತು ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ | Nothing goes to a supplier until you approve that exact order, and the agent pays no one |  |
| `cert.budget` | ತಿಂಗಳ ಬಜೆಟ್: ₹20,000, ಆರ್ಡರ್ ಒಪ್ಪಿದಾಗ ಮೀಸಲಿಡಲಾಗುತ್ತದೆ | Budget for the month: ₹20,000, set aside when you approve an order |  |
| `cert.cap` | ಒಂದು ಆರ್ಡರ್ ಗರಿಷ್ಠ ₹12,000 | One order is at most ₹12,000 |  |
| `cert.maxQty` | ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಒಂದು ವಸ್ತುವಿನ ಗರಿಷ್ಠ 200 ಘಟಕಗಳು | At most 200 units of one item in one order |  |
| `cert.suppliers` | 2 ಒಪ್ಪಿದ ಪೂರೈಕೆದಾರರು; 1 ಪಟ್ಟಿಯಲ್ಲಿದ್ದಾರೆ ಆದರೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ (ಆರ್ಡರ್ ಹೋಗುವುದಿಲ್ಲ) | 2 approved suppliers; 1 on the list but paused (never ordered from) |  |
| `cert.followUp` | ಉತ್ತರಿಸದ ಪೂರೈಕೆದಾರರನ್ನು 4, 24 ಗಂಟೆಗಳ ನಂತರ ಮತ್ತೆ ಕೇಳಲಾಗುತ್ತದೆ; ಕೊನೆಯ ಬಾರಿಯ ನಂತರ ನಿಮಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ | A supplier who has not answered is asked again after 4, 24 hours; after the last time you are told |  |
| `cert.notAGrade` | ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ. | This counts the situations tried. It does not grade the agent. |  |
| `cert.didNotHold` | ತಪ್ಪಿದವು | Did not hold |  |
| `cert.handRunLine` | ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ (stand-in services). ಯಾವ ಹಣವೂ ಚಲಿಸಲಿಲ್ಲ. | Checks were run by hand against stand-in services, not real WhatsApp. No money moved. |  |
| `cert.checkedOn` | ಪರಿಶೀಲನೆ ನಡೆದದ್ದು | Checks run on |  |
| `goLive.heading` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ | Go-live checks |  |
| `goLive.own` | ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ. | The go-live checks ran on this shop's own settings, in the go-live certificate of 2 Nov 2026. |  |
| `goLive.example` | 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Unisex Salon ಮೇಲೆ ನಡೆದವು, ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ. | The go-live certificate of 2 Nov 2026 says its checks ran on the example shop, Glow Unisex Salon, not on this shop's own settings. |  |
| `goLive.different` | 2 Nov 2026 ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ. | The go-live certificate of 2 Nov 2026 says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave. |  |
| `goLive.untrusted` | ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಈ ಏಜೆಂಟ್‌ನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ. | A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used. |  |
| `goLive.none` | ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ. | No go-live certificate was given, so this document does not say what the go-live checks ran on. |  |
| `goLive.signedWith` | ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು key-3f9a1c ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ. | The go-live certificate is signed with key-3f9a1c. A key does not show who holds it. |  |
| `page.numbers` | ಅಂಕಿಅಂಶಗಳು | The numbers |  |
| `page.item` | ಏನು | What |  |
| `page.count` | ಎಷ್ಟು | How many |  |
| `page.amount` | ಮೊತ್ತ | Amount |  |
| `page.ordersHeading` | ಈ ತಿಂಗಳು ಒಪ್ಪಿದ ಆರ್ಡರ್‌ಗಳು | Orders approved in this month |  |
| `page.budgetHeading` | ತಿಂಗಳ ಬಜೆಟ್ | The month's budget |  |
| `page.monthlyBudget` | ತಿಂಗಳ ಬಜೆಟ್ | Budget for the month |  |
| `page.ownersNoteHeading` | ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿ | Your own note |  |
| `page.suppliersHeading` | ಪೂರೈಕೆದಾರರ ಪ್ರಕಾರ | By supplier |  |
| `page.supplier` | ಪೂರೈಕೆದಾರ | Supplier |  |
| `page.stoppedHeading` | ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು | What your limits stopped |  |
| `page.rule` | ಮಿತಿ | Limit |  |
| `page.times` | ಬಾರಿ | Times |  |
| `page.notCountedHeading` | ಎಣಿಸದ್ದು | Not counted |  |
| `page.notTestedHeading` | ಪರಿಶೀಲಿಸದ್ದು | Not tested |  |
| `page.unconfirmed` | WhatsApp ದೃಢಪಡಿಸದ ಆರ್ಡರ್ ಸಂದೇಶಗಳು | Order messages WhatsApp did not confirm |  |
| `page.checkHeading` | ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ | Check this document |  |
| `page.code` | ಕೋಡ್ | Code |  |
| `page.digest` | ಡೈಜೆಸ್ಟ್ | Digest |  |
| `page.countedFrom` | ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು | Counted from |  |
| `page.setUpBy` | ಸಿದ್ಧಪಡಿಸಿದವರು | Set up by |  |
| `page.madeOn` | ಮಾಡಿದ ದಿನ | Made on |  |
| `page.signedBy` | ಸಹಿ ಮಾಡಿದವರು | Signed by |  |
| `page.notSigned` | ಸಹಿ ಇಲ್ಲ | Not signed |  |
| `page.signatureNote` | ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ. | A signature shows who made this document and that it has not changed. It does not show that what it counts is complete. |  |
| `page.scanToCheck` | ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಆಪರೇಟರ್ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ. | Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your Operator or Geometer's team gave you. |  |
| `page.scanSummary` | ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಈ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಅಥವಾ ಲಿಂಕ್ ತೆರೆಯಿರಿ. ದಾಖಲೆ ನಿಜವಾದುದೇ, ಅದನ್ನು ಯಾರು ನೀಡಿದರು, ಮತ್ತು ಈ ಪುಟದೊಂದಿಗೆ ಹೋಲಿಸಲು ಲೆಕ್ಕಗಳನ್ನು ಅದು ತೋರಿಸುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ದಾಖಲೆಯ ಬಗ್ಗೆ ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲೆಕ್ಕಗಳು ಸತ್ಯ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ. | Scan this code, or open the link, to check this paper on geometer.dev. It shows whether the paper is genuine, who issued it, and the figures to compare with this page. The check runs on your phone and nothing about the paper is sent. It does not show that the numbers are true. |  |
| `page.notAGrade` | ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ. | These are counts of what the record shows. They do not grade the agent. |  |
| `page.period` | ಅವಧಿ | Period |  |
| `page.showWhatWeDid` | ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸ | Show what we did ▸ |  |
| `page.byActionHeading` | ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ | What the agent did, by action |  |
| `page.action` | ಕೆಲಸ | Action |  |
| `page.agentVersion` | ಏಜೆಂಟ್ ಆವೃತ್ತಿ | Agent version |  |
| `page.limitsDigest` | ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್ | Limits digest |  |
| `page.recordDigest` | ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್ | Record digest |  |
| `page.liveServices` | ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು | Live services |  |

| `pages.block.locked` | ಈಗ ಮಾಲೀಕರ ಬಳಿ ಅವರ ಸ್ವಂತ ಸೈನ್ ಇನ್ ಇದೆ. ಹೊಸ ಫೋನ್ ಅನ್ನು ಮಾಲೀಕರ ಆಪ್‌ನಿಂದ ಅಥವಾ ಮಾಲೀಕರ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಸೇರಿಸಲಾಗುತ್ತದೆ. | The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes. |  |
| `pages.block.askRemove` | ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿ | Ask to remove the owner's passkeys |  |
| `pages.block.askRemoveNote` | ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ಕಳೆದುಕೊಂಡು, ಕೋಡ್‌ಗಳೂ ಇಲ್ಲದ ಮಾಲೀಕರಿಗಾಗಿ. ಮಾಲೀಕರಿಗೆ ತಕ್ಷಣ ತಿಳಿಸಲಾಗುತ್ತದೆ, ಅವರು ರದ್ದುಗೊಳಿಸಬಹುದು; ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 48 ಗಂಟೆಗಳ ನಂತರ ಆಗುತ್ತದೆ, ಆಗ ಮಾತ್ರ ಹೊಸ ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಬಹುದು. | For an owner who lost every phone and has no codes. The owner is told at once and can cancel; if they do not, it happens after 48 hours, and only then can you show a new setup QR code. |  |
| `pages.block.requested` | ಕೇಳಲಾಗಿದೆ. ಮಾಲೀಕರಿಗೆ ಈಗ ಅವರ ಆಪ್‌ನಲ್ಲಿ ಕಾಣುತ್ತದೆ. ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 48 ಗಂಟೆಗಳಲ್ಲಿ ಆಗುತ್ತದೆ. | Asked. The owner sees it in their app now. If they do not cancel, it happens in 48 hours. |  |
| `pages.block.pending` | Divya ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ಮಾಲೀಕರು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 2026-11-21 10:00 UTC ರಂದು ಆಗುತ್ತದೆ. | Divya asked to remove the owner's passkeys. It happens on 2026-11-21 10:00 UTC unless the owner cancels. |  |
| `pages.block.resetLine` | 2026-11-19 ರಂದು Geometer ಮಾಲೀಕರ ಸೈನ್ ಇನ್ ರೀಸೆಟ್ ಮಾಡಿದೆ: the owner lost every phone | Geometer reset the owner's sign-in on 2026-11-19: the owner lost every phone |  |
| `pages.block.lockedNotice` | ಈಗ ಮಾಲೀಕರ ಬಳಿ ಅವರ ಸ್ವಂತ ಸೈನ್ ಇನ್ ಇದೆ. ಹೊಸ ಫೋನ್ ಅನ್ನು ಮಾಲೀಕರ ಆಪ್‌ನಿಂದ ಅಥವಾ ಮಾಲೀಕರ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಸೇರಿಸಲಾಗುತ್ತದೆ. | The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes. |  |
| `phones.title` | ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲ ಫೋನ್‌ಗಳು | Phones that can open your shop |  |
| `phones.link` | ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲ ಫೋನ್‌ಗಳು | Phones that can open your shop |  |
| `phones.intro` | ಈ ಫೋನ್‌ಗಳು ಮಾತ್ರ ನಿಮ್ಮ ಅಂಗಡಿಯ ಆಪ್ ತೆರೆಯಬಲ್ಲವು. ನಿಮಗೆ ಗೊತ್ತಿಲ್ಲದ ಒಂದು ಕಂಡರೆ ಅದನ್ನು ತೆಗೆಯಿರಿ. | Only these phones can open your shop's app. If you see one you do not know, remove it. |  |
| `phones.thisPhone` | ಈ ಫೋನ್ | This phone |  |
| `phones.aPhone` | ಒಂದು ಫೋನ್ | A phone |  |
| `phones.added` | 19 Nov 2026 ರಂದು ಸೇರಿಸಲಾಗಿದೆ | Added 19 Nov 2026 |  |
| `phones.via.setup` | ಸೆಟಪ್ QR ಕೋಡ್‌ನಿಂದ | with the setup QR code |  |
| `phones.via.recovery` | ರಿಕವರಿ ಕೋಡ್‌ನಿಂದ | with a recovery code |  |
| `phones.via.own_phone` | ನಿಮ್ಮ ಸ್ವಂತ ಫೋನ್‌ನಿಂದ | from your own phone |  |
| `phones.via.reset` | Geometer ನಿಮ್ಮ ಸೈನ್ ಇನ್ ರೀಸೆಟ್ ಮಾಡಿದ ನಂತರ | after Geometer reset your sign-in |  |
| `phones.lastUsed` | ಕೊನೆಯ ಬಳಕೆ 19 Nov, 3:42 pm | Last used 19 Nov, 3:42 pm |  |
| `phones.neverUsed` | ಇನ್ನೂ ಬಳಸಿಲ್ಲ | Not used yet |  |
| `phones.remove` | ತೆಗೆಯಿರಿ | Remove |  |
| `phones.removeTitle` | ಈ ಫೋನ್ ತೆಗೆಯಬೇಕೇ? | Remove this phone? |  |
| `phones.removeAsk` | Android, Chrome ಇನ್ನು ಮುಂದೆ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಲು ಆಗುವುದಿಲ್ಲ. | Android, Chrome will not be able to open your shop any more. |  |
| `phones.removeYes` | ಹೌದು, ತೆಗೆಯಿರಿ | Yes, remove it |  |
| `phones.keep` | ಬೇಡ, ಇರಲಿ | No, keep it |  |
| `phones.lastTitle` | ಇದು ನಿಮ್ಮ ಒಂದೇ ಫೋನ್ | This is your only phone |  |
| `phones.lastAsk` | ಇದನ್ನು ತೆಗೆದರೆ ನಿಮ್ಮ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಅಥವಾ ಆಪರೇಟರ್ ಸಹಾಯದಿಂದ ಮಾತ್ರ ಮತ್ತೆ ಒಳಗೆ ಬರಬಹುದು; ಅದಕ್ಕೆ 2 ದಿನ ಹಿಡಿಯುತ್ತದೆ. ಆದರೂ ತೆಗೆಯಬೇಕೇ? | If you remove it, you can only get back in with your own recovery codes, or with your Operator's help, which takes 2 days. Remove it anyway? |  |
| `phones.lastYes` | ಹೌದು, ನನ್ನ ಒಂದೇ ಫೋನ್ ತೆಗೆಯಿರಿ | Yes, remove my only phone |  |
| `phones.removed` | ಆ ಫೋನ್ ತೆಗೆಯಲಾಗಿದೆ. | That phone is removed. |  |
| `phones.add` | ಫೋನ್ ಸೇರಿಸಿ | Add a phone |  |
| `phones.addNote` | ಈ ಪರದೆಯಲ್ಲಿ ಒಮ್ಮೆ ಮಾತ್ರ ಕೆಲಸ ಮಾಡುವ ಕೋಡ್ ತೋರಿಸುತ್ತದೆ. 15 ನಿಮಿಷದೊಳಗೆ ಹೊಸ ಫೋನ್‌ನ ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. | Shows a one-use code on this screen. Scan it with the new phone's camera within 15 minutes. |  |
| `phones.addTitle` | ಹೊಸ ಫೋನ್ ಸೇರಿಸಿ | Add a new phone |  |
| `phones.addHow` | ಇದನ್ನು ಹೊಸ ಫೋನ್‌ನ ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ, ಅದರ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್ ರೀಡರ್ ಮುಟ್ಟಿ. ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, 4:30 pm ವರೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ. | Scan this with the new phone's camera and touch its fingerprint reader. It works once, until 4:30 pm. |  |
| `phones.codes` | ನಿಮ್ಮ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳು | Your own recovery codes |  |
| `phones.codesNone` | ನೀವು ಇನ್ನೂ ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿಲ್ಲ. | You have not made your own codes yet. |  |
| `phones.codesHave` | ನೀವು 19 Nov 2026 ರಂದು ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿದಿರಿ. ಅವು ನಿಮ್ಮ ಬಳಿ ಮಾತ್ರ ಇವೆ. | You made your own codes on 19 Nov 2026. Only you hold them. |  |
| `phones.codesMake` | ನನ್ನ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ | Make my own recovery codes |  |
| `phones.codesRemake` | ಹೊಸ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ | Make new codes |  |
| `phones.codesNote` | ಕೋಡ್‌ಗಳು ಒಮ್ಮೆ ಮಾತ್ರ ತೋರುತ್ತವೆ. ಆಪರೇಟರ್ ಪ್ರಿಂಟ್ ಮಾಡಿದ ಕೋಡ್‌ಗಳು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. | The codes show once. The codes your Operator printed stop working. |  |
| `phones.codesTitle` | ನಿಮ್ಮ ರಿಕವರಿ ಕೋಡ್‌ಗಳು | Your recovery codes |  |
| `phones.codesShow` | ಇವನ್ನು ಬರೆದಿಟ್ಟು ಸುರಕ್ಷಿತವಾಗಿ ಇಡಿ. ಪ್ರತಿಯೊಂದೂ ಒಮ್ಮೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ, ಮತ್ತೆ ತೋರಿಸುವುದಿಲ್ಲ. ಆಪರೇಟರ್ ಪ್ರಿಂಟ್ ಮಾಡಿದ ಕೋಡ್‌ಗಳು ಇನ್ನು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ. | Write these down and keep them safe. Each works once, and they are never shown again. The codes your Operator printed no longer work. |  |
| `phones.needPasskey` | ಕೋಡ್ ಮಾಡಲು ಅಥವಾ ಫೋನ್ ಸೇರಿಸಲು ಸೈನ್ ಔಟ್ ಆಗಿ, ಫೋನ್‌ನ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್ ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ. | To make codes or add a phone, sign out and sign in again with your phone's fingerprint or screen lock. |  |
| `phones.back` | ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ | Back to your shop |  |
| `phones.onePhone` | ಈಗ ಒಂದು ಫೋನ್ ಮಾತ್ರ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲದು. | Only one phone can open your shop now. |  |
| `phones.noPhones` | ಈಗ ಯಾವ ಫೋನ್ ಕೂಡ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಲಾರದು. ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಬಳಸಿ, ಅಥವಾ ಆಪರೇಟರ್ ಅವರನ್ನು ಕೇಳಿ. | No phone can open your shop now. Use your recovery codes, or ask your Operator. |  |
| `phones.bannerNew` | 19 Nov, 3:42 pm ರಂದು ಹೊಸ ಫೋನ್ ಸೇರಿಸಲಾಗಿದೆ (Android, Chrome). ನೀವಲ್ಲವೇ? ಅದನ್ನು ತೆಗೆಯಿರಿ. | A new phone was added on 19 Nov, 3:42 pm (Android, Chrome). Not you? Remove it. |  |
| `phones.itWasMe` | ನಾನೇ | It was me |  |
| `phones.removeIt` | ತೆಗೆಯಿರಿ | Remove it |  |
| `phones.bannerRequest` | Divya ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 21 Nov, 10:00 am ರಂದು ಆಗುತ್ತದೆ. | Divya asked to remove every phone that can open your shop. It will happen on 21 Nov, 10:00 am unless you cancel. |  |
| `phones.cancel` | ಮನವಿ ರದ್ದುಗೊಳಿಸಿ | Cancel the request |  |
| `phones.cancelled` | ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ಫೋನ್‌ಗಳು ಹಾಗೆಯೇ ಇರುತ್ತವೆ. | Cancelled. Your phones stay. |  |
| `phones.bannerCodes` | ನಿಮ್ಮ ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಈಗಲೇ ಮಾಡಿ, ಅವು ನಿಮ್ಮ ಬಳಿ ಮಾತ್ರ ಇರಲಿ. | Make your own codes now, so only you hold them. |  |
| `phones.makeCodes` | ನನ್ನ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ | Make my codes |  |
| `phones.refused` | ಅದು ಆಗಲಿಲ್ಲ. ಸೈನ್ ಔಟ್ ಆಗಿ, ಫೋನ್‌ನ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ. | That did not work. Sign out, sign in with your phone's fingerprint and try again. |  |
| `phones.operator` | ನಿಮ್ಮ ಆಪರೇಟರ್ | Your Operator |  |
| `phones.openPhones` | ನಿಮ್ಮ ಫೋನ್‌ಗಳು | Your phones |  |
| `phones.lostHelp` | ಎಲ್ಲಾ ಫೋನ್‌ಗಳು ಮತ್ತು ಕೋಡ್‌ಗಳನ್ನು ಕಳೆದುಕೊಂಡಿರಾ, ಅಥವಾ ಆಪರೇಟರ್ ಸಹಾಯ ಮಾಡುತ್ತಿಲ್ಲವೇ? hello@geometer.dev ಗೆ ಬರೆಯಿರಿ. | Lost every phone and your codes, or your Operator will not help? Write to hello@geometer.dev. |  |
| `phones.alert.newPhone` | ನಿಮ್ಮ ಅಂಗಡಿಗೆ 19 ನವೆಂ, 3:42 PM ರಂದು ಹೊಸ ಫೋನ್ ಸೇರಿಸಲಾಗಿದೆ (Android, Chrome). ನೀವಲ್ಲವೇ? ಆಪ್ ತೆರೆದು ಇದನ್ನು ತೆಗೆಯಿರಿ. | A new phone was added to your shop on 19 Nov, 3:42 pm (Android, Chrome). Not you? Open your app and remove it. |  |
| `phones.alert.request` | Divya ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 2 ದಿನದಲ್ಲಿ ಆಗುತ್ತದೆ. ನಿಲ್ಲಿಸಲು ನಿಮ್ಮ ಆಪ್ ತೆರೆಯಿರಿ. | Divya asked to remove every phone that opens your shop. It happens in 2 days unless you cancel. Open your app to stop it. |  |
