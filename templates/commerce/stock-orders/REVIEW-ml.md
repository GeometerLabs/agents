# Review sheet: Malayalam (ml), Stock orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Stock orders agent says in Malayalam. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Glow Unisex Salon's (a made-up salon): 10 boxes of hair colour at ₹450 a box from Ravi Traders, a total of ₹4,500.

What to look for first: (1) is each message polite, short and something a salon owner and a wholesaler would really send to each other; (2) are "order", "supplier", "budget", "approve", "box" and "received" the words people use; (3) the owner's typed words "yes CODE", "no CODE", "received po-3", "paid po-3", "cancel po-3" and "send po-3" stay in Latin letters, as they are typed.

Amounts are always written as ₹4,500 with Western digits; items, units, quantities, suppliers and order numbers are filled in from the shop's record, never translated.

## 1. Messages to the supplier (6)

The order and every ask after it are WhatsApp templates (the supplier has usually not written for a day). Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Malayalam) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `supplier_order` | To the supplier: the order itself, as a WhatsApp template (the supplier has usually not written in the last day) | പുതിയ ഓർഡർ po-3 (Glow Unisex Salon-ൽ നിന്ന്): 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. ഇത് നൽകാൻ കഴിയുമെങ്കിൽ "OK" എന്നും കഴിയില്ലെങ്കിൽ "NO" എന്നും മറുപടി തരൂ. | New order po-3 from Glow Unisex Salon: 10 × hair colour (box), ₹450 per box, total ₹4,500. Please reply OK to confirm you can supply it, or NO if you cannot. |  |
| `supplier_check` | To the supplier: a silent supplier is asked again about the same order (a reminder, not a new order) | നേരത്തെ അയച്ച ഓർഡർ po-3-നെക്കുറിച്ചുള്ള ഓർമ്മപ്പെടുത്തൽ (Glow Unisex Salon-ൽ നിന്ന്): 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. ഇത് അതേ ഓർഡറാണ്, പുതിയതല്ല. നൽകാൻ കഴിയുമെങ്കിൽ "OK" എന്നും കഴിയില്ലെങ്കിൽ "NO" എന്നും മറുപടി തരൂ. | Reminder about order po-3 from Glow Unisex Salon, sent earlier: 10 × hair colour (box), ₹450 per box, total ₹4,500. This is the same order, not a new one. Please reply OK to confirm, or NO if you cannot supply it. |  |
| `supplier_which` | To the supplier: a bare OK while several orders wait for their answer | Glow Unisex Salon-ന്റെ ഒന്നിലധികം ഓർഡറുകൾ നിങ്ങളുടെ മറുപടിക്ക് കാത്തിരിക്കുന്നു (po-3). ഓർഡർ സന്ദേശത്തിലെ ബട്ടൺ ഉപയോഗിക്കൂ, അല്ലെങ്കിൽ "OK" അല്ലെങ്കിൽ "NO" എന്നെഴുതി ഓർഡർ നമ്പർ ചേർക്കൂ. | Several orders from Glow Unisex Salon are waiting for your answer (po-3). Please answer with the button on the order message, or write OK or NO followed by the order number. |  |
| `supplier_unclear` | To the supplier: their message was not an OK or a NO | നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി. Glow Unisex Salon-ന്റെ ഓർഡർ po-3-ന് മറുപടി നൽകാൻ "OK" അല്ലെങ്കിൽ "NO" എന്ന് എഴുതൂ, അല്ലെങ്കിൽ ഓർഡർ സന്ദേശത്തിലെ ബട്ടൺ ഉപയോഗിക്കൂ. | Thank you for your message. To answer order po-3 from Glow Unisex Salon, please reply OK or NO, or use the button on the order message. |  |
| `supplier_thanks_yes` | To the supplier: their OK is noted | നന്ദി. ഓർഡർ po-3 നിങ്ങൾ സ്ഥിരീകരിച്ചതായി രേഖപ്പെടുത്തി. | Thank you. Order po-3 is noted as confirmed by you. |  |
| `supplier_thanks_no` | To the supplier: their NO is noted | നന്ദി. ഓർഡർ po-3 നിങ്ങൾക്ക് നൽകാൻ കഴിയില്ലെന്ന് രേഖപ്പെടുത്തി. | Thank you. Order po-3 is noted as not supplied by you. |  |

## 2. Messages to the owner (37)

| Template id | When it is sent | Text (Malayalam) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `card` | To the owner: the order for approval, with the budget, and the code to approve or decline | അനുമതിക്കായി ഓർഡർ po-3: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500, Ravi Traders-ൽ നിന്ന്. ഈ മാസം നിങ്ങളുടെ ₹20,000 ബജറ്റിൽ ₹0 മാറ്റിവച്ചിട്ടുണ്ട്, ഈ ഓർഡറിന് ശേഷം ₹15,500 ബാക്കി. ബട്ടൺ അമർത്തി അനുവദിക്കൂ, അല്ലെങ്കിൽ "yes K7M2QX" എന്ന് മറുപടി നൽകൂ. വേണ്ടെങ്കിൽ "no K7M2QX" എന്ന് നൽകൂ. | Order po-3 for your approval: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. This month ₹0 of your ₹20,000 budget is reserved, so ₹15,500 is left after this order. Approve with the button, or reply "yes K7M2QX". To decline reply "no K7M2QX". |  |
| `card_changed` | To the owner: the order changed since a card was shown, so the new card follows | ആ കാർഡിന് ശേഷം ഓർഡർ മാറി, അതിനാൽ പഴയ കാർഡ് സാധുവല്ല, ഒന്നും അയച്ചില്ല. ഇപ്പോഴത്തെ കാർഡ് ഇതാ: | The order changed since that card, so the earlier card no longer counts and nothing was sent. Here is the card as it is now: |  |
| `card_closed` | To the owner: a card that was answered or replaced is used again | ആ കാർഡിന് ഇതിനകം മറുപടി നൽകി, അല്ലെങ്കിൽ പുതിയ കാർഡ് വന്നു, അതിനാൽ ഒന്നും ചെയ്തില്ല. | That card was already answered or replaced, so nothing was done. |  |
| `card_expired` | To the owner: a card ran out (a day) and nothing was sent | ആ കാർഡിന്റെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും അയച്ചില്ല. ഇപ്പോഴും വേണമെങ്കിൽ വീണ്ടും പറയൂ. | That card ran out, so nothing was sent. Ask me again if you still want it. |  |
| `card_unknown` | To the owner: a code that no card has | ആ കോഡുള്ള കാർഡ് എന്റെ പക്കലില്ല, അതിനാൽ ഒന്നും ചെയ്തില്ല. | I have no card with that code, so nothing was done. |  |
| `order_declined` | To the owner: the owner declined; nothing was sent | ഓർഡർ po-3 വേണ്ടെന്ന് വച്ചു. Ravi Traders-ന് ഒന്നും അയച്ചില്ല. | Order po-3 is declined. Nothing was sent to Ravi Traders. |  |
| `order_approved` | To the owner: approved, the budget reserved, sending now | ഓർഡർ po-3 അനുവദിച്ചു: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500, Ravi Traders-ൽ നിന്ന്. ഈ മാസത്തെ ബജറ്റിൽ നിന്ന് ₹4,500 മാറ്റിവച്ചു, ₹15,500 ബാക്കി. ഇപ്പോൾ വിതരണക്കാരന് അയയ്ക്കുന്നു. | Order po-3 is approved: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. ₹4,500 is now reserved from this month's budget and ₹15,500 is left. Sending it to the supplier now. |  |
| `sent_ok` | To the owner: the order message went to the supplier | ഓർഡർ po-3 Ravi Traders-ന് അയച്ചു. അവർ ഇതുവരെ മറുപടി തന്നിട്ടില്ല. മിണ്ടാതിരുന്നാൽ ഞാൻ വീണ്ടും ചോദിക്കും. | Order po-3 went to Ravi Traders. They have not answered yet. I will ask again if they stay silent. |  |
| `sent_unknown` | To the owner: WhatsApp did not confirm the order message; it will not be sent again | ഓർഡർ po-3 Ravi Traders-ൽ എത്തിയോ എന്ന് WhatsApp ഉറപ്പിച്ചില്ല. ഞാൻ ഓർഡർ വീണ്ടും അയയ്ക്കില്ല. പകരം Ravi Traders-നോട് po-3-നെക്കുറിച്ച് ചോദിച്ച് അവർ പറയുന്നത് നിങ്ങളെ അറിയിക്കും. | Order po-3 may or may not have reached Ravi Traders: WhatsApp did not confirm it. I will not send the order again. I will ask Ravi Traders about po-3 instead, and tell you what they say. |  |
| `send_failed` | To the owner: WhatsApp refused the order message; nothing went out | ഓർഡർ po-3 Ravi Traders-ന് പോയില്ല: WhatsApp നിരസിച്ചു, അതിനാൽ ഒന്നും അയച്ചില്ല. ബജറ്റ് മാറ്റിവച്ചതായി തുടരുന്നു. വീണ്ടും ശ്രമിക്കാൻ "send po-3" എന്നും ഒഴിവാക്കാൻ "cancel po-3" എന്നും നൽകൂ. | Order po-3 did not go to Ravi Traders: WhatsApp refused it, so nothing was sent. The budget stays reserved. Reply "send po-3" to try again, or "cancel po-3" to release it. |  |
| `send_blocked` | To the owner: a check held the order message back (for example the supplier asked for no more messages) | ഓർഡർ po-3 Ravi Traders-ന് അയച്ചില്ല: ഒരു പരിശോധന തടഞ്ഞു, ഉദാഹരണത്തിന് അവർ ഇനി സന്ദേശം വേണ്ടെന്ന് പറഞ്ഞതിനാൽ. ഒന്നും പോയില്ല. ബജറ്റ് വിടുവിക്കാൻ "cancel po-3" എന്ന് നൽകൂ. | Order po-3 was not sent to Ravi Traders: a check held it back, for example because they asked for no more messages. Nothing went out. Reply "cancel po-3" to release the budget. |  |
| `owner_supplier_accepted` | To the owner: the supplier said OK (a template; it says this is not delivery) | വിതരണക്കാരൻ Ravi Traders ഓർഡർ po-3 സ്ഥിരീകരിച്ചു: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. അവർ നൽകും എന്നാണ് ഇതിനർത്ഥം, സാധനം എത്തി എന്നല്ല. സാധനം വരുമ്പോൾ "received po-3" എന്ന് നൽകൂ. | Order po-3 confirmed by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. This means they will supply it, not that it has arrived. When it comes, reply "received po-3". |  |
| `owner_supplier_declined` | To the owner: the supplier said NO (a template); the budget is released | വിതരണക്കാരൻ Ravi Traders ഓർഡർ po-3 നിരസിച്ചു: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. സാധനം വരില്ല, മാറ്റിവച്ച തുക ഈ മാസത്തെ ബജറ്റിലേക്ക് തിരികെ വന്നു. മറ്റൊരു വിതരണക്കാരനെ തിരഞ്ഞെടുക്കൂ. | Order po-3 was declined by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. Nothing is coming, and the money reserved is released back to this month's budget. Please choose another supplier. |  |
| `owner_supplier_silent` | To the owner: no answer after the last follow-up (a template) | വിതരണക്കാരൻ Ravi Traders-ൽ നിന്ന് ഓർഡർ po-3-ന് 24 മണിക്കൂറിന് ശേഷവും മറുപടിയില്ല: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. ഞാൻ വീണ്ടും ചോദിച്ചു, പുതിയ ഓർഡർ അയയ്ക്കില്ല. അവരെ വിളിക്കൂ. ഓർഡർ സ്ഥിരീകരിച്ചിട്ടില്ല. | No answer yet to order po-3 from the supplier, Ravi Traders, after 24 hours: 10 × hair colour (box), ₹450 per box, total ₹4,500. I asked again and will not send a new order. Please call them. The order is not confirmed. |  |
| `owner_supplier_stopped` | To the owner: a supplier asked for no more messages | വിതരണക്കാരൻ Ravi Traders ഇനി സന്ദേശം വേണ്ടെന്ന് പറഞ്ഞു, അതിനാൽ ഞാൻ അവർക്ക് വീണ്ടും സന്ദേശം അയയ്ക്കില്ല. അവർക്കുള്ള ഓർഡർ അയയ്ക്കാതെ കിടക്കും, ഏതെന്ന് ഞാൻ പറയാം. | Supplier Ravi Traders asked for no more messages, so I will not message them again. Any order waiting for them stays unsent, and I will tell you which. |  |
| `received_full` | To the owner: all of the order is marked received (the owner's own mark) | മുഴുവൻ സാധനവും കിട്ടി എന്ന് രേഖപ്പെടുത്തി: ഓർഡർ po-3, 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500. ഇത് നിങ്ങളുടെ രേഖപ്പെടുത്തലാണ്, വിതരണക്കാരന്റേതല്ല. പണമടയ്ക്കൽ വേറെയാണ്: അടച്ചാൽ "paid po-3" എന്ന് നൽകൂ. | Marked received, all of it: order po-3, 10 × hair colour (box), ₹450 per box, total ₹4,500. This is your mark, not the supplier's. Payment is separate: reply "paid po-3" when you have paid. |  |
| `received_part` | To the owner: part of the order is marked received | രേഖപ്പെടുത്തി: ഓർഡർ po-3 (ഹെയർ കളർ) ലെ 10-ൽ 4 കിട്ടി. 6 വരാനുണ്ട്. ബാക്കി വരുമ്പോൾ "received po-3 6" എന്ന് നൽകൂ. | Marked: 4 of 10 received for order po-3 (hair colour). 6 still to come. Reply "received po-3 6" when the rest arrives. |  |
| `received_wrong` | To the owner: the wrong item is marked | രേഖപ്പെടുത്തി: ഓർഡർ po-3 (ഹെയർ കളർ) ന് തെറ്റായ സാധനം വന്നു. ഇത് കിട്ടിയതായി കണക്കാക്കിയില്ല. Ravi Traders-നോട് സംസാരിക്കൂ: ഞാൻ അവർക്ക് ഒന്നും അയച്ചിട്ടില്ല. | Marked: the wrong item came for order po-3 (hair colour). It is not counted as received. Please sort it out with Ravi Traders: I sent them nothing. |  |
| `receive_too_many` | To the owner: more marked received than is still to come | നിങ്ങൾ 9 എന്ന് എഴുതി, പക്ഷേ ഓർഡർ po-3-ൽ 6 മാത്രമേ വരാനുള്ളൂ. ഒന്നും രേഖപ്പെടുത്തിയില്ല. യഥാർത്ഥത്തിൽ എന്താണ് വന്നതെന്ന് പറയൂ. | You wrote 9, but only 6 of order po-3 are still to come. Nothing was marked. Please tell me what actually arrived. |  |
| `order_not_open` | To the owner: a command that cannot apply to the order now, with what it is waiting on | ഓർഡർ po-3 ഇപ്പോൾ ഇങ്ങനെ മാറ്റാനാവില്ല: അത് അയച്ചു, മറുപടി വന്നിട്ടില്ല. | Order po-3 cannot be changed that way now: it is sent, no answer yet. |  |
| `paid_outside_noted` | To the owner: the owner's note that they paid outside the chat | രേഖപ്പെടുത്തി: ഓർഡർ po-3-ന്റെ പണം നിങ്ങൾ ഈ ചാറ്റിന് പുറത്ത് സ്വയം അടച്ചു. ഞാൻ ഒന്നും അടച്ചിട്ടില്ല, പരിശോധിക്കാനും കഴിയില്ല: ഇത് നിങ്ങളുടെ രേഖപ്പെടുത്തൽ മാത്രം. | Noted: you paid for order po-3 yourself, outside this chat. I paid nothing and cannot check it: it is only your mark. |  |
| `cannot_change` | To the owner: an approved order cannot be changed | ഓർഡർ po-3 ഇതിനകം അനുവദിച്ചു, അതിനാൽ മാറ്റാനാവില്ല. തെറ്റാണെങ്കിൽ Ravi Traders-നോട് നേരിട്ട് പറയൂ, എന്നിട്ട് എനിക്ക് പുതിയ അഭ്യർത്ഥന അയയ്ക്കൂ. | Order po-3 is already approved, so it cannot be changed. If it is wrong, ask Ravi Traders directly, then send me a new request. |  |
| `cancelled` | To the owner: an order is cancelled before it went to the supplier | ഓർഡർ po-3 റദ്ദാക്കി. ഒന്നും അയച്ചില്ല, അത് മാറ്റിവച്ച ബജറ്റ് തിരികെ കിട്ടി. | Order po-3 is cancelled. Nothing was sent, and any budget it held is released. |  |
| `cannot_cancel` | To the owner: an order already with the supplier cannot be cancelled here | ഓർഡർ po-3 ഇതിനകം Ravi Traders-ന്റെ പക്കലാണ്, അതിനാൽ ഇവിടെ നിന്ന് റദ്ദാക്കാനാവില്ല. അവരോട് നേരിട്ട് പറയൂ. | Order po-3 is already with Ravi Traders, so I cannot cancel it from here. Please tell them yourself. |  |
| `no_such_order` | To the owner: an order number the agent does not have | എന്റെ പക്കൽ ഓർഡർ po-3 ഇല്ല. | I have no order po-3. |  |
| `ask_line` | To the owner: more than one way to order an item; a list of the ways follows | ഹെയർ കളർ ഓർഡർ ചെയ്യാൻ ഒന്നിലധികം വഴികളുണ്ട്. ഏതാണ് ഉദ്ദേശിച്ചത്? | There is more than one way to order hair colour. Which one do you mean? |  |
| `ask_qty` | To the owner: how many (a low-stock mark with no usual quantity) | Ravi Traders-ൽ നിന്ന് ഹെയർ കളർ എത്ര ബോക്സ് ഓർഡർ ചെയ്യണം? ഒരു സംഖ്യ നൽകൂ. | How many box of hair colour from Ravi Traders should I order? Reply with a number. |  |
| `item_unknown` | To the owner: an item that is not in the catalogue, with what can be ordered | അത് നിങ്ങളുടെ പട്ടികയിലില്ല, അതിനാൽ ഒന്നും ഓർഡർ ചെയ്തില്ല. ഞാൻ ഓർഡർ ചെയ്യാവുന്നത്: ഹെയർ കളർ. | I do not have that in your catalogue, so nothing was ordered. I can order: hair colour. |  |
| `blocked_supplier` | To the owner: the supplier is not on the approved list, or is paused | ഒന്നും ഓർഡർ ചെയ്തില്ല: Ravi Traders നിങ്ങളുടെ അംഗീകൃത വിതരണക്കാരുടെ പട്ടികയിലില്ല, അല്ലെങ്കിൽ നിർത്തിവച്ചിരിക്കുന്നു. ആർക്കും ഒന്നും അയച്ചില്ല. | Nothing was ordered: Ravi Traders is not on your approved supplier list, or is paused. Nothing was sent to anyone. |  |
| `blocked_cap` | To the owner: the order is above the most one order may be worth | ഒന്നും ഓർഡർ ചെയ്തില്ല: 10 × ഹെയർ കളർ (ബോക്സ്), ഒരു ബോക്സ്-ന് ₹450, ആകെ ₹4,500 ഒരു ഓർഡറിന്റെ ₹12,000 പരിധിയേക്കാൾ കൂടുതലാണ്. കുറച്ച് ഓർഡർ ചെയ്യൂ, അല്ലെങ്കിൽ പരിധി മാറ്റാൻ നിങ്ങളുടെ ഓപ്പറേറ്ററോട് പറയൂ. | Nothing was ordered: 10 × hair colour (box), ₹450 per box, total ₹4,500 is more than the ₹12,000 one order may be worth. Order less, or ask your Operator to change the limit. |  |
| `blocked_budget` | To the owner: the order is more than is left of the month's budget | ഒന്നും ഓർഡർ ചെയ്തില്ല: ₹4,500 ഈ മാസത്തെ (Nov 2026) ₹20,000 ബജറ്റിൽ ബാക്കിയുള്ള ₹15,500-നേക്കാൾ കൂടുതലാണ്. | Nothing was ordered: ₹4,500 is more than the ₹15,500 left of this month's ₹20,000 budget (Nov 2026). |  |
| `blocked_qty` | To the owner: a quantity above the most one order may have (a typing slip) | ഒന്നും ഓർഡർ ചെയ്തില്ല: 9 ഒരു ഓർഡറിലെ 200-നേക്കാൾ കൂടുതലാണ്, ടൈപ്പ് ചെയ്തതിലെ പിഴവാകാം. സംഖ്യ വീണ്ടും എഴുതൂ. | Nothing was ordered: 9 is more than 200 in one order, which looks like a typing slip. Please write the number again. |  |
| `already_open` | To the owner: a low-stock mark for something already on order | Ravi Traders-ൽ നിന്ന് ഹെയർ കളർ-നുള്ള ഓർഡർ po-3 ഇതിനകം തുറന്നിരിക്കുന്നു, അതിനാൽ മറ്റൊന്ന് ഉണ്ടാക്കിയില്ല. കാണാൻ "status" എന്ന് നൽകൂ. | Order po-3 for hair colour from Ravi Traders is already open, so I did not make another. Reply "status" to see it. |  |
| `status` | To the owner: the open orders and the month's budget | തുറന്ന സ്റ്റോക്ക് ഓർഡറുകൾ: po-3: 10 × ഹെയർ കളർ (ബോക്സ്), Ravi Traders-ൽ നിന്ന്, ₹4,500, വിതരണക്കാരൻ സമ്മതിച്ചു, സാധനം എത്തിയിട്ടില്ല ഈ മാസം (Nov 2026) നിങ്ങളുടെ ₹20,000 ബജറ്റിൽ ₹0 മാറ്റിവച്ചിട്ടുണ്ട്. | Open stock orders: po-3: 10 × hair colour (box) from Ravi Traders, ₹4,500, supplier confirmed, not received yet This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `status_empty` | To the owner: no open orders, and the month's budget | തുറന്ന സ്റ്റോക്ക് ഓർഡറുകളൊന്നുമില്ല. ഈ മാസം (Nov 2026) നിങ്ങളുടെ ₹20,000 ബജറ്റിൽ ₹0 മാറ്റിവച്ചിട്ടുണ്ട്. | No open stock orders. This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `didnt_understand` | To the owner: the message was not understood, with examples | നിങ്ങൾക്ക് എന്താണ് വേണ്ടതെന്ന് എനിക്ക് മനസ്സിലായില്ല. ഉദാഹരണത്തിന് ഇങ്ങനെ എഴുതാം: "order 10 ബോക്സ് ഹെയർ കളർ from Ravi Traders", "received po-3", "paid po-3" അല്ലെങ്കിൽ "status". | I could not tell what you want. You can write, for example, "order 10 box hair colour from Ravi Traders", "received po-3", "paid po-3" or "status". |  |
| `owner_message_held` | To the owner: a message about an order was held back because it did not match the record | ഓർഡർ po-3-നെക്കുറിച്ചുള്ള ഒരു സന്ദേശം എന്റെ രേഖയുമായി ചേരാത്തതിനാൽ ഞാൻ തടഞ്ഞുവച്ചു. തെറ്റായ ഒന്നും അയച്ചില്ല. ഓർഡർ പരിശോധിക്കൂ. | I held back a message about order po-3 because it did not match my record. Nothing wrong was sent. Please check the order. |  |

### The words for what an order is waiting on (the status list)

| Id | Text (Malayalam) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `awaiting` | നിങ്ങളുടെ അനുമതിക്ക് കാത്തിരിക്കുന്നു | waiting for your approval |  |
| `sending` | അയയ്ക്കുന്നു | being sent |  |
| `sent` | അയച്ചു, മറുപടി വന്നിട്ടില്ല | sent, no answer yet |  |
| `unknown` | വിതരണക്കാരനിൽ എത്തിയോ എന്ന് ഉറപ്പില്ല | may not have reached the supplier |  |
| `accepted` | വിതരണക്കാരൻ സമ്മതിച്ചു, സാധനം എത്തിയിട്ടില്ല | supplier confirmed, not received yet |  |
| `part` | കുറച്ച് സാധനം എത്തി | part received |  |
| `failed` | അയച്ചില്ല (WhatsApp നിരസിച്ചു) | not sent (WhatsApp refused it) |  |
| `blocked` | അയച്ചില്ല (തടഞ്ഞു) | not sent (held back) |  |

### The words on the buttons and the list

A button is at most 20 letters and a label never carries an amount. A tap carries an id, so no one's words are read from these.

| Id | Text (Malayalam) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `approve` | അനുവദിക്കൂ | Approve |  |
| `decline` | വേണ്ട | Decline |  |
| `supplierYes` | ശരി | OK |  |
| `supplierNo` | നൽകാൻ കഴിയില്ല | Cannot supply |  |
| `choose` | തിരഞ്ഞെടുക്കൂ | Choose |  |

## 3. Months and weekdays as the agent writes them

| Weekday | Written in Malayalam | Native reviewer: OK / change to … |
| --- | --- | --- |
| Sunday | ഞായർ |  |
| Monday | തിങ്കൾ |  |
| Tuesday | ചൊവ്വ |  |
| Wednesday | ബുധൻ |  |
| Thursday | വ്യാഴം |  |
| Friday | വെള്ളി |  |
| Saturday | ശനി |  |

| Month | Written in Malayalam | Native reviewer: OK / change to … |
| --- | --- | --- |
| January | ജനുവരി |  |
| February | ഫെബ്രുവരി |  |
| March | മാർച്ച് |  |
| April | ഏപ്രിൽ |  |
| May | മേയ് |  |
| June | ജൂൺ |  |
| July | ജൂലൈ |  |
| August | ഓഗസ്റ്റ് |  |
| September | സെപ്റ്റംബർ |  |
| October | ഒക്ടോബർ |  |
| November | നവംബർ |  |
| December | ഡിസംബർ |  |

The agent names the month of the budget in English letters ("Nov 2026") in every language; a reviewer may ask for the local name.

