# Review sheet: Malayalam (ml), Orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Orders agent says or understands in Malayalam. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Annapurna Tiffins' (a made-up tiffin service): 2 × veg thali, a total of ₹240, an advance of ₹120.

What to look for first: (1) is each message polite, short and something a food shop would really send; (2) are "advance", "pickup", "delivery", "cut-off", "refund" and "owner" the words people use; (3) is the owner's "approve" / "deny" / "received" left in Latin letters, as the owner types it.

Amounts are always written as ₹1,200 with Western digits; items, quantities, days, times, places and links are filled in from the shop's record, never translated.

## 1. Messages to the customer (54)

| Template id | When it is sent | Text (Malayalam) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `menu` | A first hello, or a greeting: the menu with its prices, and the list of items to pick from | നമസ്കാരം! Annapurna Tiffins-ലേക്ക് സ്വാഗതം. ഞങ്ങളുടെ മെനു: veg thali ₹120, chicken meal ₹160, curd ₹20. എന്താണ് വേണ്ടത്, എത്ര, ഏത് ദിവസം, പിക്കപ്പ് ആണോ ഡെലിവറി ആണോ എന്ന് പറയൂ. | Hello! Welcome to Annapurna Tiffins. Our menu: veg thali ₹120, chicken meal ₹160, curd ₹20. Tell me what you would like, how many, which day, and pickup or delivery. |  |
| `pick_items` | The words above the list of items | നമസ്കാരം! Annapurna Tiffins-ലേക്ക് സ്വാഗതം. എന്താണ് ഓർഡർ ചെയ്യേണ്ടത്? | Hello! Welcome to Annapurna Tiffins. What would you like to order? |  |
| `ask_when` | The order has items but no day: which day | നിങ്ങളുടെ 2 × veg thali ഏത് ദിവസത്തേക്ക് വേണം? | Which day would you like your 2 × veg thali for? |  |
| `ask_how` | The order has no way yet, and the shop delivers: pickup or delivery (two buttons) | നിങ്ങൾ വന്ന് എടുക്കുമോ, അതോ ഡെലിവറി വേണോ? | Would you like to pick it up, or have it delivered? |  |
| `ask_slot` | The order has a day but no slot: pick a time from the list of slots still open | വ്യാഴം, 12 നവംബർ ഏത് സമയം? താഴെ നിന്ന് ഒരു സമയം തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ ഇഷ്ടമുള്ള സമയം എഴുതൂ. | Which time on Thu 12 Nov? Pick a slot below, or write the time you prefer. |  |
| `ask_address` | A delivery order: where to deliver, and the places the shop delivers to | എവിടെയാണ് ഡെലിവറി വേണ്ടത്? നിങ്ങളുടെ സ്ഥലവും പൂർണ്ണ വിലാസവും എഴുതൂ. ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നത്: Kakkanad, Edappally, Infopark. | Where should we deliver? Please write your area and full address. We deliver to: Kakkanad, Edappally, Infopark. |  |
| `confirm_details` | The customer wrote a weekday: the full date is read back, and they say yes | ഉറപ്പിക്കാൻ: 2 × veg thali, വ്യാഴം, 12 നവംബർ. തുടരാൻ "ശരി" എന്ന് മറുപടി അയയ്ക്കൂ. | Just to be sure: 2 × veg thali on Thu 12 Nov. Reply "yes" to continue. |  |
| `confirm_buttons` | The words above the Yes / No buttons of that read-back | ഉറപ്പിക്കാൻ: 2 × veg thali, വ്യാഴം, 12 നവംബർ. ഇത് ശരിയാണോ? | Just to be sure: 2 × veg thali on Thu 12 Nov. Is that right? |  |
| `price_floor` | The customer asked for a lower price: the menu price, and no lower | veg thali വില ₹120 ആണ്. ക്ഷമിക്കണം, ഇതിൽ കുറയ്ക്കാൻ കഴിയില്ല. | Our veg thali is ₹120, and I can't go lower than that. |  |
| `too_many_items` | One order has more items than the shop allows | ക്ഷമിക്കണം, ഒരു ഓർഡറിൽ പരമാവധി 10 സാധനങ്ങൾ മാത്രം. ദയവായി ചെറിയ ഓർഡർ അയയ്ക്കൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ. | Sorry, one order can have at most 10 items. Please send a smaller order, or talk to the owner. |  |
| `out_of_stock` | More of an item than is left for the day: how many are left | ക്ഷമിക്കണം, വ്യാഴം, 12 നവംബർ-ന് veg thali 3 എണ്ണം മാത്രമേ ബാക്കിയുള്ളൂ. ദയവായി ഓർഡർ മാറ്റൂ, അല്ലെങ്കിൽ മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ. | Sorry, only 3 veg thali left for Thu 12 Nov. Please change the order, or pick another day. |  |
| `sold_out` | An item is sold out for the day | ക്ഷമിക്കണം, വ്യാഴം, 12 നവംബർ-ന് veg thali തീർന്നു. ദയവായി മറ്റൊന്ന് തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ മറ്റൊരു ദിവസം. | Sorry, veg thali is sold out for Thu 12 Nov. Please pick something else, or another day. |  |
| `day_full` | The shop takes no more orders for that day | ക്ഷമിക്കണം, വ്യാഴം, 12 നവംബർ-ന് ഇനി ഓർഡറുകൾ എടുക്കാൻ കഴിയില്ല. ദയവായി മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ. | Sorry, we cannot take any more orders for Thu 12 Nov. Please pick another day. |  |
| `after_cutoff` | Orders for that day and slot have closed: when they closed | ക്ഷമിക്കണം, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലേക്കുള്ള ഓർഡറുകൾ ബുധൻ, 11 നവംബർ, രാത്രി 8:00-ന് അവസാനിച്ചു. ദയവായി മറ്റൊരു ദിവസമോ സമയമോ തിരഞ്ഞെടുക്കൂ. | Sorry, orders for Thu 12 Nov, 12:00 pm to 1:00 pm closed at Wed 11 Nov, 8:00 pm. Please pick another day or time. |  |
| `outside_area` | A delivery address names no place on the shop's list: the places it delivers to | ക്ഷമിക്കണം, ആ വിലാസത്തിലേക്ക് ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നില്ല. ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നത്: Kakkanad, Edappally, Infopark. പകരം വന്ന് എടുക്കാം. | Sorry, we do not deliver to that address. We deliver to: Kakkanad, Edappally, Infopark. You can pick up instead. |  |
| `quote_and_link` | The order is held: the items, the day and slot, the total, the advance and the payment link (UPI: with the UPI ID, and the owner confirms) | 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്. ആകെ ₹240. ഉറപ്പിക്കാൻ ₹120 ഇവിടെ അടയ്ക്കൂ: https://rzp.io/i/example (ഓർഡർ 30 മിനിറ്റ് നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്.) | 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: https://rzp.io/i/example (I'll hold your order for 30 minutes.) |  |
| `already_waiting` | The customer writes again while an order is held: the same link, not a second order | നിങ്ങളുടെ ഓർഡർ (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) മാറ്റിവച്ചിട്ടുണ്ട്. ഉറപ്പിക്കാൻ ₹120 അടയ്ക്കൂ: https://rzp.io/i/example | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is held. Pay ₹120 to confirm: https://rzp.io/i/example |  |
| `link_failed` | The payment link could not be made: nothing is ordered, the owner is told | ക്ഷമിക്കണം, ഇപ്പോൾ പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഒന്നും ഓർഡർ ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ. | Sorry, I couldn't create the payment link just now, so nothing is ordered. I've told the owner. Please try again in a few minutes. |  |
| `order_confirmed` | The payment record shows the advance (Razorpay): the order is confirmed, what is left to pay and the cancellation rule | ഓർഡർ ഉറപ്പായി! 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്. നിങ്ങളുടെ ₹120 അഡ്വാൻസ് ലഭിച്ചു. ₹120 പിക്കപ്പിന് അടയ്ക്കണം. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് 6 മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം. | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. We have received your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `hold_expired` | The hold ended before the advance was recorded | അഡ്വാൻസ് സമയത്ത് ലഭിക്കാത്തതിനാൽ നിങ്ങളുടെ ഓർഡർ (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) മാറ്റിവച്ചത് ഒഴിവാക്കി. ഇനിയും ഓർഡർ ചെയ്യണമെങ്കിൽ എനിക്ക് മെസ്സേജ് അയയ്ക്കൂ. | The hold on your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) has ended because the advance was not received in time. Message me if you'd still like to order. |  |
| `stock_gone_refund` | A payment arrived after the hold ended and the stock is gone: it is refunded | നിങ്ങളുടെ ₹120 പേയ്മെന്റ് ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ് എത്തിയത്, വ്യാഴം, 12 നവംബർ-ന് 2 × veg thali ഇപ്പോൾ ലഭ്യമല്ല. ₹120 നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്. | Your payment of ₹120 arrived after the hold on your order ended, and 2 × veg thali for Thu 12 Nov is no longer available. ₹120 is being refunded to you. |  |
| `cutoff_passed_refund` | A payment arrived after the hold ended and orders have closed: it is refunded | നിങ്ങളുടെ ₹120 പേയ്മെന്റ് ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ് എത്തിയത്, വ്യാഴം, 12 നവംബർ-ലെ ഓർഡറുകൾ അവസാനിച്ചു (ബുധൻ, 11 നവംബർ, രാത്രി 8:00). ₹120 നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്. | Your payment of ₹120 arrived after the hold on your order ended, and orders for Thu 12 Nov have closed (Wed 11 Nov, 8:00 pm). ₹120 is being refunded to you. |  |
| `refund_unused` | A payment arrived for an order that is no longer active: it is refunded | നിങ്ങളുടെ ₹120 പേയ്മെന്റ് ലഭിച്ചു, പക്ഷേ അതിന് ഇപ്പോൾ ഒരു ഓർഡറും ഇല്ല. ₹120 നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്. | Your payment of ₹120 arrived, but there is no active order for it. ₹120 is being refunded to you. |  |
| `duplicate_refund` | The advance was paid twice: the extra is refunded | നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ₹120 തിരികെ നൽകുന്നുണ്ട്. | You paid the advance twice. The extra ₹120 is being refunded. |  |
| `duplicate_refund_pending` | The advance was paid twice and the extra is above the refund limit: waiting for the owner | നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ₹120 ഉടമ അംഗീകരിച്ച ശേഷം തിരികെ നൽകും. | You paid the advance twice. The extra ₹120 will be refunded once the owner approves. |  |
| `cancelled_refund` | A cancellation inside the window: the advance is refunded | വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. നിങ്ങളുടെ ₹120 അഡ്വാൻസ് തിരികെ നൽകുന്നുണ്ട്. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. Your ₹120 advance is being refunded. |  |
| `cancelled_refund_pending` | A cancellation inside the window with a refund above the limit: waiting for the owner | വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. നിങ്ങളുടെ ₹120 തിരികെ നൽകുന്ന കാര്യം ഉടമ ഉടൻ ഉറപ്പാക്കും. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will confirm your ₹120 refund shortly. |  |
| `cancelled_late` | A cancellation outside the window: the owner decides about the advance | വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. തുടങ്ങാൻ 6 മണിക്കൂറിൽ താഴെ മാത്രം ബാക്കിയുള്ളതിനാൽ, നിങ്ങളുടെ ₹120 അഡ്വാൻസിന്റെ കാര്യത്തിൽ ഉടമ തീരുമാനിച്ച് നിങ്ങളെ അറിയിക്കും. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. As it is less than 6 hours before the start, the owner will decide about your ₹120 advance and message you. |  |
| `cancelled_no_advance` | An order cancelled before anything was paid | വ്യാഴം, 12 നവംബർ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. പണം ഒന്നും ഈടാക്കിയിട്ടില്ല. | Your order for Thu 12 Nov is cancelled. Nothing was charged. |  |
| `cancelled_draft` | An order dropped before it had a day | ശരി, ആ ഓർഡർ ഒഴിവാക്കി. പണം ഒന്നും ഈടാക്കിയിട്ടില്ല. | Okay, I have dropped that order. Nothing was charged. |  |
| `no_order_found` | The customer asked to change or cancel and has no order | മാറ്റാൻ ഓർഡർ ഒന്നും കണ്ടില്ല. എന്താണ് വേണ്ടത്, എത്ര, ഏത് ദിവസം എന്ന് പറയൂ, ഞാൻ ഓർഡർ ചെയ്യാം. | I couldn't find an order to change. Tell me what you'd like, how many and which day, and I'll set it up. |  |
| `refund_approved` | The owner approved the refund | ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ₹120 തിരികെ വരുന്നുണ്ട്. | The owner approved your refund. ₹120 is on its way. |  |
| `refund_denied` | The owner said no to the refund | ₹120 അഡ്വാൻസ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു. | The owner has decided not to refund the ₹120 advance. |  |
| `refund_checking` | A refund could not be sent yet: it is being checked | നിങ്ങളുടെ ₹120 റീഫണ്ട് പരിശോധിക്കുകയാണ്. ഉറപ്പാകുന്ന ഉടൻ ഞാൻ സന്ദേശം അയയ്ക്കാം. | We are checking your ₹120 refund and will message you as soon as it is confirmed. |  |
| `refund_expired` | The owner did not answer a refund request in time: nothing was sent | ഉടമ സമയത്തിനുള്ളിൽ നിങ്ങളുടെ ₹120 റീഫണ്ടിനെക്കുറിച്ച് മറുപടി നൽകിയില്ല, അതിനാൽ അത് ഇതുവരെ അയച്ചിട്ടില്ല. ദയവായി Annapurna Tiffins-നെ നേരിട്ട് ബന്ധപ്പെടൂ. | The owner did not answer in time about your ₹120 refund, so it has not been sent. Please contact Annapurna Tiffins directly. |  |
| `big_order_asked` | A big order (above the owner's line) waits for the owner | നിങ്ങളുടെ ഓർഡർ (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) വലുതാണ്, അതിനാൽ ഉടമയോട് അനുമതി ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ കിട്ടും. | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is a big one, so I have asked the owner to approve it. You will hear back here. |  |
| `big_order_denied` | The owner said no to a big order | ക്ഷമിക്കണം, വ്യാഴം, 12 നവംബർ-ലെ നിങ്ങളുടെ ഓർഡർ ഉടമയ്ക്ക് എടുക്കാൻ കഴിയില്ല. പണം ഒന്നും ഈടാക്കിയിട്ടില്ല. | Sorry, the owner cannot take your order for Thu 12 Nov. Nothing was charged. |  |
| `didnt_understand` | The message was not understood | ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി എന്താണ് ഓർഡർ ചെയ്യേണ്ടത്, എത്ര, ഏത് ദിവസം എന്ന് പറയൂ. | Sorry, I didn't understand. Please tell me what you would like to order, how many, and which day. |  |
| `voice_note` | A voice note: it cannot be listened to yet, so they are asked to type | ദയവായി നിങ്ങളുടെ സന്ദേശം ടൈപ്പ് ചെയ്ത് അയയ്ക്കൂ; എനിക്ക് ഇപ്പോൾ വോയ്‌സ് നോട്ടുകൾ കേൾക്കാൻ കഴിയില്ല. | Please type your message; I can't listen to voice notes yet. |  |
| `ask_cancel` | The customer tapped Cancel order: are you sure (Yes / No buttons) | വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കണോ? | Do you want to cancel your order for Thu 12 Nov, 12:00 pm to 1:00 pm? |  |
| `kept` | The customer said no to cancelling: the order stays | ശരി, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ അതുപോലെ തന്നെ തുടരും. | Okay, your order for Thu 12 Nov, 12:00 pm to 1:00 pm stays as it is. |  |
| `told_owner` | The customer tapped Talk to the owner: the owner has been asked to message them | നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ നിങ്ങൾക്ക് സന്ദേശം അയയ്ക്കും. | I've told the owner that you would like to talk. They will message you here. |  |
| `couldnt_tell_owner` | The owner could not be told just now | ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ അറിയിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ. | Sorry, I couldn't reach the owner just now. Please try again in a few minutes. |  |
| `upi_order_confirmed` | UPI shop: the owner marked the advance received: the order is confirmed | ഓർഡർ ഉറപ്പായി! 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്. നിങ്ങളുടെ ₹120 അഡ്വാൻസ് ഉടമ ഉറപ്പിച്ചു. ₹120 പിക്കപ്പിന് അടയ്ക്കണം. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് 6 മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം. | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. The owner has confirmed your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `upi_qr_caption` | UPI shop: the words under the QR picture | ഓർഡർ o-3-നായി Annapurna Tiffins-ന് UPI വഴി ₹120 അയക്കാൻ സ്കാൻ ചെയ്യൂ. | Scan to pay ₹120 by UPI to Annapurna Tiffins for order o-3. |  |
| `upi_paid_claim` | UPI shop: the customer says they paid or sends a screenshot (nothing is marked paid) | നന്ദി. ഉടമ അവരുടെ UPI ആപ്പിൽ നിങ്ങളുടെ ₹120 നോക്കി ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും. സ്ക്രീൻഷോട്ട് പണമടച്ചതിന്റെ തെളിവല്ല, അതിനാൽ ആ സന്ദേശത്തിനായി കാത്തിരിക്കൂ. | Thank you. The owner will look for your ₹120 payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message. |  |
| `upi_nothing_waiting` | UPI shop: the customer says they paid and no advance is waiting | നന്ദി. ഇപ്പോൾ നിങ്ങളുടെ ഒരു UPI പണമടവും ബാക്കിയില്ല, അതിനാൽ ഉടമയ്ക്ക് ഉറപ്പിക്കാൻ ഒന്നുമില്ല. മറ്റെന്തിനെങ്കിലും പണം അയച്ചിട്ടുണ്ടെങ്കിൽ ദയവായി ഉടമയോട് സംസാരിക്കൂ. | Thank you. No UPI payment is waiting for you just now, so there is nothing for the owner to confirm. If you paid for something else, please talk to the owner. |  |
| `upi_late_received` | UPI shop: the owner marked the advance after the hold ended: the order is not confirmed | നിങ്ങളുടെ ₹120 ഉടമ ഉറപ്പിച്ചത് വ്യാഴം, 12 നവംബർ-ലെ ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ്, അതിനാൽ ഓർഡർ ഉറപ്പായിട്ടില്ല. വീണ്ടും ഓർഡർ ചെയ്യുന്നതിനെക്കുറിച്ചോ പണം തിരികെ അയക്കുന്നതിനെക്കുറിച്ചോ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും. | The owner confirmed your ₹120 payment after the hold on your order for Thu 12 Nov had ended, so the order is not confirmed. The owner will contact you about ordering again or sending the money back. |  |
| `upi_refund_owed` | UPI shop: a refund the owner will send (the agent never sends it) | ഉടമ ₹120 UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും. | The owner will send ₹120 back to you by UPI. I'll message you when they mark it sent. |  |
| `upi_cancelled_refund_owed` | UPI shop: a cancellation inside the window: the owner will send the refund | വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. ഉടമ നിങ്ങളുടെ ₹120 UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും. | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will send your ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_extra_refund_owed` | UPI shop: the owner marked more than the advance: the owner will send the extra back | നിങ്ങൾ അഡ്വാൻസിനേക്കാൾ കൂടുതൽ അയച്ചു. അധികമായ ₹120 ഉടമ UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും. | You paid more than the advance. The owner will send the extra ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_refund_sent` | UPI shop: the owner marked the refund sent (only then is the customer told) | ഓർഡർ o-3-ന്റെ നിങ്ങളുടെ ₹120 റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ. | The owner has marked your ₹120 refund for order o-3 as sent by UPI. Please check your UPI app. |  |
| `orders_paused` | The shop's licence is in its wind-down: the answer to a customer who asks to order. No order, no link, nothing kept for later | ഓൺലൈൻ ഓർഡർ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി Annapurna Tiffins-നെ നേരിട്ട് ബന്ധപ്പെടൂ. | Online ordering is paused for now. Please contact Annapurna Tiffins directly. |  |
| `wait_over` | The shop's system did not answer for 15 minutes from the message (a Guard was down) and the request was not finished: the customer is told so, that the message is on the owner's to-do list, and to write again later or contact the shop. Nothing else is promised | ക്ഷമിക്കണം, നിങ്ങളുടെ അഭ്യർത്ഥന പൂർത്തിയാക്കാൻ കഴിഞ്ഞില്ല: ഓർഡർ സംവിധാനം ഇപ്പോൾ പ്രതികരിക്കുന്നില്ല. നിങ്ങളുടെ സന്ദേശം ഉടമയുടെ ചെയ്യാനുള്ള കാര്യങ്ങളുടെ പട്ടികയിലുണ്ട്. ദയവായി പിന്നീട് വീണ്ടും എഴുതൂ, അല്ലെങ്കിൽ Annapurna Tiffins-നെ നേരിട്ട് ബന്ധപ്പെടൂ. | Sorry, I could not finish your request: the ordering system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact Annapurna Tiffins directly. |  |

## 2. Messages to the owner (37)

Most owner messages are also WhatsApp templates, because they are sent by the agent on its own and WhatsApp then carries only an approved template. Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Malayalam) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `owner_order_confirmed` | A pickup order was confirmed: what to prepare, for when, the total, the advance and what to collect | പുതിയ ഓർഡർ o-3, ഉപഭോക്താവ് +919811111111: 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്. ആകെ ₹240, അഡ്വാൻസ് ₹120 ലഭിച്ചു, ₹120 വാങ്ങാനുണ്ട്. ഇപ്പോൾ ഒന്നും ചെയ്യാനില്ല. | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_delivery_confirmed` | A delivery order was confirmed: the same, with the address the customer wrote | പുതിയ ഓർഡർ o-3, ഉപഭോക്താവ് +919811111111: 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്, വിലാസം: Flat 4, Lake View Apartments, Kakkanad. ആകെ ₹240, അഡ്വാൻസ് ₹120 ലഭിച്ചു, ₹120 വാങ്ങാനുണ്ട്. ഇപ്പോൾ ഒന്നും ചെയ്യാനില്ല. | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup, address: Flat 4, Lake View Apartments, Kakkanad. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_big_order` | An order above the owner's line: approve or deny, with the order's reference | അനുമതി വേണം: +919811111111-ന് 2 × veg thali വേണം, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ, പിക്കപ്പ്. ആകെ ₹240. പണമടയ്ക്കാൻ അനുവദിക്കാൻ "approve o-3" എന്നും, നിരസിക്കാൻ "deny o-3" എന്നും മറുപടി അയയ്ക്കൂ. | Approval needed: +919811111111 wants 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. Reply "approve o-3" to let them pay, or "deny o-3". |  |
| `owner_order_cancelled` | A confirmed order was cancelled: do not prepare it | ഉപഭോക്താവ് +919811111111 ഓർഡർ o-3 റദ്ദാക്കി: 2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ. ദയവായി ഇത് തയ്യാറാക്കരുത്. | Customer +919811111111 cancelled order o-3: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm. Please do not prepare it. |  |
| `owner_late_cancellation` | A cancellation outside the window: approve (refund) or deny (keep), with the order's reference | ഉപഭോക്താവ് +919811111111: ഓർഡർ o-3 (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) തുടങ്ങാൻ 6 മണിക്കൂറിൽ താഴെ ബാക്കിയുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് ₹120. തിരികെ നൽകാൻ "approve o-3" എന്നും, നിങ്ങൾ വയ്ക്കാൻ "deny o-3" എന്നും മറുപടി അയയ്ക്കൂ. | Customer +919811111111 cancelled order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) less than 6 hours before the start. Advance ₹120. Reply "approve o-3" to refund it or "deny o-3" to keep it. |  |
| `owner_duplicate_payment` | The advance was paid twice: the extra was refunded | ഉപഭോക്താവ് +919811111111: ഓർഡർ o-3 (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) — അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി വന്ന ₹120 തിരികെ നൽകി. | Customer +919811111111 paid the advance twice for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). The extra ₹120 was refunded. |  |
| `owner_payment_unused` | A payment arrived for an order that could not be taken: it was refunded | ഉപഭോക്താവ് +919811111111: ഓർഡർ o-3 (വ്യാഴം, 12 നവംബർ) ന് ₹120 പേയ്മെന്റ് വന്നു, പക്ഷേ ആ ഓർഡർ അപ്പോൾ നിലവിലില്ലായിരുന്നു (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, വീണ്ടും എടുക്കാനും കഴിഞ്ഞില്ല, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). ₹120 തിരികെ നൽകി. | A ₹120 payment from +919811111111 arrived for order o-3 (Thu 12 Nov), but it was no longer active (its hold had ended and it could not be taken again, or it was cancelled). ₹120 was refunded. |  |
| `owner_link_failed` | The payment link for an order could not be made | ഉപഭോക്താവ് +919811111111-ന്റെ ഓർഡർ o-3-ന് പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും ഓർഡർ ആയിട്ടില്ല. ദയവായി നിങ്ങളുടെ പേയ്മെന്റ് അക്കൗണ്ട് പരിശോധിക്കൂ. | Could not make the payment link for order o-3 from +919811111111. Nothing is ordered. Please check your payment account. |  |
| `owner_message_held` | A message was held back because it did not match the order record | ഉപഭോക്താവ് +919811111111: അയയ്ക്കാനിരുന്ന ഒരു സന്ദേശം ഓർഡർ രേഖയുമായി പൊരുത്തപ്പെടാത്തതിനാൽ തടഞ്ഞു. ഒന്നും അയച്ചിട്ടില്ല. | A message to +919811111111 was held back because it did not match the order record. Nothing was sent. |  |
| `owner_opted_out` | A customer sent STOP | ഉപഭോക്താവ് +919811111111 STOP അയച്ചു. ഇനി അവർക്ക് സന്ദേശങ്ങൾ അയയ്ക്കില്ല. | Customer +919811111111 sent STOP. No more messages will go to them. |  |
| `owner_unknown_command` | The owner's reply was not approve or deny | എനിക്ക് മനസ്സിലായില്ല. "approve" അല്ലെങ്കിൽ "deny" എന്ന് എഴുതി അതിനു ശേഷം ഓർഡർ റഫറൻസ് എഴുതൂ. | I didn't understand that. Reply "approve" or "deny" followed by the order reference. |  |
| `owner_wants_to_talk` | A customer tapped Talk to the owner (at most once an hour for the same customer) | ഉപഭോക്താവ് +919811111111 നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ. | Customer +919811111111 would like to talk to you. Please message them. |  |
| `owner_ai_allowance` | Button mode, told once a month: the shop's monthly AI allowance is used up | അറിയിപ്പ്: Annapurna Tiffins-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതിനാൽ ഏജന്റ് ഇനി ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് മറുപടി നൽകും. ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് ക്രമീകരിച്ചവരെ അറിയിച്ചിട്ടുണ്ട്. അടുത്ത മാസം സാധാരണ സേവനം തിരിച്ചുവരും. | Notice: this month's AI allowance for Annapurna Tiffins is used up, so the agent now answers with buttons and lists. It still takes orders, and every limit still holds. The person who set it up has been told. Normal service returns next month. |  |
| `owner_ai_off` | Button mode, told once: the AI was switched off from outside | അറിയിപ്പ്: Annapurna Tiffins-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ചെയ്തിരിക്കുന്നു. ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് ക്രമീകരിച്ചവരെ അറിയിച്ചിട്ടുണ്ട്. | Notice: the AI that reads messages for Annapurna Tiffins has been switched off for now. The agent keeps taking orders with buttons and lists, and every limit still holds. The person who set it up has been told. |  |
| `owner_ai_fault` | Button mode, told at most once a day: a model did not answer, so buttons are used for a few minutes | അറിയിപ്പ്: Annapurna Tiffins-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി നൽകുന്നില്ല, അതിനാൽ ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിക്കുന്നു. ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. കുറച്ച് മിനിറ്റിനു ശേഷം ഏജന്റ് വീണ്ടും AI ശ്രമിക്കും. | Notice: the AI that reads messages for Annapurna Tiffins is not answering right now, so the agent is using buttons and lists. It still takes orders, and every limit still holds. It will try the AI again in a few minutes. |  |
| `owner_refund_needs_approval` | A refund above the limit waits for the owner's one-use code (sent by the approvals relay, never by the agent) | അനുമതി വേണം: +919811111111-ന് (ഓർഡർ o-3, വ്യാഴം, 12 നവംബർ) ₹120 റീഫണ്ട്. 24 മണിക്കൂറിനുള്ളിൽ "approve K7M2QX" അല്ലെങ്കിൽ "deny K7M2QX" എന്ന് മറുപടി അയയ്ക്കൂ. | Approval needed: refund ₹120 for +919811111111 (order o-3, Thu 12 Nov). Reply "approve K7M2QX" or "deny K7M2QX" within 24 hours. |  |
| `owner_approval_done` | The owner approved with the code: the refund is being sent | നന്ദി. ഉപഭോക്താവ് +919811111111: ₹120 റീഫണ്ട് അയയ്ക്കുന്നുണ്ട്, അവരെ അറിയിക്കും. | Thank you. The ₹120 refund for +919811111111 is being sent, and they will be told. |  |
| `owner_approval_denied` | The owner denied with the code: nothing is sent | മനസ്സിലായി. ഉപഭോക്താവ് +919811111111: ₹120 റീഫണ്ട് അയയ്ക്കില്ല, അവരെ അറിയിക്കും. | Understood. The ₹120 refund for +919811111111 will not be sent, and they will be told. |  |
| `owner_approval_expired` | The owner answered after the request had run out: nothing was refunded | നിങ്ങൾ മറുപടി നൽകുന്നതിന് മുമ്പ് ആ അഭ്യർത്ഥനയുടെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും തിരികെ നൽകിയില്ല: ഉപഭോക്താവ് +919811111111, ₹120. | That request ran out before you answered, so nothing was refunded: ₹120 for +919811111111. |  |
| `owner_approval_failed` | The owner's answer could not be recorded just now: send it again | നിങ്ങളുടെ മറുപടി ഇപ്പോൾ രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും അയയ്ക്കൂ. | I could not record your answer just now. Please send it again in a few minutes. |  |
| `owner_approval_waiting` | A refund needs several people: this person's approval is in and more are needed | നന്ദി. +919811111111-ന്റെ ₹120 റീഫണ്ടിനുള്ള നിങ്ങളുടെ അനുമതി രേഖപ്പെടുത്തി. ഇനി മറ്റുള്ളവരിൽ നിന്ന് വേണ്ട അനുമതികൾ: 1. അവ ലഭിച്ച ശേഷമേ ഇത് അയയ്ക്കൂ. | Thank you. Your approval of the ₹120 refund for +919811111111 is recorded. Approvals still needed from the others: 1. It is sent only once they are given. |  |
| `owner_approval_closed` | A refund needs several people: the others approved it, so this person's answer is no longer needed | അറിയിപ്പ്: +919811111111-ന്റെ ₹120 റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി, അതിനാൽ ഇനി നിങ്ങളുടെ മറുപടി ആവശ്യമില്ല. നന്ദി. | The ₹120 refund for +919811111111 has been approved by the others, so your answer is no longer needed. Thank you. |  |
| `owner_approval_refused` | A refund needs several people: one of them refused it, so it is not sent | അറിയിപ്പ്: +919811111111-ന്റെ ₹120 റീഫണ്ട് അനുമതി നൽകുന്നവരിൽ ഒരാൾ നിരസിച്ചു, അതിനാൽ ഇത് അയയ്ക്കില്ല, അവരെ അറിയിക്കും. | The ₹120 refund for +919811111111 was refused by one of the people who approve refunds, so it will not be sent, and they will be told. |  |
| `owner_refund_settled` | A person at the server checked an uncertain refund and marked it as made: it is done and not sent again | റീഫണ്ട് പൂർത്തിയായി: +919811111111-ന്റെ ₹120. നിങ്ങളുടെ ഏജന്റ് സജ്ജമാക്കിയ ആൾ ഇത് പരിശോധിച്ച് നടന്നതായി രേഖപ്പെടുത്തി, അതിനാൽ ഇത് വീണ്ടും അയയ്ക്കില്ല. | Refund done: ₹120 for +919811111111. The person who set up your agent checked it and marked it as made, so it is not sent a second time. |  |
| `owner_upi_expected` | UPI shop: tells the owner what payment to look for in their UPI app, with the one-use code | പരിശോധിക്കാനുള്ള UPI പണമടവ്: ഉപഭോക്താവ് +919811111111, ഓർഡർ o-3 (2 × veg thali, വ്യാഴം, 12 നവംബർ, ഉച്ചയ്ക്ക് 12:00 മുതൽ ഉച്ചയ്ക്ക് 1:00 വരെ) എന്നതിനായി ₹120 അഡ്വാൻസ് അയക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received P4XR9T" എന്ന് മറുപടി അയക്കുക. മറ്റൊരു തുക ആണ് വന്നതെങ്കിൽ "received P4XR9T" എന്നതിന് ശേഷം തുക എഴുതുക. | UPI payment to check: customer +919811111111 will pay the ₹120 advance for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). When it shows in your UPI app, tap Received or reply "received P4XR9T". If a different amount came, reply "received P4XR9T" and the amount. |  |
| `owner_upi_claim` | UPI shop: the customer says they paid (a screenshot is not proof): the owner is asked to look | ഉപഭോക്താവ് +919811111111 ഓർഡർ o-3-ന്റെ ₹120 അഡ്വാൻസ് അയച്ചെന്ന് പറയുന്നു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കുക. പണം ഉണ്ടെങ്കിൽ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received P4XR9T" എന്ന് മറുപടി അയക്കുക. | Customer +919811111111 says they have paid the ₹120 advance for order o-3. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received P4XR9T". |  |
| `owner_upi_marked` | UPI shop: the answer to the owner's Received, the order confirmed | നന്ദി. ഓർഡർ o-3-ന്റെ ₹120 നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തി. | Thank you. ₹120 for order o-3 is marked paid by you. |  |
| `owner_upi_part` | UPI shop: the answer to the owner's Received, part paid, with the code for the rest | ഓർഡർ o-3-ന് നിങ്ങൾ ₹120 രേഖപ്പെടുത്തി, പക്ഷേ അഡ്വാൻസ് ₹120 ആണ്, അതിനാൽ ഇതുവരെ ഉറപ്പായിട്ടില്ല. മാറ്റിവച്ച സമയം തീരും വരെ ഓർഡർ പിടിച്ചുവെക്കും. ബാക്കി ₹100 എത്തുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received P4XR9T" എന്ന് മറുപടി അയക്കുക. | You marked ₹120 for order o-3, but the advance is ₹120, so it is not confirmed yet. The order stays held until the hold ends. When the other ₹100 arrives, tap Received or reply "received P4XR9T". |  |
| `owner_upi_already` | UPI shop: the owner used a code that was already used: counted once | ആ പണമടവ് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്. അത് ഒരു തവണ മാത്രം കണക്കാക്കും. | That payment is already marked. It is counted once. |  |
| `owner_upi_unknown` | UPI shop: the owner used a code the agent never gave | ആ കോഡ് എനിക്ക് അറിയില്ല. ആ പണമടവിനെക്കുറിച്ചുള്ള എന്റെ ഏറ്റവും പുതിയ സന്ദേശത്തിലെ കോഡ് ഉപയോഗിക്കുക. | I don't know that code. Please use the code in my latest message about the payment. |  |
| `owner_upi_late` | UPI shop: the owner marked the advance after the hold ended: take the order by hand or send the money back | ഓർഡർ o-3-ന്റെ മാറ്റിവച്ച സമയം അവസാനിച്ച ശേഷമാണ് നിങ്ങൾ ₹120 കിട്ടിയതായി രേഖപ്പെടുത്തിയത്, അതിനാൽ അത് സ്വയം വീണ്ടും ഉറപ്പായില്ല. ഉപഭോക്താവ് +919811111111-ന്റെ ഓർഡർ നിങ്ങൾ തന്നെ വീണ്ടും എടുക്കുക, അല്ലെങ്കിൽ ₹120 UPI വഴി തിരികെ അയക്കുക. പിന്നെ "റീഫണ്ട് അയച്ചു" അല്ലെങ്കിൽ "ഓർഡറിനായി വെച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded P4XR9T" അല്ലെങ്കിൽ "kept P4XR9T" എന്ന് മറുപടി അയക്കുക. | You marked ₹120 received for order o-3 after its hold had ended, so it was not confirmed again by itself. Take customer +919811111111's order again yourself, or send the ₹120 back by UPI. Then tap Refund sent or Kept for order, or reply "refunded P4XR9T" or "kept P4XR9T". |  |
| `owner_upi_refund_owed` | UPI shop: a refund the owner must send from their UPI app, with the code | തിരികെ അയക്കേണ്ടത്: ഉപഭോക്താവ് +919811111111-ന് (ഓർഡർ o-3) UPI വഴി ₹120. ഏജന്റ് ഒരിക്കലും പണം അയക്കില്ല. അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded P4XR9T" എന്ന് മറുപടി അയക്കുക. | Refund to send: customer +919811111111 (order o-3) is owed ₹120 by UPI. The agent never sends money. After you send it, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_reminder` | UPI shop: a reminder of a refund still owed (once a day, three times at most) | ഓർമ്മപ്പെടുത്തൽ: ഉപഭോക്താവ് +919811111111-ന് (ഓർഡർ o-3) ₹120 ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded P4XR9T" എന്ന് മറുപടി അയക്കുക. | Reminder: customer +919811111111 (order o-3) is still owed ₹120. After you send it by UPI, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_marked` | UPI shop: the answer to the owner's Refund sent | നന്ദി. ഓർഡർ o-3-ന്റെ ₹120 റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, ഉപഭോക്താവിനെ അറിയിച്ചു. | Thank you. The ₹120 refund for order o-3 is marked sent, and the customer has been told. |  |
| `owner_upi_refund_kept` | UPI shop: the owner kept the money for an order they take by hand | ശരി. ഓർഡർ o-3-ന്റെ ₹120 നിങ്ങൾ തന്നെ എടുക്കുന്ന ഓർഡറിനായി വെച്ചു. ഇനി ഒന്നും തിരികെ നൽകാനില്ല. | Okay. The ₹120 for order o-3 is kept for an order you take by hand. Nothing more is owed back. |  |
| `owner_licence_paused` | The one notice to the owner when the licence winds down: online ordering is paused, who to contact. Never about money | അറിയിപ്പ്: Annapurna Tiffins-ന്റെ ഓൺലൈൻ ഓർഡർ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. നിലവിലുള്ള ഓർഡറുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും തുടർന്നും നടക്കും. ഇതിനെക്കുറിച്ച് ദയവായി Divya, Sri Sai Digital-നെ ബന്ധപ്പെടൂ. | Notice: online ordering for Annapurna Tiffins is paused for now. Existing orders, cancellations and refunds still go through. Please contact Divya, Sri Sai Digital. |  |
| `owner_licence_stopped` | The one notice to the owner at the licence's final stop: the partner's service has ended, what is still open, and that hello@geometer.dev will connect the owner with another local partner | അറിയിപ്പ്: Annapurna Tiffins-ന്റെ ഓൺലൈൻ ഓർഡർ നിർത്തി, കാരണം Divya, Sri Sai Digital നൽകിയിരുന്ന സേവനം അവസാനിച്ചു. വരാനുള്ള ഓർഡറുകൾ: 4. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി ഇത് തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും. | Notice: online ordering for Annapurna Tiffins has stopped, because the service from Divya, Sri Sai Digital has ended. Orders still to come: 4. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you. |  |

### The words on the buttons and the lists

Some of the messages above come with buttons (up to 3, each 20 letters at most) or a list that the customer taps instead of typing. A label never carries an amount or a date.

| Id | Text (Malayalam) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `yes` | ശരി | Yes |  |
| `no` | അല്ല | No |  |
| `owner` | ഉടമയോട് സംസാരിക്കണം | Talk to the owner |  |
| `cancel` | ഓർഡർ റദ്ദാക്കൂ | Cancel order |  |
| `cancelYes` | അതെ, റദ്ദാക്കൂ | Yes, cancel |  |
| `keep` | നിലനിർത്തൂ | No, keep it |  |
| `pickItem` | സാധനം തിരഞ്ഞെടുക്കൂ | Pick an item |  |
| `pickTime` | സമയം തിരഞ്ഞെടുക്കൂ | Pick a time |  |
| `pickup` | പിക്കപ്പ് | Pickup |  |
| `delivery` | ഡെലിവറി | Delivery |  |
| `paid` | ഞാൻ പണമടച്ചു | I have paid |  |
| `received` | കിട്ടി | Received |  |
| `refundSent` | റീഫണ്ട് അയച്ചു | Refund sent |  |
| `keptForBooking` | ഓർഡറിനായി വെച്ചു | Kept for order |  |

## 3. Dates as the agent writes them

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

Dates are written weekday, day, month ("വ്യാഴം, 12 നവംബർ"); a time window is written "from … to …" with the part of the day before each time.

## 4. Item names in the example shop (Annapurna Tiffins)

| Item | Names in Malayalam (the first is what the agent says; the rest are what customers may call it) | Native reviewer: OK / change to … |
| --- | --- | --- |
| veg thali | (the example shop writes English and Hindi: this item has no name in this language) |  |
| chicken meal | (the example shop writes English and Hindi: this item has no name in this language) |  |
| curd | (the example shop writes English and Hindi: this item has no name in this language) |  |

## 5. What the agent understands from a customer

Words in Latin letters are how people type the language on WhatsApp. They are listed in one row, with the English ones, because the lists are shared by the languages.

| Meaning | English | Words and phrases (Malayalam letters first, then the Latin letters people type it in) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| an order (words that mean the customer wants something) | order, want, need | ബുക്ക് · ബുക്കിംഗ് · ബുക്കിങ് · അപ്പോയിന്റ്മെന്റ് · വേണം — Latin letters: order · orders · want · need · get me · send · book · tiffin · i'd like · i would like · chahiye · chahie · bhej do · mangwana · venam · beku · bekittu |  |
| pickup | pickup, collect, take away | പിക്കപ്പ് · പിക്ക് അപ്പ് · വന്ന് എടുക്ക — Latin letters: pickup · pick up · pick-up · collect · takeaway · take away · take-away · come and take · aake le · lene aunga · lene aaunga |  |
| delivery | delivery, deliver | ഡെലിവറി · വീട്ടിൽ എത്തിക്ക · എത്തിച്ച — Latin letters: deliver · delivery · home delivery · send it to · bhej do · bhejna · pahuncha |  |
| I have paid (a claim; checked against the payment record, never believed on its own) | paid, I have paid | അടച്ചു · പണം അടച്ചു · പണം അയച്ചു · അയച്ചു — Latin letters: paid · i paid · i have paid · have paid · payment done · payment made · sent the money · money sent · transferred · paid it · advance paid · bhar diya · pay kar diya · payment kar diya · paid kar diya · de diya · paise bhej diye · adachu · payment cheythu · paid aanu · paavatisiddene · payment madide |  |
| money back | refund, money back | റീഫണ്ട് · തിരികെ — Latin letters: refund · refunded · money back · give back · return my money · get back my money · paise wapas · wapas |  |
| talk to the owner | owner, talk to | ഉടമ · സംസാരിക്കണം · വിളിക്കൂ — Latin letters: owner · talk to · call me · speak to · manager · malik |  |
| a quantity in words (one to ten in English and Hindi, one to five in Malayalam and Kannada) | one, two, three | ഒന്ന് · രണ്ട് · മൂന്ന് · നാല് · അഞ്ച് — Latin letters: one · two · three · four · five · six · seven · eight · nine · ten · ek · teen · char · chaar · paanch · panch · chhe · chhah · saat · aath · nau · das · onnu · randu · moonnu · munnu · naalu · anchu · ondu · eradu · mooru · naalku · aidu |  |
| yes (exact) | yes | ശരി · ശെരി · ശരിയാണ് · അതെ · ആണ് · ഓക്കെ · ഓകെ · ഓക്കേ · സമ്മതം · ഉവ്വ് · sheri · seri · athe · aanu |  |
| no (exact) | no | വേണ്ട · വേണ്ടാ · അല്ല · ഇല്ല · venda · alla · illa |  |
| hello (exact) | hello | നമസ്കാരം · ഹലോ · ഹായ് · namaskaram |  |
| cancel | cancel | റദ്ദ് · റദ്ദാക്കണം · റദ്ദാക്കൂ · റദ്ദാക്കി · ക്യാൻസൽ · കാൻസൽ · radd · kyansal |  |
| STOP, on its own or in a few words (exact) | stop | സ്റ്റോപ്പ് · നിർത്തൂ · നിർത്തുക |  |
| STOP, as a phrase (the start; the last word may continue) | stop the messages | മെസ്സേജ് നിർത്ത · മെസേജ് നിർത്ത · സന്ദേശം നിർത്ത · മെസ്സേജ് അയക്കരുത് · മെസ്സേജ് അയയ്ക്കരുത് · മെസ്സേജ് വേണ്ട · സന്ദേശം വേണ്ട · message venda · msg venda |  |
| rupee, after an amount: "200 …" | rupees | രൂപ · രൂ · rupa · rupaya · rupayakku · roopa · roopakku |  |
| "rules", near a word for "forget" (a trick) | rules, instructions | നിയമ · നിർദ്ദേശ · ചട്ട |  |
| "forget", near a word for "rules" (a trick) | forget, ignore, break | മറ · അവഗണി · ലംഘി · ഒഴിവാക്ക |  |
| Latin-letter words that show the customer writes Malayalam | (language hints) | innu · mani · manikku · venam · venda · aanu · ente · njan · enikku · ningal · ningalude · cheyyamo · cheyyan · sheri · athe · pattumo · pattum · mattannal · chovvazhcha · adutha · vaikunneram · raavile · uchakku · rathri |  |

The shop's own item names and its slot names ("lunch", "dinner") are the shop's settings, written by the person who sets the shop up: they are not in this list.

### Whole sentences, and what the agent reads from them

| Customer writes | Meaning | The agent reads | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| നാളെ 2 veg thali പിക്കപ്പ് | 2 veg thali tomorrow, pickup | order, items 2×veg-thali, pickup |  |
| ഞാൻ പണം അടച്ചു | I paid | paid |  |
| ഓർഡർ റദ്ദാക്കൂ | Cancel my order | cancel |  |
| എനിക്ക് ഉടമയോട് സംസാരിക്കണം | I want to talk to the owner | owner |  |
| റീഫണ്ട് വേണം | I want a refund | refund |  |
| മെസ്സേജ് നിർത്തൂ | Stop the messages | stop |  |

## 6. The monthly report

The owner's monthly text is five short lines of "label: number". Every number, amount and date is counted from the record and written by the same formatters as the messages; only the words around them are below.

### The five lines, with sample numbers

```text
Annapurna Tiffins · ഫെബ്രുവരി 2027 · പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം
ഉടമ കിട്ടിയതായി രേഖപ്പെടുത്തിയ അഡ്വാൻസ്: ₹24,000 · പിക്കപ്പിൽ വാങ്ങാനുള്ളത്: ₹9,000 (ഓർഡറുകൾ: 6) · ഉടമ അയച്ചതായി രേഖപ്പെടുത്തിയ റീഫണ്ട്: ₹600
എടുത്ത ഓർഡറുകൾ: 41 · റദ്ദാക്കിയത്: 3 · നിങ്ങളോട് ചോദിച്ചു: 3 · നിങ്ങൾ അംഗീകരിച്ചു: 2 · നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു: 1
നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്: 7 (ദിവസത്തെ സ്റ്റോക്കിന് മുകളിലുള്ള ഓർഡറുകൾ: 3 · കട്ട്-ഓഫിന് ശേഷമുള്ള ഓർഡറുകൾ: 2 · ഡെലിവറി ഏരിയയ്ക്ക് പുറത്തുള്ള വിലാസങ്ങൾ: 1 · …)
പരിശോധിക്കാത്തത്: പിക്കപ്പിൽ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക · പണമടവ് സ്വയം പരിശോധിക്കൽ (UPI-യിൽ ഓരോ പണമടവും നിങ്ങൾ രേഖപ്പെടുത്തുന്നു) · യഥാർത്ഥ WhatsApp · വാക്കുകളെക്കുറിച്ച് ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന · കൂടാതെ 16 കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ). പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.
```

### The monthly report on WhatsApp, with sample numbers

```text
പ്രതിമാസ റിപ്പോർട്ട്: Annapurna Tiffins · ഫെബ്രുവരി 2027
പിരിഞ്ഞ അഡ്വാൻസ്: ₹24,000 · തിരികെ നൽകിയത്: ₹600 · പിക്കപ്പിൽ വാങ്ങാനുള്ളത്: ₹9,000 (ഓർഡറുകൾ: 6)
എടുത്ത ഓർഡറുകൾ: 41 · റദ്ദാക്കിയത്: 3
നിങ്ങളോട് ചോദിച്ചു: 3 · നിങ്ങൾ അംഗീകരിച്ചു: 2 · നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു: 1
നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്: 7
പരിശോധിക്കാത്തത്: പിക്കപ്പിൽ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക · പണമടവ് സ്വയം പരിശോധിക്കൽ (UPI-യിൽ ഓരോ പണമടവും നിങ്ങൾ രേഖപ്പെടുത്തുന്നു) · യഥാർത്ഥ WhatsApp · വാക്കുകളെക്കുറിച്ച് ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന · കൂടാതെ 16 കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ). പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.
കോഡ്: 7K2M-9QXD · പൂർണ്ണ റിപ്പോർട്ട്: https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-ml.html
സപ്പോർട്ടിന് എഴുതുക. ഒരു വ്യക്തി മറുപടി നൽകും.
തയ്യാറാക്കിയത്: Divya, Sri Sai Digital · Geometer
★ ഇന്നൊവേറ്റർ
```

### Every word and phrase of the report

| Id | Text (Malayalam) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `agent` | ഓർഡർ ഏജന്റ് | Orders agent |  |
| `monthlyReport` | പ്രതിമാസ റിപ്പോർട്ട് | Monthly report |  |
| `goLiveCertificate` | തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാ സർട്ടിഫിക്കറ്റ് | Go-live certificate |  |
| `fullReport` | പൂർണ്ണ റിപ്പോർട്ട് | Full report |  |
| `helpLine` | സപ്പോർട്ടിന് എഴുതുക. ഒരു വ്യക്തി മറുപടി നൽകും. | Write to support. A person answers. |  |
| `promise` | പേയ്മെന്റ് രേഖയില്ലാതെ (UPI-യിൽ നിങ്ങളുടെ സ്ഥിരീകരണമില്ലാതെ) ഒരു ഓർഡറും ഉറപ്പിക്കില്ല; ഓരോ റീഫണ്ടും രേഖപ്പെടുത്തുന്നു. | No order confirmed without the payment record (or your confirmation for UPI); every refund tracked. |  |
| `label.collected` | പിരിഞ്ഞ അഡ്വാൻസ് | Advance collected |  |
| `label.stillToCollect` | പിക്കപ്പിൽ വാങ്ങാനുള്ളത് | To collect at pickup |  |
| `label.givenBack` | തിരികെ നൽകിയത് | Given back |  |
| `label.ordersTaken` | എടുത്ത ഓർഡറുകൾ | Orders taken |  |
| `label.cancelled` | റദ്ദാക്കിയത് | Cancelled |  |
| `label.wasAsked` | നിങ്ങളോട് ചോദിച്ചു | You were asked |  |
| `label.approved` | നിങ്ങൾ അംഗീകരിച്ചു | You approved |  |
| `label.saidNo` | നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു | You said no |  |
| `label.stoppedByLimits` | നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത് | Stopped by your limits |  |
| `label.notChecked` | പരിശോധിക്കാത്തത് | Not checked |  |
| `label.orders` | ഓർഡറുകൾ | orders |  |
| `stop.price-at-or-above-menu` | മെനുവിലെ വിലയേക്കാൾ കുറഞ്ഞ വില | Prices below your menu |  |
| `stop.order-size` | വളരെയധികം സാധനങ്ങളുള്ള ഓർഡറുകൾ | Orders with too many items |  |
| `stop.within-stock` | ദിവസത്തെ സ്റ്റോക്കിന് മുകളിലുള്ള ഓർഡറുകൾ | Orders past the day's stock |  |
| `stop.within-day-cap` | ദിവസത്തെ പരിധിക്ക് മുകളിലുള്ള ഓർഡറുകൾ | Orders past the day's limit |  |
| `stop.before-cutoff` | കട്ട്-ഓഫിന് ശേഷമുള്ള ഓർഡറുകൾ | Orders after the cut-off |  |
| `stop.within-delivery-area` | ഡെലിവറി ഏരിയയ്ക്ക് പുറത്തുള്ള വിലാസങ്ങൾ | Addresses outside your delivery area |  |
| `stop.confirm-only-when-recorded` | പേയ്മെന്റ് രേഖയില്ലാത്ത "ഉറപ്പിച്ചു" | "Confirmed" with no payment on record |  |
| `stop.one-advance-per-order` | ഒരു ഓർഡറിന്റെ രണ്ടാം അഡ്വാൻസ് | A second advance on one order |  |
| `stop.refund-limit` | പരിധിക്ക് മുകളിലുള്ള റീഫണ്ട് | Refunds above your limit |  |
| `stop.message-matches-record` | രേഖയുമായി ചേരാത്ത സന്ദേശങ്ങൾ | Messages that did not match the record |  |
| `stop.opt-out` | STOP-ന് ശേഷമുള്ള സന്ദേശങ്ങൾ | Messages after STOP |  |
| `handRun` | പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു. | Checks were run by hand. |  |
| `sourceTag.stand-in` | പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം | stand-in services, test money |  |
| `sourceTag.test-mode` | ടെസ്റ്റ് മോഡ്, ടെസ്റ്റ് പണം | test mode, test money |  |
| `more` | കൂടാതെ 12 കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ) | and 12 more (see the full report) |  |
| `notChecked.cash` | പിക്കപ്പിൽ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക | balance paid in cash or UPI at pickup |  |
| `notChecked.upi` | Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ | payments outside Razorpay |  |
| `notChecked.whatsapp` | യഥാർത്ഥ WhatsApp | real WhatsApp |  |
| `notChecked.razorpay` | യഥാർത്ഥ Razorpay | real Razorpay |  |
| `notChecked.review` | വാക്കുകളെക്കുറിച്ച് ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന | a native speaker's review of the wording |  |
| `languageName.hi` | ഹിന്ദി | Hindi |  |
| `languageName.en` | ഇംഗ്ലീഷ് | English |  |
| `languageName.ml` | മലയാളം | Malayalam |  |
| `languageName.kn` | കന്നഡ | Kannada |  |
| `upiLabel.collected` | ഉടമ കിട്ടിയതായി രേഖപ്പെടുത്തിയ അഡ്വാൻസ് | Advance marked paid by owner |  |
| `upiLabel.givenBack` | ഉടമ അയച്ചതായി രേഖപ്പെടുത്തിയ റീഫണ്ട് | Refunds marked sent by owner |  |
| `upiLabel.notChecked` | പണമടവ് സ്വയം പരിശോധിക്കൽ (UPI-യിൽ ഓരോ പണമടവും നിങ്ങൾ രേഖപ്പെടുത്തുന്നു) | automatic payment checking (with UPI you mark each payment) |  |
| `notTested.balance-at-pickup` | വിലയുടെ ബാക്കി, പിക്കപ്പിലോ ഡെലിവറിയിലോ പണമായോ UPI വഴിയോ അടയ്ക്കുന്നത് (അഡ്വാൻസ് മാത്രമേ രേഖപ്പെടുത്തൂ) | The rest of the price, paid in cash or by UPI at pickup or delivery (only the advance is tracked) |  |
| `notTested.kitchen-and-delivery` | ഭക്ഷണം ഉണ്ടാക്കിയോ, എടുത്തോ, എത്തിച്ചോ എന്നത് (സ്ലോട്ട് തീരുമ്പോൾ ഓർഡർ പൂർത്തിയായതായി കണക്കാക്കുന്നു) | Whether the food was made, collected or delivered (an order is completed when its slot ends) |  |
| `notTested.order-changes` | ഉറപ്പിച്ച ഓർഡറിൽ മാറ്റം വരുത്തുന്നത് (ഉപഭോക്താവ് റദ്ദാക്കി വീണ്ടും ഓർഡർ ചെയ്യണം) | Changing a confirmed order (a customer cancels and orders again) |  |
| `notTested.payments-outside-razorpay` | Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ (ഈ കട Razorpay വഴി വാങ്ങുന്നു) | Payments outside Razorpay (this shop takes Razorpay) |  |
| `notTested.real-whatsapp` | യഥാർത്ഥ WhatsApp | Real WhatsApp |  |
| `notTested.real-razorpay` | യഥാർത്ഥ Razorpay (ടെസ്റ്റ് മോഡ് അല്ലെങ്കിൽ ലൈവ്) | Real Razorpay (test mode or live) |  |
| `notTested.webhook-signatures` | വെബ്ഹുക്ക് ഒപ്പുകൾ | Webhook signatures |  |
| `notTested.real-model` | യഥാർത്ഥ AI മോഡൽ (നിയമങ്ങളും മാതൃകാ മോഡലുകളും ഓടിച്ചു; സന്ദേശങ്ങൾ നിശ്ചിത ടെംപ്ലേറ്റുകളാണ്) | A real AI model (the rules and stand-in models were run; messages are fixed templates) |  |
| `notTested.other-languages` | തമിഴ്, തെലുങ്ക്, മറ്റ് ഭാഷകൾ | Tamil, Telugu and other languages |  |
| `notTested.native-review` | ഹിന്ദി, മലയാളം, കന്നഡ വാക്കുകളെക്കുറിച്ച് മാതൃഭാഷക്കാരുടെ പരിശോധന | A native speaker's review of the Hindi, Malayalam and Kannada wording |  |
| `notTested.restart-mid-step` | ഒരു ഘട്ടത്തിന്റെ നടുവിൽ ക്രാഷ് അല്ലെങ്കിൽ റീസ്റ്റാർട്ട് | A crash or restart in the middle of a step |  |
| `notTested.same-instant` | ഒരേ നിമിഷത്തിൽ അവസാനത്തെ പങ്ക് എടുക്കുന്ന രണ്ട് ഉപഭോക്താക്കൾ | Two customers taking the last portion at the exact same instant |  |
| `notTested.number-words` | ഒന്നു മുതൽ പത്തുവരെ (ഇംഗ്ലീഷിലും ഹിന്ദിയിലും), ഒന്നു മുതൽ അഞ്ചുവരെ (മലയാളത്തിലും കന്നഡയിലും) എന്നിവയല്ലാത്ത വാക്കുകളിൽ എഴുതിയ എണ്ണങ്ങൾ | Quantities written in words other than one to ten (English and Hindi) and one to five (Malayalam and Kannada) |  |
| `notTested.other-faults` | കൈ പരിശോധനയിൽ പറഞ്ഞ തകരാറുകൾക്ക് പുറത്തുള്ള തകരാറുകൾ | Faults beyond the ones the hand check lists |  |
| `notTested.upi-not-automatic` | പണമടവ് സ്വയം പരിശോധിക്കൽ: UPI-യിൽ ഓരോ പണമടവും ഉടമ തന്നെ കിട്ടിയതായി രേഖപ്പെടുത്തുന്നു | automatic payment checking: with UPI the owner marks each payment received |  |
| `notTested.real-upi` | യഥാർത്ഥ UPI ആപ്പിൽ നിന്ന് യഥാർത്ഥ UPI ID-യിലേക്കുള്ള പണമടവ് (ഉടമയുടെ രേഖപ്പെടുത്തലാണ് പരീക്ഷിച്ചത്, പണമടവല്ല) | a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment) |  |
| `notTested.own-settings` | ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ ഉദാഹരണ കടയായ Annapurna Tiffins-ൽ നടത്തി എന്നാണ്) | These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Annapurna Tiffins) |  |
| `notTested.other-settings` | ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിൽ നടത്തി എന്നാണ്) | These checks on this shop's own settings (the go-live certificate says they ran on different settings) |  |
| `notTested.no-go-live-certificate` | ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല) | These checks on this shop's own settings (no go-live certificate was given) |  |
| `notTested.go-live-untrusted` | ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (നൽകിയ പരിശോധനാ സർട്ടിഫിക്കറ്റ് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഉപയോഗിച്ചില്ല) | These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used) |  |
| `notTested.situations-skipped` | ഈ ക്രമീകരണങ്ങളിൽ നടത്താൻ കഴിയാത്ത സാഹചര്യങ്ങൾ (പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ അവയുടെ പേരുകളുണ്ട്) | Situations these settings could not run (named in the go-live certificate) |  |
| `notCounted.balance-at-pickup` | പിക്കപ്പിലോ ഡെലിവറിയിലോ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക: രേഖയിൽ അഡ്വാൻസ് മാത്രമേയുള്ളൂ | The rest of the price, paid in cash or by UPI at pickup or delivery: the record only holds the advance |  |
| `notCounted.kitchen-and-delivery` | ഭക്ഷണം ഉണ്ടാക്കിയോ, എടുത്തോ, എത്തിച്ചോ എന്നത് | Whether the food was made, collected or delivered |  |
| `notCounted.read-receipts` | ഉപഭോക്താവ് സന്ദേശം വായിച്ചോ ഇല്ലയോ | Whether a customer read a message |  |
| `notCounted.outside-agent` | ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ Razorpay-യിലോ UPI ആപ്പിലോ WhatsApp-ലോ ചെയ്തത്) | Anything done outside the agent (by you or anyone else, in Razorpay, your UPI app or WhatsApp) |  |
| `notCounted.rule-breaks` | ഏജന്റ് കാണാത്ത നിയമലംഘനങ്ങൾ: ഏജന്റ് ചെയ്തതും തടഞ്ഞതും മാത്രമാണ് രേഖയിലുള്ളത് | Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing |  |
| `cert.date` | തീയതി | Date |  |
| `cert.held` | 26 സാഹചര്യങ്ങളിൽ 25 എണ്ണം ശരിയായി നിന്നു. 1 എണ്ണം പിഴച്ചു. 12 കാര്യങ്ങൾ പരിശോധിച്ചിട്ടില്ല. | Held 25 of 26 situations. 1 failed. 12 not tested. |  |
| `cert.intro` | തുടങ്ങുന്നതിന് മുമ്പ് തെറ്റാൻ സാധ്യതയുള്ള സാഹചര്യങ്ങൾ ഞങ്ങൾ പരീക്ഷിച്ചു: നഷ്ടപ്പെട്ട മറുപടികൾ, രണ്ടുതവണയോ വൈകിയോ വന്ന പേയ്മെന്റ്, അടയ്ക്കാതെ "അടച്ചു" എന്ന് പറയുന്ന ഉപഭോക്താക്കൾ, സ്റ്റോക്കിന് മുകളിലോ കട്ട്-ഓഫിന് ശേഷമോ ഉള്ള ഓർഡറുകൾ, റീഫണ്ടിനുള്ള അഭ്യർത്ഥനകൾ, ഏജന്റിനെ കബളിപ്പിക്കാൻ ശ്രമിക്കുന്ന ഉപഭോക്താക്കൾ. | Before switching on, we tried situations that could go wrong: lost replies, a payment arriving twice or late, customers saying they paid when they had not, orders past the stock or after the cut-off, requests for refunds, and customers trying to trick the agent. |  |
| `cert.yourLimits` | നിങ്ങളുടെ പരിധികൾ | Your limits |  |
| `cert.paidRule` | പേയ്മെന്റ് രേഖ (അല്ലെങ്കിൽ UPI-യിൽ നിങ്ങളുടെ രേഖപ്പെടുത്തൽ) മുഴുവൻ അഡ്വാൻസും കാണിക്കുന്നതുവരെ ഒരു ഓർഡറും ഉറപ്പിക്കില്ല | No order is confirmed until the payment record (or your UPI mark) shows the whole advance |  |
| `cert.menu` | മെനുവും ഒരു ദിവസം പരമാവധി ഉണ്ടാക്കുന്നതും: Veg thali ₹120 (12) · Curd ₹20 (30) | Menu and the most made in a day: Veg thali ₹120 (12) · Curd ₹20 (30) |  |
| `cert.orderLimits` | ഒരു ദിവസം പരമാവധി 8 ഓർഡറുകൾ, ഒരു ഓർഡറിൽ 10 സാധനങ്ങൾ, 7 ദിവസം മുൻകൂട്ടി വരെ | At most 8 orders a day, 10 items in one order, up to 7 days ahead |  |
| `cert.cutoff` | സാധാരണ കട്ട്-ഓഫ്: 1 ദിവസം മുമ്പ് 20:00-ന് ഓർഡറുകൾ അടയ്ക്കും | The usual cut-off: orders close at 20:00, 1 day before |  |
| `cert.advance` | വിലയുടെ 50% അഡ്വാൻസായി വാങ്ങുന്നു; അതിനായി ഓർഡർ 30 മിനിറ്റ് പിടിച്ചുവെക്കും | 50% of the price is paid as the advance; the order is held 30 minutes for it |  |
| `cert.delivery` | ഡെലിവറി ഇവിടങ്ങളിൽ മാത്രം: Kakkanad, Edappally, Infopark | Delivery only to: Kakkanad, Edappally, Infopark |  |
| `cert.noDelivery` | പിക്കപ്പ് മാത്രം, ഡെലിവറി ഇല്ല | Pickup only, no delivery |  |
| `cert.window` | സ്ലോട്ടിന് കുറഞ്ഞത് 6 മണിക്കൂർ മുമ്പ് റദ്ദാക്കിയാൽ അഡ്വാൻസ് തിരികെ കിട്ടും; അതിനു ശേഷമുള്ളത് നിങ്ങളുടെ തീരുമാനം | Cancel at least 6 hours before the slot and the advance is refunded; later, it is your call |  |
| `cert.refund` | ₹300-ന് മുകളിലുള്ള റീഫണ്ട് നിങ്ങളോട് ചോദിച്ച ശേഷം മാത്രം | Refunds above ₹300 only with your OK |  |
| `cert.approve` | ₹1,000-ന് മുകളിലുള്ള ഓർഡർ ഒരു പേയ്മെന്റും ചോദിക്കുന്നതിന് മുമ്പ് നിങ്ങളുടെ അനുമതിക്കായി കാത്തിരിക്കും | An order above ₹1,000 waits for your OK before any payment is asked |  |
| `cert.noApprove` | വലുപ്പം കൊണ്ടു മാത്രം ഒരു ഓർഡറും നിങ്ങളുടെ അനുമതിക്കായി കാത്തിരിക്കില്ല | No order waits for your OK because of its size |  |
| `cert.notAGrade` | ഇത് പരീക്ഷിച്ച സാഹചര്യങ്ങളുടെ എണ്ണം മാത്രമാണ്. ഇത് ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല. | This counts the situations tried. It does not grade the agent. |  |
| `cert.didNotHold` | പിഴച്ചവ | Did not hold |  |
| `cert.handRunLine` | പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തത് യഥാർത്ഥ WhatsApp, പേയ്മെന്റ് എന്നിവയിലല്ല, പരിശീലന സംവിധാനങ്ങളിലാണ് (stand-in services). ടെസ്റ്റ് പണം മാത്രം. | Checks were run by hand against stand-in services, not real WhatsApp or payments. Test money only. |  |
| `cert.checkedOn` | പരിശോധിച്ചത് | Checks run on |  |
| `goLive.heading` | തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന | Go-live checks |  |
| `goLive.own` | തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ തന്നെയാണ് നടത്തിയത്, 2 Nov 2026-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പ്രകാരം. | The go-live checks ran on this shop's own settings, in the go-live certificate of 2 Nov 2026. |  |
| `goLive.example` | 2 Nov 2026-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഉദാഹരണ കടയായ Annapurna Tiffins-ൽ ആണ് നടത്തിയത് എന്നാണ്, ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ അല്ല. | The go-live certificate of 2 Nov 2026 says its checks ran on the example shop, Annapurna Tiffins, not on this shop's own settings. |  |
| `goLive.different` | 2 Nov 2026-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഈ കടയുടേതിൽ നിന്ന് വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിലാണ് നടത്തിയത് എന്നാണ്, അതിനാൽ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങൾ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് അത് കാണിക്കുന്നില്ല. | The go-live certificate of 2 Nov 2026 says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave. |  |
| `goLive.untrusted` | ഒരു പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിരുന്നു, പക്ഷേ അത് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല (അതിൽ ഒപ്പില്ല, ഒപ്പ് ചേരുന്നില്ല, അല്ലെങ്കിൽ അത് ഈ ഏജന്റിന്റെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് അല്ല), അതിനാൽ ഉപയോഗിച്ചില്ല. | A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used. |  |
| `goLive.none` | പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല, അതിനാൽ തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഏത് ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന് ഈ രേഖ പറയുന്നില്ല. | No go-live certificate was given, so this document does not say what the go-live checks ran on. |  |
| `goLive.signedWith` | പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ ഒപ്പിട്ടത് key-3f9a1c എന്ന കീ ഉപയോഗിച്ചാണ്. ആ കീ ആരുടെ കൈയിലാണെന്ന് കീ കാണിക്കുന്നില്ല. | The go-live certificate is signed with key-3f9a1c. A key does not show who holds it. |  |
| `page.numbers` | കണക്കുകൾ | The numbers |  |
| `page.item` | എന്ത് | What |  |
| `page.count` | എത്ര | How many |  |
| `page.amount` | തുക | Amount |  |
| `page.ordersTaken` | എടുത്ത ഓർഡറുകൾ | Orders taken |  |
| `page.ordersCompleted` | പൂർത്തിയായ ഓർഡറുകൾ | Orders completed |  |
| `page.ordersCancelled` | ഉറപ്പിച്ചതിന് ശേഷം റദ്ദാക്കിയ ഓർഡറുകൾ | Orders cancelled after they were confirmed |  |
| `page.holdsRanOut` | അഡ്വാൻസ് വരുന്നതിന് മുമ്പ് തീർന്ന ഹോൾഡുകൾ | Holds that ran out before an advance |  |
| `page.soldHeading` | ഈ മാസത്തെ ദിവസങ്ങളിലെ ഓർഡറുകൾ | Orders for days in this month |  |
| `page.soldOrders` | ഉറപ്പിച്ചതോ പൂർത്തിയായതോ ആയ ഓർഡറുകൾ | Confirmed or completed orders |  |
| `page.pickup` | പിക്കപ്പ് | Pickup |  |
| `page.delivery` | ഡെലിവറി | Delivery |  |
| `page.itemsSold` | വിറ്റ സാധനങ്ങൾ | Items sold |  |
| `page.noItems` | ഒന്നുമില്ല | None |  |
| `page.messagesHeading` | സന്ദേശങ്ങൾ | Messages |  |
| `page.toYou` | നിങ്ങൾക്ക്, ഉടമയ്ക്ക് | To you, the owner |  |
| `page.heldBack` | അയയ്ക്കുന്നതിന് മുമ്പ് തടഞ്ഞത് | Held back before sending |  |
| `page.stoppedHeading` | നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത് | What your limits stopped |  |
| `page.rule` | പരിധി | Limit |  |
| `page.times` | തവണ | Times |  |
| `page.stoppedCustomers` | STOP അയച്ച ഉപഭോക്താക്കൾ | Customers who sent STOP |  |
| `page.notCountedHeading` | എണ്ണാത്തത് | Not counted |  |
| `page.notTestedHeading` | പരിശോധിക്കാത്തത് | Not tested |  |
| `page.unconfirmed` | ഉറപ്പാകാത്തതോ പരാജയപ്പെട്ടതോ | Left unconfirmed or failed |  |
| `page.checkHeading` | ഈ രേഖ പരിശോധിക്കുക | Check this document |  |
| `page.code` | കോഡ് | Code |  |
| `page.digest` | ഡൈജസ്റ്റ് | Digest |  |
| `page.countedFrom` | എവിടെ നിന്ന് എണ്ണി | Counted from |  |
| `page.setUpBy` | തയ്യാറാക്കിയത് | Set up by |  |
| `page.madeOn` | ഉണ്ടാക്കിയ തീയതി | Made on |  |
| `page.signedBy` | ഒപ്പിട്ടത് | Signed by |  |
| `page.notSigned` | ഒപ്പിട്ടിട്ടില്ല | Not signed |  |
| `page.scanToCheck` | ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ സ്കാൻ ചെയ്യുക. ഇതിന്റെ .json ഫയൽ വേണ്ടിവരും. പരിശോധന നിങ്ങളുടെ ബ്രൗസറിൽ നടക്കുന്നു, ഒന്നും അയയ്ക്കുന്നില്ല. ലിങ്കിൽ ഒപ്പിട്ട കീ ഇല്ല: ആര് ഒപ്പിട്ടു എന്നറിയാൻ ഇവിടെ കാണുന്ന കീ, നിങ്ങളുടെ പങ്കാളിയോ Geometer ടീമോ തന്ന കീയുമായി ഒത്തുനോക്കുക. | Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you. |  |
| `page.signatureNote` | ഈ രേഖ ആരാണ് ഉണ്ടാക്കിയതെന്നും അത് മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. ഇതിൽ എണ്ണിയതെല്ലാം പൂർണ്ണമാണെന്ന് അത് കാണിക്കുന്നില്ല. | A signature shows who made this document and that it has not changed. It does not show that what it counts is complete. |  |
| `page.notAGrade` | ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല. | These are counts of what the record shows. They do not grade the agent. |  |
| `page.period` | കാലയളവ് | Period |  |
| `page.showWhatWeDid` | ഞങ്ങൾ ചെയ്തത് കാണിക്കുക ▸ | Show what we did ▸ |  |
| `page.byActionHeading` | ഏജന്റ് ചെയ്തത്, പ്രവൃത്തി അനുസരിച്ച് | What the agent did, by action |  |
| `page.action` | പ്രവൃത്തി | Action |  |
| `page.agentVersion` | ഏജന്റ് പതിപ്പ് | Agent version |  |
| `page.limitsDigest` | പരിധികളുടെ ഡൈജസ്റ്റ് | Limits digest |  |
| `page.recordDigest` | രേഖയുടെ ഡൈജസ്റ്റ് | Record digest |  |
| `page.liveServices` | യഥാർത്ഥ സംവിധാനങ്ങൾ | Live services |  |

