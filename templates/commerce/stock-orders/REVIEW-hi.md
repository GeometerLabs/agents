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

## 4. The monthly report

The report says how many orders were placed, answered by the supplier, received in full or in part, and how much of the budget was used. It never says an order was paid unless the owner marked it.

### The monthly report on WhatsApp, with sample numbers

```text
*मासिक रिपोर्ट: Glow Unisex Salon · फरवरी 2027*
दिए गए ऑर्डर: *9* · सप्लायर ने OK कहा: *7* · पूरा माल आया: *4* · कुछ माल आया: *1* · गलत सामान: *1*
सप्लायर ने मना किया: *1* · सप्लायर का जवाब नहीं: *1* · रद्द या भेजे नहीं गए: *0*
इस्तेमाल हुआ बजट: *₹20,000 में से ₹9,000 · आपने भुगतान दर्ज किया (आपका नोट): 2*
आपकी सीमाओं ने रोका: *3*
*जाँचा नहीं गया*: असली WhatsApp · असली सप्लायर के जवाब · सप्लायर को पैसे देना · शब्दों की किसी मूल भाषी से जाँच · और 10 (पूरी रिपोर्ट में)। जाँच हाथ से की गई।
कोड: 7K2M-9QXD · पूरी रिपोर्ट: https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-hi.html
असली है या नहीं, जाँचें: https://geometer.dev/verify/#s1.AQAABzIwMjctMDIIYm9va2luZ3MKR2xvdyBTYWxvbhZEaXZ5YSwgU3JpIFNhaSBEaWdpdGFsCCaAtmvAuAIFAwIBAQAD7HYMdtfjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU.vv5O7CGK4abVQwEqt804NE5labc4lCf_1zxL3gxqPdd0PpWcfm9nMIYTIxLlfw1xZHrM0O_po3wKDN00iDnaCg
सपोर्ट को लिखें। एक इंसान जवाब देता है।
तैयार किया: Divya, Sri Sai Digital · Geometer
★ इनोवेटर
```

### The owner's text, with sample numbers

```text
Glow Unisex Salon · फरवरी 2027 · अभ्यास वाले नकली सिस्टम, टेस्ट पैसा
दिए गए ऑर्डर: 9 · सप्लायर ने OK कहा: 7 · पूरा माल आया: 4 · कुछ माल आया: 1 · गलत सामान: 1
सप्लायर ने मना किया: 1 · सप्लायर का जवाब नहीं: 1 · रद्द या भेजे नहीं गए: 0
इस्तेमाल हुआ बजट: ₹20,000 में से ₹9,000 · आपने भुगतान दर्ज किया (आपका नोट): 2
आपकी सीमाओं ने रोका: 3 (महीने के बजट से ऊपर के ऑर्डर: 2 · आपकी मंज़ूर सूची में न होने वाले सप्लायर: 1)
जाँचा नहीं गया: असली WhatsApp · असली सप्लायर के जवाब · सप्लायर को पैसे देना · शब्दों की किसी मूल भाषी से जाँच · और 10 (पूरी रिपोर्ट में)। जाँच हाथ से की गई।
```

### Every word and phrase of the report

| Id | Text (Hindi) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `agent` | स्टॉक ऑर्डर एजेंट | Stock orders agent |  |
| `monthlyReport` | मासिक रिपोर्ट | Monthly report |  |
| `goLiveCertificate` | चालू करने से पहले का जाँच प्रमाणपत्र | Go-live certificate |  |
| `fullReport` | पूरी रिपोर्ट | Full report |  |
| `checkGenuine` | असली है या नहीं, जाँचें | Check it is genuine |  |
| `helpLine` | सपोर्ट को लिखें। एक इंसान जवाब देता है। | Write to support. A person answers. |  |
| `promise` | आपकी मंज़ूरी के बिना कोई ऑर्डर सप्लायर को नहीं जाता; एजेंट किसी को पैसे नहीं देता। | Nothing goes to a supplier without your approval; the agent pays no one. |  |
| `handRun` | जाँच हाथ से की गई। | Checks were run by hand. |  |
| `sourceTag.stand-in` | अभ्यास वाले नकली सिस्टम, टेस्ट पैसा | stand-in services, test money |  |
| `sourceTag.test-mode` | टेस्ट मोड, टेस्ट पैसा | test mode, test money |  |
| `more` | और 12 (पूरी रिपोर्ट में) | and 12 more (see the full report) |  |
| `budgetOf` | ₹20,000 में से ₹9,000 | ₹9,000 of ₹20,000 |  |
| `label.placed` | दिए गए ऑर्डर | Orders placed |  |
| `label.acknowledged` | सप्लायर ने OK कहा | Supplier said OK |  |
| `label.receivedFull` | पूरा माल आया | Received in full |  |
| `label.partReceived` | कुछ माल आया | Part received |  |
| `label.wrongItem` | गलत सामान | Wrong item |  |
| `label.supplierSaidNo` | सप्लायर ने मना किया | Supplier said no |  |
| `label.noAnswer` | सप्लायर का जवाब नहीं | No answer from the supplier |  |
| `label.neverSent` | रद्द या भेजे नहीं गए | Cancelled or never sent |  |
| `label.budgetUsed` | इस्तेमाल हुआ बजट | Budget used |  |
| `label.budgetLeft` | बचा हुआ बजट | Budget left |  |
| `label.markedPaid` | आपने भुगतान दर्ज किया (आपका नोट) | Marked paid by you (your note) |  |
| `label.asked` | आपसे पूछा गया | You were asked |  |
| `label.approved` | आपने मंज़ूर किया | You approved |  |
| `label.saidNo` | आपने मना किया | You said no |  |
| `label.stopped` | आपकी सीमाओं ने रोका | Stopped by your limits |  |
| `label.notChecked` | जाँचा नहीं गया | Not checked |  |
| `stop.monthly-budget` | महीने के बजट से ऊपर के ऑर्डर | Orders over the month's budget |  |
| `stop.per-order-cap` | एक ऑर्डर की सीमा से ऊपर के ऑर्डर | Orders above your one-order limit |  |
| `stop.order-quantity` | गलती जैसी लगने वाली मात्रा | Quantities that looked like a slip |  |
| `stop.approved-supplier-only` | आपकी मंज़ूर सूची में न होने वाले सप्लायर | Suppliers not on your approved list |  |
| `stop.approval-matches-order` | ऑर्डर से न मिलने वाली मंज़ूरियाँ | Approvals that no longer matched the order |  |
| `stop.one-order-per-request` | एक अनुरोध से दूसरा ऑर्डर | A second order from one request |  |
| `stop.reply-from-supplier` | सप्लायर के न होने वाले जवाब | Replies that were not the supplier's |  |
| `stop.send-only-when-approved` | बिना मंज़ूरी के भेजने की कोशिशें | Sends that were not approved |  |
| `stop.message-matches-record` | रिकॉर्ड से न मिलने वाले संदेश | Messages that did not match the record |  |
| `stop.opt-out` | STOP के बाद संदेश | Messages after STOP |  |
| `stop.other` | आपकी सीमाओं ने रोकी कोई और बात | Something else your limits held back |  |
| `notChecked.whatsapp` | असली WhatsApp | real WhatsApp |  |
| `notChecked.supplier` | असली सप्लायर के जवाब | real suppliers' replies |  |
| `notChecked.paying` | सप्लायर को पैसे देना | paying a supplier |  |
| `notChecked.review` | शब्दों की किसी मूल भाषी से जाँच | a native speaker's review of the wording |  |
| `notTested.real-whatsapp` | असली WhatsApp: असली खाता, Meta से असली टेम्पलेट मंज़ूरी, असली सप्लायर का फ़ोन | Real WhatsApp: a real account, a real Meta template approval, a real supplier's phone |  |
| `notTested.native-review` | हिंदी, मलयालम और कन्नड़ शब्दों की किसी मूल भाषी से जाँच | A native speaker's review of the Hindi, Malayalam and Kannada wording |  |
| `notTested.model-reading` | मालिक के अनुरोध को AI मॉडल से पढ़वाना (सिर्फ़ नियमों वाला पाठक आज़माया गया; जो अनुरोध वह नहीं पढ़ पाता, उसके बारे में पूछा जाता है, अंदाज़ा नहीं लगाया जाता) | An owner's request read by an AI model (only the rule reader was tried; a request it cannot read is asked about, not guessed) |  |
| `notTested.supplier-formats` | असली सप्लायर के जवाब देने के कई तरीके (वॉइस नोट, बिल की फ़ोटो, दूसरी लिपि, पुराने संदेश को उद्धृत करता जवाब) | The many ways real suppliers answer (a voice note, a photo of a bill, another script, a reply that quotes an older message) |  |
| `notTested.restart` | मंज़ूरी के बीच में रीस्टार्ट (जाँच में सब कुछ मेमोरी में रखा गया था) | A restart in the middle of an approval (the checks kept everything in memory) |  |
| `notTested.paying` | सप्लायर को पैसे देना (एजेंट किसी को पैसे नहीं देता; आपका अपना नोट सिर्फ़ आपकी बात है) | Paying a supplier (the agent pays no one; your own note is only your word) |  |
| `notTested.invoice` | सप्लायर का इनवॉइस, कैटलॉग से अलग दाम, सप्लायर की ओर से आधे माल की सूचना, माल की वापसी | A supplier's invoice, a price that differs from the catalogue, a part-shipment note from the supplier, a return of goods |  |
| `notTested.real-month` | मंज़ूरी खुली रहते महीना बदल जाना | A month that turns while an approval is open |  |
| `notTested.own-settings` | ये जाँच इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे उदाहरण दुकान Glow Unisex Salon पर चली थीं) | These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Glow Unisex Salon) |  |
| `notTested.other-settings` | ये जाँच इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे अलग सेटिंग पर चली थीं) | These checks on this shop's own settings (the go-live certificate says they ran on different settings) |  |
| `notTested.no-go-live-certificate` | ये जाँच इस दुकान की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र नहीं दिया गया) | These checks on this shop's own settings (no go-live certificate was given) |  |
| `notTested.go-live-untrusted` | ये जाँच इस दुकान की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया) | These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used) |  |
| `notTested.situations-skipped` | वे स्थितियाँ जो इन सेटिंग पर चल नहीं सकीं (जाँच प्रमाणपत्र में नाम दिए हैं) | Situations these settings could not run (named in the go-live certificate) |  |
| `notCounted.goods-really-arrived` | माल सच में आया या नहीं: सिर्फ़ आपका अपना दर्ज किया हुआ गिना जाता है | Whether the goods really arrived: only your own mark is counted |  |
| `notCounted.payments` | सप्लायर को भुगतान: यह एजेंट किसी को पैसे नहीं देता और कोई भुगतान देख नहीं सकता; सिर्फ़ आपका अपना नोट गिना जाता है | Payments to suppliers: this agent pays no one and cannot see a payment; only your own note is counted |  |
| `notCounted.outside-agent` | एजेंट के बाहर दिए गए ऑर्डर (फ़ोन पर, सामने या किसी और चैट में) | Orders placed outside the agent (by phone, in person or in another chat) |  |
| `notCounted.read-receipts` | सप्लायर ने संदेश पढ़ा या नहीं | Whether a supplier read a message |  |
| `notCounted.rule-breaks` | नियम टूटने की वे बातें जो एजेंट ने नहीं देखीं: रिकॉर्ड में वही है जो एजेंट ने किया और जिससे उसे रोका गया | Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing |  |
| `cert.date` | तारीख़ | Date |  |
| `cert.held` | 15 में से 14 स्थितियाँ ठीक रहीं। 1 में गड़बड़ हुई। 12 बातें जाँची नहीं गईं। | Held 14 of 15 situations. 1 failed. 12 not tested. |  |
| `cert.intro` | चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: ऑर्डर संदेश का खोया हुआ जवाब, कभी जवाब न देने वाला सप्लायर, बजट के आख़िरी हिस्से के लिए दो ऑर्डर की होड़, आपकी मंज़ूरी के बाद बदलती मात्रा या दाम, आपकी सूची में न होने वाला सप्लायर, और गलत सामान का आना। | Before switching on, we tried situations that could go wrong: a lost reply to an order message, a supplier who never answers, two orders racing for the last of the budget, a quantity or price that changes after you approve, a supplier who is not on your list, and a wrong item arriving. |  |
| `cert.yourLimits` | आपकी सीमाएँ | Your limits |  |
| `cert.paidRule` | आपकी मंज़ूरी के बिना ठीक वही ऑर्डर किसी सप्लायर को नहीं जाता, और एजेंट किसी को पैसे नहीं देता | Nothing goes to a supplier until you approve that exact order, and the agent pays no one |  |
| `cert.budget` | महीने का बजट: ₹20,000, ऑर्डर मंज़ूर करते ही अलग रख दिया जाता है | Budget for the month: ₹20,000, set aside when you approve an order |  |
| `cert.cap` | एक ऑर्डर ज़्यादा से ज़्यादा ₹12,000 का | One order is at most ₹12,000 |  |
| `cert.maxQty` | एक ऑर्डर में एक चीज़ की ज़्यादा से ज़्यादा 200 इकाइयाँ | At most 200 units of one item in one order |  |
| `cert.suppliers` | 2 मंज़ूर सप्लायर; 1 सूची में हैं पर रोके गए हैं (उन्हें ऑर्डर नहीं जाता) | 2 approved suppliers; 1 on the list but paused (never ordered from) |  |
| `cert.followUp` | जिस सप्लायर ने जवाब नहीं दिया उससे 4, 24 घंटे बाद फिर पूछा जाता है; आख़िरी बार के बाद आपको बताया जाता है | A supplier who has not answered is asked again after 4, 24 hours; after the last time you are told |  |
| `cert.notAGrade` | यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती। | This counts the situations tried. It does not grade the agent. |  |
| `cert.didNotHold` | जिनमें गड़बड़ हुई | Did not hold |  |
| `cert.handRunLine` | जाँच हाथ से की गई, असली WhatsApp पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम (stand-in services) पर। कोई पैसा नहीं हिला। | Checks were run by hand against stand-in services, not real WhatsApp. No money moved. |  |
| `cert.checkedOn` | जाँच इन पर की गई | Checks run on |  |
| `goLive.heading` | चालू करने से पहले की जाँच | Go-live checks |  |
| `goLive.own` | चालू करने से पहले की जाँच इसी दुकान की अपनी सेटिंग पर चली थी, 2 Nov 2026 के जाँच प्रमाणपत्र के अनुसार। | The go-live checks ran on this shop's own settings, in the go-live certificate of 2 Nov 2026. |  |
| `goLive.example` | 2 Nov 2026 का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण दुकान Glow Unisex Salon पर चली थी, इस दुकान की अपनी सेटिंग पर नहीं। | The go-live certificate of 2 Nov 2026 says its checks ran on the example shop, Glow Unisex Salon, not on this shop's own settings. |  |
| `goLive.different` | 2 Nov 2026 का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस दुकान से अलग सेटिंग पर चली थी, इसलिए उससे इस दुकान की अपनी सेटिंग का हाल पता नहीं चलता। | The go-live certificate of 2 Nov 2026 says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave. |  |
| `goLive.untrusted` | एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह इस एजेंट का जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया। | A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used. |  |
| `goLive.none` | कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी। | No go-live certificate was given, so this document does not say what the go-live checks ran on. |  |
| `goLive.signedWith` | जाँच प्रमाणपत्र पर key-3f9a1c कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है। | The go-live certificate is signed with key-3f9a1c. A key does not show who holds it. |  |
| `page.numbers` | आँकड़े | The numbers |  |
| `page.item` | क्या | What |  |
| `page.count` | कितने | How many |  |
| `page.amount` | रकम | Amount |  |
| `page.ordersHeading` | इस महीने मंज़ूर हुए ऑर्डर | Orders approved in this month |  |
| `page.budgetHeading` | महीने का बजट | The month's budget |  |
| `page.monthlyBudget` | महीने का बजट | Budget for the month |  |
| `page.ownersNoteHeading` | आपका अपना नोट | Your own note |  |
| `page.suppliersHeading` | सप्लायर के हिसाब से | By supplier |  |
| `page.supplier` | सप्लायर | Supplier |  |
| `page.stoppedHeading` | आपकी सीमाओं ने क्या रोका | What your limits stopped |  |
| `page.rule` | सीमा | Limit |  |
| `page.times` | बार | Times |  |
| `page.notCountedHeading` | गिना नहीं गया | Not counted |  |
| `page.notTestedHeading` | जाँचा नहीं गया | Not tested |  |
| `page.unconfirmed` | ऑर्डर संदेश जिन्हें WhatsApp ने पक्का नहीं किया | Order messages WhatsApp did not confirm |  |
| `page.checkHeading` | इस दस्तावेज़ को जाँचें | Check this document |  |
| `page.code` | कोड | Code |  |
| `page.digest` | डाइजेस्ट | Digest |  |
| `page.countedFrom` | कहाँ से गिना | Counted from |  |
| `page.setUpBy` | तैयार किया | Set up by |  |
| `page.madeOn` | बनाया गया | Made on |  |
| `page.signedBy` | हस्ताक्षर | Signed by |  |
| `page.notSigned` | हस्ताक्षर नहीं | Not signed |  |
| `page.signatureNote` | हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं। | A signature shows who made this document and that it has not changed. It does not show that what it counts is complete. |  |
| `page.scanToCheck` | इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके ऑपरेटर या Geometer की टीम ने दी है। | Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your Operator or Geometer's team gave you. |  |
| `page.scanSummary` | इस दस्तावेज़ को geometer.dev पर जाँचने के लिए यह कोड स्कैन करें या लिंक खोलें। इससे पता चलता है कि दस्तावेज़ असली है या नहीं, इसे किसने जारी किया, और इस पन्ने से मिलाने के लिए आँकड़े। जाँच आपके फ़ोन पर होती है, दस्तावेज़ के बारे में कुछ भेजा नहीं जाता। यह नहीं बताता कि आँकड़े सच हैं। | Scan this code, or open the link, to check this paper on geometer.dev. It shows whether the paper is genuine, who issued it, and the figures to compare with this page. The check runs on your phone and nothing about the paper is sent. It does not show that the numbers are true. |  |
| `page.notAGrade` | ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं। | These are counts of what the record shows. They do not grade the agent. |  |
| `page.period` | अवधि | Period |  |
| `page.showWhatWeDid` | देखें हमने क्या किया ▸ | Show what we did ▸ |  |
| `page.byActionHeading` | एजेंट ने क्या किया, काम के हिसाब से | What the agent did, by action |  |
| `page.action` | काम | Action |  |
| `page.agentVersion` | एजेंट का संस्करण | Agent version |  |
| `page.limitsDigest` | सीमाओं का डाइजेस्ट | Limits digest |  |
| `page.recordDigest` | रिकॉर्ड का डाइजेस्ट | Record digest |  |
| `page.liveServices` | असली सिस्टम | Live services |  |

| `pages.block.locked` | अब मालिक के पास अपना साइन-इन है। नया फ़ोन मालिक के ऐप से, या मालिक के रिकवरी कोड से जुड़ता है। | The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes. |  |
| `pages.block.askRemove` | मालिक की पासकी हटाने का अनुरोध करें | Ask to remove the owner's passkeys |  |
| `pages.block.askRemoveNote` | ऐसे मालिक के लिए जिसके सारे फ़ोन खो गए और जिसके पास कोड नहीं हैं। मालिक को तुरंत बताया जाता है और वे रद्द कर सकते हैं; न करें तो 48 घंटे बाद यह होता है, और तभी आप नया सेटअप QR कोड दिखा सकते हैं। | For an owner who lost every phone and has no codes. The owner is told at once and can cancel; if they do not, it happens after 48 hours, and only then can you show a new setup QR code. |  |
| `pages.block.requested` | अनुरोध हो गया। मालिक को अपने ऐप में अभी दिखेगा। वे रद्द न करें तो 48 घंटे में हो जाएगा। | Asked. The owner sees it in their app now. If they do not cancel, it happens in 48 hours. |  |
| `pages.block.pending` | Divya ने मालिक की पासकी हटाने को कहा है। मालिक रद्द न करें तो यह 2026-11-21 10:00 UTC को होगा। | Divya asked to remove the owner's passkeys. It happens on 2026-11-21 10:00 UTC unless the owner cancels. |  |
| `pages.block.resetLine` | Geometer ने 2026-11-19 को मालिक का साइन-इन रीसेट किया: the owner lost every phone | Geometer reset the owner's sign-in on 2026-11-19: the owner lost every phone |  |
| `pages.block.lockedNotice` | अब मालिक के पास अपना साइन-इन है। नया फ़ोन मालिक के ऐप से, या मालिक के रिकवरी कोड से जुड़ता है। | The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes. |  |
| `phones.title` | वे फ़ोन जो आपकी दुकान खोल सकते हैं | Phones that can open your shop |  |
| `phones.link` | वे फ़ोन जो आपकी दुकान खोल सकते हैं | Phones that can open your shop |  |
| `phones.intro` | सिर्फ़ यही फ़ोन आपकी दुकान का ऐप खोल सकते हैं। कोई फ़ोन अनजान दिखे तो उसे हटा दीजिए। | Only these phones can open your shop's app. If you see one you do not know, remove it. |  |
| `phones.thisPhone` | यह फ़ोन | This phone |  |
| `phones.aPhone` | एक फ़ोन | A phone |  |
| `phones.added` | 19 Nov 2026 को जोड़ा गया | Added 19 Nov 2026 |  |
| `phones.via.setup` | सेटअप QR कोड से | with the setup QR code |  |
| `phones.via.recovery` | रिकवरी कोड से | with a recovery code |  |
| `phones.via.own_phone` | आपके अपने फ़ोन से | from your own phone |  |
| `phones.via.reset` | Geometer के आपका साइन-इन रीसेट करने के बाद | after Geometer reset your sign-in |  |
| `phones.lastUsed` | आख़िरी बार 19 Nov, 3:42 pm को इस्तेमाल हुआ | Last used 19 Nov, 3:42 pm |  |
| `phones.neverUsed` | अभी तक इस्तेमाल नहीं हुआ | Not used yet |  |
| `phones.remove` | हटाएँ | Remove |  |
| `phones.removeTitle` | यह फ़ोन हटाएँ? | Remove this phone? |  |
| `phones.removeAsk` | Android, Chrome अब आपकी दुकान नहीं खोल पाएगा। | Android, Chrome will not be able to open your shop any more. |  |
| `phones.removeYes` | हाँ, हटाइए | Yes, remove it |  |
| `phones.keep` | नहीं, रहने दीजिए | No, keep it |  |
| `phones.lastTitle` | यह आपका अकेला फ़ोन है | This is your only phone |  |
| `phones.lastAsk` | इसे हटाने पर आप अपने रिकवरी कोड से, या अपने ऑपरेटर की मदद से ही वापस आ पाएँगे, जिसमें 2 दिन लगते हैं। फिर भी हटाएँ? | If you remove it, you can only get back in with your own recovery codes, or with your Operator's help, which takes 2 days. Remove it anyway? |  |
| `phones.lastYes` | हाँ, मेरा अकेला फ़ोन हटाइए | Yes, remove my only phone |  |
| `phones.removed` | वह फ़ोन हटा दिया गया। | That phone is removed. |  |
| `phones.add` | फ़ोन जोड़ें | Add a phone |  |
| `phones.addNote` | इस स्क्रीन पर एक बार चलने वाला कोड दिखता है। नए फ़ोन के कैमरे से 15 मिनट के भीतर स्कैन कीजिए। | Shows a one-use code on this screen. Scan it with the new phone's camera within 15 minutes. |  |
| `phones.addTitle` | नया फ़ोन जोड़ें | Add a new phone |  |
| `phones.addHow` | इसे नए फ़ोन के कैमरे से स्कैन कीजिए और उसके फ़िंगरप्रिंट रीडर को छुइए। यह एक बार चलेगा, 4:30 pm तक। | Scan this with the new phone's camera and touch its fingerprint reader. It works once, until 4:30 pm. |  |
| `phones.codes` | आपके अपने रिकवरी कोड | Your own recovery codes |  |
| `phones.codesNone` | आपने अपने कोड अभी नहीं बनाए हैं। | You have not made your own codes yet. |  |
| `phones.codesHave` | आपने अपने कोड 19 Nov 2026 को बनाए। ये सिर्फ़ आपके पास हैं। | You made your own codes on 19 Nov 2026. Only you hold them. |  |
| `phones.codesMake` | मेरे अपने रिकवरी कोड बनाएँ | Make my own recovery codes |  |
| `phones.codesRemake` | नए कोड बनाएँ | Make new codes |  |
| `phones.codesNote` | कोड एक ही बार दिखते हैं। आपके ऑपरेटर के छापे हुए कोड बंद हो जाते हैं। | The codes show once. The codes your Operator printed stop working. |  |
| `phones.codesTitle` | आपके रिकवरी कोड | Your recovery codes |  |
| `phones.codesShow` | इन्हें लिख लीजिए और सँभालकर रखिए। हर कोड एक बार चलता है, और ये दोबारा नहीं दिखाए जाते। आपके ऑपरेटर के छापे हुए कोड अब नहीं चलेंगे। | Write these down and keep them safe. Each works once, and they are never shown again. The codes your Operator printed no longer work. |  |
| `phones.needPasskey` | कोड बनाने या फ़ोन जोड़ने के लिए साइन आउट करके अपने फ़ोन के फ़िंगरप्रिंट या स्क्रीन लॉक से फिर साइन इन कीजिए। | To make codes or add a phone, sign out and sign in again with your phone's fingerprint or screen lock. |  |
| `phones.back` | अपनी दुकान पर वापस | Back to your shop |  |
| `phones.onePhone` | अभी सिर्फ़ एक फ़ोन आपकी दुकान खोल सकता है। | Only one phone can open your shop now. |  |
| `phones.noPhones` | अभी कोई फ़ोन आपकी दुकान नहीं खोल सकता। अपने रिकवरी कोड इस्तेमाल कीजिए, या अपने ऑपरेटर से कहिए। | No phone can open your shop now. Use your recovery codes, or ask your Operator. |  |
| `phones.bannerNew` | 19 Nov, 3:42 pm को एक नया फ़ोन जोड़ा गया (Android, Chrome)। आपने नहीं जोड़ा? उसे हटा दीजिए। | A new phone was added on 19 Nov, 3:42 pm (Android, Chrome). Not you? Remove it. |  |
| `phones.itWasMe` | मैंने ही जोड़ा | It was me |  |
| `phones.removeIt` | हटाइए | Remove it |  |
| `phones.bannerRequest` | Divya ने आपकी दुकान खोलने वाले हर फ़ोन को हटाने को कहा है। आप रद्द न करें तो यह 21 Nov, 10:00 am को हो जाएगा। | Divya asked to remove every phone that can open your shop. It will happen on 21 Nov, 10:00 am unless you cancel. |  |
| `phones.cancel` | अनुरोध रद्द करें | Cancel the request |  |
| `phones.cancelled` | रद्द हो गया। आपके फ़ोन बने रहेंगे। | Cancelled. Your phones stay. |  |
| `phones.bannerCodes` | अपने कोड अभी बनाइए, ताकि वे सिर्फ़ आपके पास रहें। | Make your own codes now, so only you hold them. |  |
| `phones.makeCodes` | मेरे कोड बनाएँ | Make my codes |  |
| `phones.refused` | यह नहीं हो पाया। साइन आउट करके अपने फ़ोन के फ़िंगरप्रिंट से साइन इन कीजिए और फिर कोशिश कीजिए। | That did not work. Sign out, sign in with your phone's fingerprint and try again. |  |
| `phones.operator` | आपके ऑपरेटर | Your Operator |  |
| `phones.openPhones` | आपके फ़ोन | Your phones |  |
| `phones.lostHelp` | हर फ़ोन और अपने कोड खो दिए, या आपका ऑपरेटर मदद नहीं कर रहा? hello@geometer.dev पर लिखिए। | Lost every phone and your codes, or your Operator will not help? Write to hello@geometer.dev. |  |
| `phones.alert.newPhone` | आपकी दुकान में 19 नव॰, 3:42 pm को एक नया फ़ोन जोड़ा गया (Android, Chrome)। आपने नहीं जोड़ा? अपना ऐप खोलकर इसे हटाइए। | A new phone was added to your shop on 19 Nov, 3:42 pm (Android, Chrome). Not you? Open your app and remove it. |  |
| `phones.alert.request` | Divya ने आपकी दुकान खोलने वाले हर फ़ोन को हटाने को कहा है। आप रद्द न करें तो यह 2 दिन में हो जाएगा। रोकने के लिए अपना ऐप खोलिए। | Divya asked to remove every phone that opens your shop. It happens in 2 days unless you cancel. Open your app to stop it. |  |
| `phones.via.own_code` | आपके अपने रिकवरी कोड से | with your own recovery code |  |
| `phones.labelNote` | ये नाम वही हैं जो हर फ़ोन ने जुड़ते समय अपने बारे में बताए। | The names are what each phone said about itself when it was added. |  |
| `phones.bannerOwner` | इस दुकान के लिए मालिक का नंबर बदला गया है। आप रद्द न करें तो दुकान खोलने वाले सारे फ़ोन 21 Nov, 10:00 am को बंद हो जाएँगे। | The owner's number for this shop was changed. Every phone that opens your shop stops working on 21 Nov, 10:00 am unless you cancel. |  |
| `phones.bannerCodesMade` | 19 Nov, 3:42 pm को नए रिकवरी कोड बनाए गए (Android, Chrome)। आपने नहीं बनाए? वह फ़ोन हटा दीजिए। | New recovery codes were made on 19 Nov, 3:42 pm (Android, Chrome). Not you? Remove that phone. |  |
| `phones.bannerRemoved` | 19 Nov, 3:42 pm को एक फ़ोन हटाया गया (Android, Chrome)। | A phone was removed on 19 Nov, 3:42 pm (Android, Chrome). |  |
| `phones.alert.ownerChange` | आपकी दुकान के लिए मालिक का नंबर बदला गया है। आप रद्द न करें तो आपकी दुकान खोलने वाले सारे फ़ोन 2 दिन में बंद हो जाएँगे। रोकने के लिए अपना ऐप खोलिए। | The owner's number for your shop was changed. Every phone that opens your shop stops working in 2 days unless you cancel. Open your app to stop it. |  |
| `phones.alert.codes` | 19 नव॰, 3:42 pm को नए रिकवरी कोड बनाए गए (Android, Chrome)। आपने नहीं बनाए? अपना ऐप खोलकर वह फ़ोन हटाइए। | New recovery codes were made on 19 Nov, 3:42 pm (Android, Chrome). Not you? Open your app and remove that phone. |  |
| `phones.alert.removed` | 19 नव॰, 3:42 pm को आपकी दुकान के साइन-इन से एक फ़ोन हटाया गया (Android, Chrome)। आपने नहीं हटाया? अपना ऐप खोलिए। | A phone was removed from your shop's sign-in on 19 Nov, 3:42 pm (Android, Chrome). Not you? Open your app. |  |
