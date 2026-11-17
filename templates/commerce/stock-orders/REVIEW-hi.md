# Review sheet: Hindi (hi), Stock orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Stock orders agent says in Hindi. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Glow Unisex Salon's (a made-up salon): 10 boxes of hair colour at ₹450 a box from Ravi Traders, a total of ₹4,500.

What to look for first: (1) is each message polite, short and something a salon owner and a wholesaler would really send to each other; (2) are "order", "supplier", "budget", "approve", "box" and "received" the words people use; (3) the owner's typed words "yes CODE", "no CODE", "received po-3", "paid po-3", "cancel po-3" and "send po-3" stay in Latin letters, as they are typed.

Amounts are always written as ₹4,500 with Western digits; items, units, quantities, suppliers and order numbers are filled in from the shop's record, never translated.

## 1. Messages to the supplier (6)

The order and every ask after it are WhatsApp templates (the supplier has usually not written for a day). Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Hindi) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `supplier_order` | To the supplier: the order itself, as a WhatsApp template (the supplier has usually not written in the last day) | नया ऑर्डर po-3 (Glow Unisex Salon की ओर से): 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। कृपया "OK" लिखें अगर आप यह दे सकते हैं, या "NO" अगर नहीं दे सकते। | New order po-3 from Glow Unisex Salon: 10 × hair colour (box), ₹450 per box, total ₹4,500. Please reply OK to confirm you can supply it, or NO if you cannot. |  |
| `supplier_check` | To the supplier: a silent supplier is asked again about the same order (a reminder, not a new order) | पहले भेजे ऑर्डर po-3 की याद दिलाना (Glow Unisex Salon की ओर से): 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। यह वही ऑर्डर है, नया नहीं। कृपया "OK" लिखें अगर आप दे सकते हैं, या "NO" अगर नहीं दे सकते। | Reminder about order po-3 from Glow Unisex Salon, sent earlier: 10 × hair colour (box), ₹450 per box, total ₹4,500. This is the same order, not a new one. Please reply OK to confirm, or NO if you cannot supply it. |  |
| `supplier_which` | To the supplier: a bare OK while several orders wait for their answer | Glow Unisex Salon के कई ऑर्डर आपके जवाब का इंतज़ार कर रहे हैं (po-3)। कृपया ऑर्डर संदेश के बटन से जवाब दें, या "OK" या "NO" के बाद ऑर्डर नंबर लिखें। | Several orders from Glow Unisex Salon are waiting for your answer (po-3). Please answer with the button on the order message, or write OK or NO followed by the order number. |  |
| `supplier_unclear` | To the supplier: their message was not an OK or a NO | आपके संदेश के लिए धन्यवाद। Glow Unisex Salon के ऑर्डर po-3 का जवाब देने के लिए कृपया "OK" या "NO" लिखें, या ऑर्डर संदेश का बटन दबाएँ। | Thank you for your message. To answer order po-3 from Glow Unisex Salon, please reply OK or NO, or use the button on the order message. |  |
| `supplier_thanks_yes` | To the supplier: their OK is noted | धन्यवाद। ऑर्डर po-3 आपकी ओर से पक्का दर्ज हुआ। | Thank you. Order po-3 is noted as confirmed by you. |  |
| `supplier_thanks_no` | To the supplier: their NO is noted | धन्यवाद। ऑर्डर po-3 आपकी ओर से "नहीं दे सकते" दर्ज हुआ। | Thank you. Order po-3 is noted as not supplied by you. |  |

## 2. Messages to the owner (37)

| Template id | When it is sent | Text (Hindi) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `card` | To the owner: the order for approval, with the budget, and the code to approve or decline | मंज़ूरी के लिए ऑर्डर po-3: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500, Ravi Traders से। इस महीने आपके ₹20,000 बजट में से ₹0 रखा जा चुका है, इस ऑर्डर के बाद ₹15,500 बचेगा। बटन से मंज़ूर करें, या "yes K7M2QX" लिखें। मना करने के लिए "no K7M2QX" लिखें। | Order po-3 for your approval: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. This month ₹0 of your ₹20,000 budget is reserved, so ₹15,500 is left after this order. Approve with the button, or reply "yes K7M2QX". To decline reply "no K7M2QX". |  |
| `card_changed` | To the owner: the order changed since a card was shown, so the new card follows | उस कार्ड के बाद ऑर्डर बदल गया, इसलिए पुराना कार्ड मान्य नहीं है और कुछ नहीं भेजा गया। अभी का कार्ड यह है: | The order changed since that card, so the earlier card no longer counts and nothing was sent. Here is the card as it is now: |  |
| `card_closed` | To the owner: a card that was answered or replaced is used again | उस कार्ड का जवाब पहले ही दिया जा चुका है या उसकी जगह नया कार्ड आ गया है, इसलिए कुछ नहीं किया गया। | That card was already answered or replaced, so nothing was done. |  |
| `card_expired` | To the owner: a card ran out (a day) and nothing was sent | उस कार्ड का समय ख़त्म हो गया, इसलिए कुछ नहीं भेजा गया। अगर अब भी चाहिए तो फिर कहें। | That card ran out, so nothing was sent. Ask me again if you still want it. |  |
| `card_unknown` | To the owner: a code that no card has | उस कोड का कोई कार्ड मेरे पास नहीं है, इसलिए कुछ नहीं किया गया। | I have no card with that code, so nothing was done. |  |
| `order_declined` | To the owner: the owner declined; nothing was sent | ऑर्डर po-3 मना कर दिया गया। Ravi Traders को कुछ नहीं भेजा गया। | Order po-3 is declined. Nothing was sent to Ravi Traders. |  |
| `order_approved` | To the owner: approved, the budget reserved, sending now | ऑर्डर po-3 मंज़ूर: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500, Ravi Traders से। इस महीने के बजट से ₹4,500 रख लिया गया है और ₹15,500 बचा है। अब सप्लायर को भेज रहा हूँ। | Order po-3 is approved: 10 × hair colour (box), ₹450 per box, total ₹4,500, from Ravi Traders. ₹4,500 is now reserved from this month's budget and ₹15,500 is left. Sending it to the supplier now. |  |
| `sent_ok` | To the owner: the order message went to the supplier | ऑर्डर po-3 Ravi Traders को भेज दिया गया। उन्होंने अभी जवाब नहीं दिया है। चुप रहने पर मैं फिर पूछूँगा। | Order po-3 went to Ravi Traders. They have not answered yet. I will ask again if they stay silent. |  |
| `sent_unknown` | To the owner: WhatsApp did not confirm the order message; it will not be sent again | ऑर्डर po-3 Ravi Traders तक पहुँचा या नहीं, WhatsApp ने पक्का नहीं बताया। मैं ऑर्डर दोबारा नहीं भेजूँगा। इसके बदले Ravi Traders से po-3 के बारे में पूछूँगा और आपको बताऊँगा। | Order po-3 may or may not have reached Ravi Traders: WhatsApp did not confirm it. I will not send the order again. I will ask Ravi Traders about po-3 instead, and tell you what they say. |  |
| `send_failed` | To the owner: WhatsApp refused the order message; nothing went out | ऑर्डर po-3 Ravi Traders को नहीं गया: WhatsApp ने मना कर दिया, इसलिए कुछ नहीं भेजा गया। बजट रखा हुआ है। फिर कोशिश के लिए "send po-3" लिखें, या छोड़ने के लिए "cancel po-3"। | Order po-3 did not go to Ravi Traders: WhatsApp refused it, so nothing was sent. The budget stays reserved. Reply "send po-3" to try again, or "cancel po-3" to release it. |  |
| `send_blocked` | To the owner: a check held the order message back (for example the supplier asked for no more messages) | ऑर्डर po-3 Ravi Traders को नहीं भेजा गया: एक जाँच ने रोक दिया, जैसे उन्होंने और संदेश न भेजने को कहा हो। कुछ नहीं गया। बजट छोड़ने के लिए "cancel po-3" लिखें। | Order po-3 was not sent to Ravi Traders: a check held it back, for example because they asked for no more messages. Nothing went out. Reply "cancel po-3" to release the budget. |  |
| `owner_supplier_accepted` | To the owner: the supplier said OK (a template; it says this is not delivery) | सप्लायर Ravi Traders ने ऑर्डर po-3 पक्का किया: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। इसका मतलब है कि वे देंगे, यह नहीं कि माल आ गया। माल आने पर "received po-3" लिखें। | Order po-3 confirmed by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. This means they will supply it, not that it has arrived. When it comes, reply "received po-3". |  |
| `owner_supplier_declined` | To the owner: the supplier said NO (a template); the budget is released | सप्लायर Ravi Traders ने ऑर्डर po-3 मना कर दिया: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। माल नहीं आएगा, और रखा हुआ पैसा इस महीने के बजट में वापस आ गया है। कृपया दूसरा सप्लायर चुनें। | Order po-3 was declined by the supplier, Ravi Traders: 10 × hair colour (box), ₹450 per box, total ₹4,500. Nothing is coming, and the money reserved is released back to this month's budget. Please choose another supplier. |  |
| `owner_supplier_silent` | To the owner: no answer after the last follow-up (a template) | सप्लायर Ravi Traders से ऑर्डर po-3 का 24 घंटे बाद भी जवाब नहीं आया: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। मैंने फिर पूछा और नया ऑर्डर नहीं भेजूँगा। कृपया उन्हें फ़ोन करें। ऑर्डर पक्का नहीं है। | No answer yet to order po-3 from the supplier, Ravi Traders, after 24 hours: 10 × hair colour (box), ₹450 per box, total ₹4,500. I asked again and will not send a new order. Please call them. The order is not confirmed. |  |
| `owner_supplier_stopped` | To the owner: a supplier asked for no more messages | सप्लायर Ravi Traders ने और संदेश न भेजने को कहा है, इसलिए मैं उन्हें दोबारा संदेश नहीं भेजूँगा। उनके लिए रुका हुआ ऑर्डर नहीं भेजा जाएगा, मैं बताऊँगा कौन सा। | Supplier Ravi Traders asked for no more messages, so I will not message them again. Any order waiting for them stays unsent, and I will tell you which. |  |
| `received_full` | To the owner: all of the order is marked received (the owner's own mark) | पूरा माल आया दर्ज: ऑर्डर po-3, 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500। यह आपका दर्ज किया हुआ है, सप्लायर का नहीं। भुगतान अलग बात है: भुगतान करने पर "paid po-3" लिखें। | Marked received, all of it: order po-3, 10 × hair colour (box), ₹450 per box, total ₹4,500. This is your mark, not the supplier's. Payment is separate: reply "paid po-3" when you have paid. |  |
| `received_part` | To the owner: part of the order is marked received | दर्ज: ऑर्डर po-3 (हेयर कलर) के 10 में से 4 आए। 6 आना बाकी है। बाकी आने पर "received po-3 6" लिखें। | Marked: 4 of 10 received for order po-3 (hair colour). 6 still to come. Reply "received po-3 6" when the rest arrives. |  |
| `received_wrong` | To the owner: the wrong item is marked | दर्ज: ऑर्डर po-3 (हेयर कलर) में ग़लत माल आया। इसे आया हुआ नहीं गिना गया। कृपया Ravi Traders से बात करें: मैंने उन्हें कुछ नहीं भेजा। | Marked: the wrong item came for order po-3 (hair colour). It is not counted as received. Please sort it out with Ravi Traders: I sent them nothing. |  |
| `receive_too_many` | To the owner: more marked received than is still to come | आपने 9 लिखा, पर ऑर्डर po-3 का सिर्फ़ 6 आना बाकी है। कुछ दर्ज नहीं हुआ। कृपया बताएँ कि असल में क्या आया। | You wrote 9, but only 6 of order po-3 are still to come. Nothing was marked. Please tell me what actually arrived. |  |
| `order_not_open` | To the owner: a command that cannot apply to the order now, with what it is waiting on | ऑर्डर po-3 में अभी यह बदलाव नहीं हो सकता: वह भेजा गया, जवाब नहीं आया। | Order po-3 cannot be changed that way now: it is sent, no answer yet. |  |
| `paid_outside_noted` | To the owner: the owner's note that they paid outside the chat | दर्ज: आपने ऑर्डर po-3 का भुगतान इस चैट के बाहर ख़ुद किया। मैंने कुछ नहीं चुकाया और जाँच नहीं सकता: यह सिर्फ़ आपका दर्ज किया हुआ है। | Noted: you paid for order po-3 yourself, outside this chat. I paid nothing and cannot check it: it is only your mark. |  |
| `cannot_change` | To the owner: an approved order cannot be changed | ऑर्डर po-3 मंज़ूर हो चुका है, इसलिए बदला नहीं जा सकता। अगर ग़लत है तो Ravi Traders से सीधे बात करें, फिर मुझे नया अनुरोध भेजें। | Order po-3 is already approved, so it cannot be changed. If it is wrong, ask Ravi Traders directly, then send me a new request. |  |
| `cancelled` | To the owner: an order is cancelled before it went to the supplier | ऑर्डर po-3 रद्द हुआ। कुछ नहीं भेजा गया, और इसने जो बजट रखा था वह छूट गया। | Order po-3 is cancelled. Nothing was sent, and any budget it held is released. |  |
| `cannot_cancel` | To the owner: an order already with the supplier cannot be cancelled here | ऑर्डर po-3 पहले ही Ravi Traders के पास है, इसलिए मैं यहाँ से रद्द नहीं कर सकता। कृपया उन्हें ख़ुद बताएँ। | Order po-3 is already with Ravi Traders, so I cannot cancel it from here. Please tell them yourself. |  |
| `no_such_order` | To the owner: an order number the agent does not have | मेरे पास ऑर्डर po-3 नहीं है। | I have no order po-3. |  |
| `ask_line` | To the owner: more than one way to order an item; a list of the ways follows | हेयर कलर मँगाने के एक से ज़्यादा तरीके हैं। आपका मतलब कौन सा है? | There is more than one way to order hair colour. Which one do you mean? |  |
| `ask_qty` | To the owner: how many (a low-stock mark with no usual quantity) | Ravi Traders से हेयर कलर के कितने डिब्बा मँगाऊँ? एक संख्या लिखें। | How many box of hair colour from Ravi Traders should I order? Reply with a number. |  |
| `item_unknown` | To the owner: an item that is not in the catalogue, with what can be ordered | यह आपकी सूची में नहीं है, इसलिए कुछ नहीं मँगाया गया। मैं ये मँगा सकता हूँ: हेयर कलर। | I do not have that in your catalogue, so nothing was ordered. I can order: hair colour. |  |
| `blocked_supplier` | To the owner: the supplier is not on the approved list, or is paused | कुछ नहीं मँगाया गया: Ravi Traders आपकी मंज़ूर सप्लायर सूची में नहीं है, या रोका हुआ है। किसी को कुछ नहीं भेजा गया। | Nothing was ordered: Ravi Traders is not on your approved supplier list, or is paused. Nothing was sent to anyone. |  |
| `blocked_cap` | To the owner: the order is above the most one order may be worth | कुछ नहीं मँगाया गया: 10 × हेयर कलर (डिब्बा), ₹450 प्रति डिब्बा, कुल ₹4,500 एक ऑर्डर की ₹12,000 की हद से ज़्यादा है। कम मँगाएँ, या अपने ऑपरेटर से हद बदलने को कहें। | Nothing was ordered: 10 × hair colour (box), ₹450 per box, total ₹4,500 is more than the ₹12,000 one order may be worth. Order less, or ask your Operator to change the limit. |  |
| `blocked_budget` | To the owner: the order is more than is left of the month's budget | कुछ नहीं मँगाया गया: ₹4,500 इस महीने (Nov 2026) के ₹20,000 बजट के बचे ₹15,500 से ज़्यादा है। | Nothing was ordered: ₹4,500 is more than the ₹15,500 left of this month's ₹20,000 budget (Nov 2026). |  |
| `blocked_qty` | To the owner: a quantity above the most one order may have (a typing slip) | कुछ नहीं मँगाया गया: 9 एक ऑर्डर के 200 से ज़्यादा है, यह टाइपिंग की ग़लती लगती है। कृपया संख्या फिर लिखें। | Nothing was ordered: 9 is more than 200 in one order, which looks like a typing slip. Please write the number again. |  |
| `already_open` | To the owner: a low-stock mark for something already on order | Ravi Traders से हेयर कलर का ऑर्डर po-3 पहले से खुला है, इसलिए दूसरा नहीं बनाया। देखने के लिए "status" लिखें। | Order po-3 for hair colour from Ravi Traders is already open, so I did not make another. Reply "status" to see it. |  |
| `status` | To the owner: the open orders and the month's budget | खुले स्टॉक ऑर्डर: po-3: 10 × हेयर कलर (डिब्बा), Ravi Traders से, ₹4,500, सप्लायर ने मान लिया, माल अभी नहीं आया इस महीने (Nov 2026) आपके ₹20,000 बजट में से ₹0 रखा जा चुका है। | Open stock orders: po-3: 10 × hair colour (box) from Ravi Traders, ₹4,500, supplier confirmed, not received yet This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `status_empty` | To the owner: no open orders, and the month's budget | कोई स्टॉक ऑर्डर खुला नहीं है। इस महीने (Nov 2026) आपके ₹20,000 बजट में से ₹0 रखा जा चुका है। | No open stock orders. This month (Nov 2026): ₹0 of your ₹20,000 budget is reserved. |  |
| `didnt_understand` | To the owner: the message was not understood, with examples | मैं समझ नहीं पाया कि आप क्या चाहते हैं। आप ऐसे लिख सकते हैं: "order 10 डिब्बा हेयर कलर from Ravi Traders", "received po-3", "paid po-3" या "status"। | I could not tell what you want. You can write, for example, "order 10 box hair colour from Ravi Traders", "received po-3", "paid po-3" or "status". |  |
| `owner_message_held` | To the owner: a message about an order was held back because it did not match the record | ऑर्डर po-3 के बारे में एक संदेश मैंने रोक लिया क्योंकि वह मेरे रिकॉर्ड से मेल नहीं खाता था। कुछ ग़लत नहीं भेजा गया। कृपया ऑर्डर देख लें। | I held back a message about order po-3 because it did not match my record. Nothing wrong was sent. Please check the order. |  |

### The words for what an order is waiting on (the status list)

| Id | Text (Hindi) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `awaiting` | आपकी मंज़ूरी का इंतज़ार | waiting for your approval |  |
| `sending` | भेजा जा रहा है | being sent |  |
| `sent` | भेजा गया, जवाब नहीं आया | sent, no answer yet |  |
| `unknown` | शायद सप्लायर तक नहीं पहुँचा | may not have reached the supplier |  |
| `accepted` | सप्लायर ने मान लिया, माल अभी नहीं आया | supplier confirmed, not received yet |  |
| `part` | थोड़ा माल आया | part received |  |
| `failed` | भेजा नहीं गया (WhatsApp ने मना किया) | not sent (WhatsApp refused it) |  |
| `blocked` | भेजा नहीं गया (रोका गया) | not sent (held back) |  |

### The words on the buttons and the list

A button is at most 20 letters and a label never carries an amount. A tap carries an id, so no one's words are read from these.

| Id | Text (Hindi) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `approve` | मंज़ूर करें | Approve |  |
| `decline` | मना करें | Decline |  |
| `supplierYes` | ठीक है | OK |  |
| `supplierNo` | नहीं दे सकते | Cannot supply |  |
| `choose` | चुनें | Choose |  |

## 3. Months and weekdays as the agent writes them

| Weekday | Written in Hindi | Native reviewer: OK / change to … |
| --- | --- | --- |
| Sunday | रविवार |  |
| Monday | सोमवार |  |
| Tuesday | मंगलवार |  |
| Wednesday | बुधवार |  |
| Thursday | गुरुवार |  |
| Friday | शुक्रवार |  |
| Saturday | शनिवार |  |

| Month | Written in Hindi | Native reviewer: OK / change to … |
| --- | --- | --- |
| January | जनवरी |  |
| February | फरवरी |  |
| March | मार्च |  |
| April | अप्रैल |  |
| May | मई |  |
| June | जून |  |
| July | जुलाई |  |
| August | अगस्त |  |
| September | सितंबर |  |
| October | अक्टूबर |  |
| November | नवंबर |  |
| December | दिसंबर |  |

The agent names the month of the budget in English letters ("Nov 2026") in every language; a reviewer may ask for the local name.

