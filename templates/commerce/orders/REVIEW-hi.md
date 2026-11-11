# Review sheet: Hindi (hi), Orders

> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**

Every line below is what the Orders agent says or understands in Hindi. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Annapurna Tiffins' (a made-up tiffin service): 2 × veg thali, a total of ₹240, an advance of ₹120.

What to look for first: (1) is each message polite, short and something a food shop would really send; (2) are "advance", "pickup", "delivery", "cut-off", "refund" and "owner" the words people use; (3) is the owner's "approve" / "deny" / "received" left in Latin letters, as the owner types it.

Amounts are always written as ₹1,200 with Western digits; items, quantities, days, times, places and links are filled in from the shop's record, never translated.

## 1. Messages to the customer (53)

| Template id | When it is sent | Text (Hindi) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `menu` | A first hello, or a greeting: the menu with its prices, and the list of items to pick from | नमस्ते! Annapurna Tiffins में आपका स्वागत है। हमारा मेन्यू: वेज थाली ₹120, चिकन मील ₹160, दही ₹20। बताइए आपको क्या चाहिए, कितना, किस दिन, और पिकअप या डिलीवरी। | Hello! Welcome to Annapurna Tiffins. Our menu: veg thali ₹120, chicken meal ₹160, curd ₹20. Tell me what you would like, how many, which day, and pickup or delivery. |  |
| `pick_items` | The words above the list of items | नमस्ते! Annapurna Tiffins में आपका स्वागत है। आप क्या ऑर्डर करना चाहेंगे? | Hello! Welcome to Annapurna Tiffins. What would you like to order? |  |
| `ask_when` | The order has items but no day: which day | आपका 2 × वेज थाली किस दिन के लिए चाहिए? | Which day would you like your 2 × veg thali for? |  |
| `ask_how` | The order has no way yet, and the shop delivers: pickup or delivery (two buttons) | आप खुद लेने आएँगे, या डिलीवरी चाहिए? | Would you like to pick it up, or have it delivered? |  |
| `ask_slot` | The order has a day but no slot: pick a time from the list of slots still open | गुरुवार, 12 नवंबर को किस समय? नीचे से समय चुनिए, या अपना पसंदीदा समय लिखिए। | Which time on Thu 12 Nov? Pick a slot below, or write the time you prefer. |  |
| `ask_address` | A delivery order: where to deliver, and the places the shop delivers to | डिलीवरी कहाँ करनी है? कृपया अपना इलाका और पूरा पता लिखिए। हम यहाँ डिलीवरी करते हैं: Kakkanad, Edappally, Infopark। | Where should we deliver? Please write your area and full address. We deliver to: Kakkanad, Edappally, Infopark. |  |
| `confirm_details` | The customer wrote a weekday: the full date is read back, and they say yes | पक्का करने के लिए: 2 × वेज थाली, गुरुवार, 12 नवंबर। आगे बढ़ने के लिए "हाँ" लिखें। | Just to be sure: 2 × veg thali on Thu 12 Nov. Reply "yes" to continue. |  |
| `confirm_buttons` | The words above the Yes / No buttons of that read-back | पक्का करने के लिए: 2 × वेज थाली, गुरुवार, 12 नवंबर। क्या यह सही है? | Just to be sure: 2 × veg thali on Thu 12 Nov. Is that right? |  |
| `price_floor` | The customer asked for a lower price: the menu price, and no lower | हमारा वेज थाली ₹120 का है, इससे कम में नहीं हो पाएगा। | Our veg thali is ₹120, and I can't go lower than that. |  |
| `too_many_items` | One order has more items than the shop allows | माफ़ कीजिए, एक ऑर्डर में ज़्यादा से ज़्यादा 10 चीज़ें हो सकती हैं। कृपया छोटा ऑर्डर भेजिए, या मालिक से बात कीजिए। | Sorry, one order can have at most 10 items. Please send a smaller order, or talk to the owner. |  |
| `out_of_stock` | More of an item than is left for the day: how many are left | माफ़ कीजिए, गुरुवार, 12 नवंबर के लिए वेज थाली सिर्फ़ 3 बचे हैं। कृपया ऑर्डर बदलिए, या कोई और दिन चुनिए। | Sorry, only 3 veg thali left for Thu 12 Nov. Please change the order, or pick another day. |  |
| `sold_out` | An item is sold out for the day | माफ़ कीजिए, गुरुवार, 12 नवंबर के लिए वेज थाली ख़त्म हो चुका है। कृपया कुछ और चुनिए, या कोई और दिन। | Sorry, veg thali is sold out for Thu 12 Nov. Please pick something else, or another day. |  |
| `day_full` | The shop takes no more orders for that day | माफ़ कीजिए, गुरुवार, 12 नवंबर के लिए अब और ऑर्डर नहीं ले सकते। कृपया कोई और दिन चुनिए। | Sorry, we cannot take any more orders for Thu 12 Nov. Please pick another day. |  |
| `after_cutoff` | Orders for that day and slot have closed: when they closed | माफ़ कीजिए, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक के ऑर्डर बुधवार, 11 नवंबर, रात 8:00 बजे पर बंद हो गए। कृपया कोई और दिन या समय चुनिए। | Sorry, orders for Thu 12 Nov, 12:00 pm to 1:00 pm closed at Wed 11 Nov, 8:00 pm. Please pick another day or time. |  |
| `outside_area` | A delivery address names no place on the shop's list: the places it delivers to | माफ़ कीजिए, हम उस पते पर डिलीवरी नहीं करते। हम यहाँ डिलीवरी करते हैं: Kakkanad, Edappally, Infopark। आप खुद आकर ले जा सकते हैं। | Sorry, we do not deliver to that address. We deliver to: Kakkanad, Edappally, Infopark. You can pick up instead. |  |
| `quote_and_link` | The order is held: the items, the day and slot, the total, the advance and the payment link (UPI: with the UPI ID, and the owner confirms) | 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप। कुल ₹240। पक्का करने के लिए ₹120 यहाँ भेजें: https://rzp.io/i/example (आपका ऑर्डर 30 मिनट के लिए रोका गया है।) | 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: https://rzp.io/i/example (I'll hold your order for 30 minutes.) |  |
| `already_waiting` | The customer writes again while an order is held: the same link, not a second order | आपका ऑर्डर (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) रोका हुआ है। पक्का करने के लिए ₹120 भेजें: https://rzp.io/i/example | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is held. Pay ₹120 to confirm: https://rzp.io/i/example |  |
| `link_failed` | The payment link could not be made: nothing is ordered, the owner is told | माफ़ कीजिए, अभी पेमेंट लिंक नहीं बन पाया, इसलिए कुछ भी ऑर्डर नहीं हुआ है। मैंने मालिक को बता दिया है। कृपया कुछ मिनट बाद फिर कोशिश करें। | Sorry, I couldn't create the payment link just now, so nothing is ordered. I've told the owner. Please try again in a few minutes. |  |
| `order_confirmed` | The payment record shows the advance (Razorpay): the order is confirmed, what is left to pay and the cancellation rule | ऑर्डर पक्का! 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप। हमें आपका ₹120 का एडवांस मिल गया है। ₹120 पिकअप पर देने हैं। रिफंड के लिए शुरू होने से कम से कम 6 घंटे पहले रद्द करें। | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. We have received your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `hold_expired` | The hold ended before the advance was recorded | आपके ऑर्डर (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) की रोक खत्म हो गई क्योंकि एडवांस समय पर नहीं मिला। अब भी ऑर्डर करना चाहें तो मुझे लिखें। | The hold on your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) has ended because the advance was not received in time. Message me if you'd still like to order. |  |
| `stock_gone_refund` | A payment arrived after the hold ended and the stock is gone: it is refunded | आपका ₹120 का भुगतान ऑर्डर की रोक खत्म होने के बाद आया, और गुरुवार, 12 नवंबर के लिए 2 × वेज थाली अब उपलब्ध नहीं है। ₹120 आपको वापस किया जा रहा है। | Your payment of ₹120 arrived after the hold on your order ended, and 2 × veg thali for Thu 12 Nov is no longer available. ₹120 is being refunded to you. |  |
| `cutoff_passed_refund` | A payment arrived after the hold ended and orders have closed: it is refunded | आपका ₹120 का भुगतान ऑर्डर की रोक खत्म होने के बाद आया, और गुरुवार, 12 नवंबर के ऑर्डर बंद हो चुके हैं (बुधवार, 11 नवंबर, रात 8:00 बजे)। ₹120 आपको वापस किया जा रहा है। | Your payment of ₹120 arrived after the hold on your order ended, and orders for Thu 12 Nov have closed (Wed 11 Nov, 8:00 pm). ₹120 is being refunded to you. |  |
| `refund_unused` | A payment arrived for an order that is no longer active: it is refunded | आपका ₹120 का भुगतान आया, लेकिन इसके लिए कोई चालू ऑर्डर नहीं है। ₹120 आपको वापस किया जा रहा है। | Your payment of ₹120 arrived, but there is no active order for it. ₹120 is being refunded to you. |  |
| `duplicate_refund` | The advance was paid twice: the extra is refunded | आपने एडवांस दो बार भर दिया। अतिरिक्त ₹120 वापस किया जा रहा है। | You paid the advance twice. The extra ₹120 is being refunded. |  |
| `duplicate_refund_pending` | The advance was paid twice and the extra is above the refund limit: waiting for the owner | आपने एडवांस दो बार भर दिया। अतिरिक्त ₹120 मालिक की मंज़ूरी के बाद वापस किया जाएगा। | You paid the advance twice. The extra ₹120 will be refunded once the owner approves. |  |
| `cancelled_refund` | A cancellation inside the window: the advance is refunded | गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का आपका ऑर्डर रद्द हो गया है। आपका ₹120 एडवांस वापस किया जा रहा है। | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. Your ₹120 advance is being refunded. |  |
| `cancelled_refund_pending` | A cancellation inside the window with a refund above the limit: waiting for the owner | गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का आपका ऑर्डर रद्द हो गया है। आपके ₹120 के रिफंड की पुष्टि मालिक जल्द करेंगे। | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will confirm your ₹120 refund shortly. |  |
| `cancelled_late` | A cancellation outside the window: the owner decides about the advance | गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का आपका ऑर्डर रद्द हो गया है। यह शुरू होने से 6 घंटे से कम पहले है, इसलिए आपके ₹120 एडवांस पर मालिक फ़ैसला करेंगे और आपको बताएँगे। | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. As it is less than 6 hours before the start, the owner will decide about your ₹120 advance and message you. |  |
| `cancelled_no_advance` | An order cancelled before anything was paid | गुरुवार, 12 नवंबर का आपका ऑर्डर रद्द हो गया है। कोई शुल्क नहीं लिया गया। | Your order for Thu 12 Nov is cancelled. Nothing was charged. |  |
| `cancelled_draft` | An order dropped before it had a day | ठीक है, मैंने वह ऑर्डर छोड़ दिया है। कोई शुल्क नहीं लिया गया। | Okay, I have dropped that order. Nothing was charged. |  |
| `no_order_found` | The customer asked to change or cancel and has no order | मुझे बदलने के लिए कोई ऑर्डर नहीं मिला। बताइए क्या चाहिए, कितना और किस दिन, मैं ऑर्डर बना दूँगा। | I couldn't find an order to change. Tell me what you'd like, how many and which day, and I'll set it up. |  |
| `refund_approved` | The owner approved the refund | मालिक ने आपके रिफंड को मंज़ूरी दे दी है। ₹120 आपको वापस भेजा जा रहा है। | The owner approved your refund. ₹120 is on its way. |  |
| `refund_denied` | The owner said no to the refund | मालिक ने ₹120 का एडवांस वापस न करने का फ़ैसला किया है। | The owner has decided not to refund the ₹120 advance. |  |
| `refund_checking` | A refund could not be sent yet: it is being checked | आपके ₹120 के रिफंड की जाँच हो रही है। पुष्टि होते ही मैं आपको संदेश भेजूँगा। | We are checking your ₹120 refund and will message you as soon as it is confirmed. |  |
| `refund_expired` | The owner did not answer a refund request in time: nothing was sent | मालिक ने समय पर आपके ₹120 के रिफंड पर जवाब नहीं दिया, इसलिए वह अभी नहीं भेजा गया है। कृपया Annapurna Tiffins से सीधे संपर्क करें। | The owner did not answer in time about your ₹120 refund, so it has not been sent. Please contact Annapurna Tiffins directly. |  |
| `big_order_asked` | A big order (above the owner's line) waits for the owner | आपका ऑर्डर (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) बड़ा है, इसलिए मैंने मालिक से मंज़ूरी माँगी है। जवाब यहीं मिलेगा। | Your order (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) is a big one, so I have asked the owner to approve it. You will hear back here. |  |
| `big_order_denied` | The owner said no to a big order | माफ़ कीजिए, मालिक गुरुवार, 12 नवंबर का आपका ऑर्डर नहीं ले पाएँगे। कोई शुल्क नहीं लिया गया। | Sorry, the owner cannot take your order for Thu 12 Nov. Nothing was charged. |  |
| `didnt_understand` | The message was not understood | माफ़ कीजिए, मैं समझ नहीं पाया। कृपया बताइए क्या ऑर्डर करना है, कितना और किस दिन। | Sorry, I didn't understand. Please tell me what you would like to order, how many, and which day. |  |
| `voice_note` | A voice note: it cannot be listened to yet, so they are asked to type | कृपया अपना संदेश लिखकर भेजिए; मैं अभी वॉइस नोट नहीं सुन सकता। | Please type your message; I can't listen to voice notes yet. |  |
| `ask_cancel` | The customer tapped Cancel order: are you sure (Yes / No buttons) | क्या आप गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का अपना ऑर्डर रद्द करना चाहते हैं? | Do you want to cancel your order for Thu 12 Nov, 12:00 pm to 1:00 pm? |  |
| `kept` | The customer said no to cancelling: the order stays | ठीक है, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का आपका ऑर्डर जैसा है वैसा ही रहेगा। | Okay, your order for Thu 12 Nov, 12:00 pm to 1:00 pm stays as it is. |  |
| `told_owner` | The customer tapped Talk to the owner: the owner has been asked to message them | मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे यहीं आपको संदेश भेजेंगे। | I've told the owner that you would like to talk. They will message you here. |  |
| `couldnt_tell_owner` | The owner could not be told just now | माफ़ कीजिए, अभी मालिक तक बात नहीं पहुँच पाई। कृपया कुछ मिनट बाद फिर कोशिश करें। | Sorry, I couldn't reach the owner just now. Please try again in a few minutes. |  |
| `upi_order_confirmed` | UPI shop: the owner marked the advance received: the order is confirmed | ऑर्डर पक्का! 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप। मालिक ने आपका ₹120 का एडवांस पक्का कर दिया है। ₹120 पिकअप पर देने हैं। रिफंड के लिए शुरू होने से कम से कम 6 घंटे पहले रद्द करें। | Confirmed! 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. The owner has confirmed your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund. |  |
| `upi_qr_caption` | UPI shop: the words under the QR picture | ऑर्डर o-3 के लिए Annapurna Tiffins को UPI से ₹120 भेजने के लिए स्कैन करें। | Scan to pay ₹120 by UPI to Annapurna Tiffins for order o-3. |  |
| `upi_paid_claim` | UPI shop: the customer says they paid or sends a screenshot (nothing is marked paid) | धन्यवाद। मालिक अपने UPI ऐप में आपका ₹120 देखकर पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा। स्क्रीनशॉट पेमेंट का सबूत नहीं है, इसलिए कृपया उस संदेश का इंतज़ार करें। | Thank you. The owner will look for your ₹120 payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message. |  |
| `upi_nothing_waiting` | UPI shop: the customer says they paid and no advance is waiting | धन्यवाद। अभी आपका कोई UPI पेमेंट बाकी नहीं है, इसलिए मालिक के पास पक्का करने को कुछ नहीं है। अगर आपने किसी और चीज़ के लिए पैसे भेजे हैं, तो कृपया मालिक से बात करें। | Thank you. No UPI payment is waiting for you just now, so there is nothing for the owner to confirm. If you paid for something else, please talk to the owner. |  |
| `upi_late_received` | UPI shop: the owner marked the advance after the hold ended: the order is not confirmed | मालिक ने आपका ₹120 पेमेंट गुरुवार, 12 नवंबर के ऑर्डर की रोक खत्म होने के बाद पक्का किया, इसलिए ऑर्डर पक्का नहीं हुआ है। मालिक आपसे दोबारा ऑर्डर या पैसे वापस भेजने के बारे में बात करेंगे। | The owner confirmed your ₹120 payment after the hold on your order for Thu 12 Nov had ended, so the order is not confirmed. The owner will contact you about ordering again or sending the money back. |  |
| `upi_refund_owed` | UPI shop: a refund the owner will send (the agent never sends it) | मालिक ₹120 UPI से आपको वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा। | The owner will send ₹120 back to you by UPI. I'll message you when they mark it sent. |  |
| `upi_cancelled_refund_owed` | UPI shop: a cancellation inside the window: the owner will send the refund | गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक का आपका ऑर्डर रद्द हो गया है। मालिक आपका ₹120 UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा। | Your order for Thu 12 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will send your ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_extra_refund_owed` | UPI shop: the owner marked more than the advance: the owner will send the extra back | आपने एडवांस से ज़्यादा पैसे भेजे हैं। मालिक ज़्यादा भेजे गए ₹120 UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा। | You paid more than the advance. The owner will send the extra ₹120 back to you by UPI, and I'll message you when they mark it sent. |  |
| `upi_refund_sent` | UPI shop: the owner marked the refund sent (only then is the customer told) | मालिक ने ऑर्डर o-3 का आपका ₹120 रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें। | The owner has marked your ₹120 refund for order o-3 as sent by UPI. Please check your UPI app. |  |
| `orders_paused` | The shop's licence is in its wind-down: the answer to a customer who asks to order. No order, no link, nothing kept for later | ऑनलाइन ऑर्डर अभी रुके हुए हैं। कृपया सीधे Annapurna Tiffins से संपर्क करें। | Online ordering is paused for now. Please contact Annapurna Tiffins directly. |  |

## 2. Messages to the owner (37)

Most owner messages are also WhatsApp templates, because they are sent by the agent on its own and WhatsApp then carries only an approved template. Meta approves the wording once, so the wording here is what is submitted.

| Template id | When it is sent | Text (Hindi) | Meaning (the English template) | Native reviewer: OK / change to … |
| --- | --- | --- | --- | --- |
| `owner_order_confirmed` | A pickup order was confirmed: what to prepare, for when, the total, the advance and what to collect | नया ऑर्डर o-3, ग्राहक +919811111111: 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप। कुल ₹240, एडवांस ₹120 मिल चुका, ₹120 लेने हैं। अभी कुछ करना बाकी नहीं है। | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_delivery_confirmed` | A delivery order was confirmed: the same, with the address the customer wrote | नया ऑर्डर o-3, ग्राहक +919811111111: 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप, पता: Flat 4, Lake View Apartments, Kakkanad। कुल ₹240, एडवांस ₹120 मिल चुका, ₹120 लेने हैं। अभी कुछ करना बाकी नहीं है। | New order o-3 from +919811111111: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup, address: Flat 4, Lake View Apartments, Kakkanad. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now. |  |
| `owner_big_order` | An order above the owner's line: approve or deny, with the order's reference | मंज़ूरी चाहिए: +919811111111 को 2 × वेज थाली चाहिए, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक, पिकअप। कुल ₹240। भुगतान की अनुमति के लिए "approve o-3" या मना करने के लिए "deny o-3" लिखें। | Approval needed: +919811111111 wants 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. Reply "approve o-3" to let them pay, or "deny o-3". |  |
| `owner_order_cancelled` | A confirmed order was cancelled: do not prepare it | ग्राहक +919811111111 ने ऑर्डर o-3 रद्द किया: 2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक। कृपया इसे तैयार न करें। | Customer +919811111111 cancelled order o-3: 2 × veg thali for Thu 12 Nov, 12:00 pm to 1:00 pm. Please do not prepare it. |  |
| `owner_late_cancellation` | A cancellation outside the window: approve (refund) or deny (keep), with the order's reference | ग्राहक +919811111111 ने ऑर्डर o-3 (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) शुरू होने से 6 घंटे से कम पहले रद्द किया। एडवांस ₹120। लौटाने के लिए "approve o-3" या रखने के लिए "deny o-3" लिखें। | Customer +919811111111 cancelled order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm) less than 6 hours before the start. Advance ₹120. Reply "approve o-3" to refund it or "deny o-3" to keep it. |  |
| `owner_duplicate_payment` | The advance was paid twice: the extra was refunded | ग्राहक +919811111111 ने ऑर्डर o-3 (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) का एडवांस दो बार भरा। अतिरिक्त ₹120 वापस कर दिया गया। | Customer +919811111111 paid the advance twice for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). The extra ₹120 was refunded. |  |
| `owner_payment_unused` | A payment arrived for an order that could not be taken: it was refunded | ग्राहक +919811111111 का ₹120 का भुगतान ऑर्डर o-3 (गुरुवार, 12 नवंबर) के लिए आया, पर वह ऑर्डर अब चालू नहीं था (रोक खत्म हो चुकी थी और दोबारा नहीं लिया जा सका, या रद्द था)। ₹120 वापस कर दिया गया। | A ₹120 payment from +919811111111 arrived for order o-3 (Thu 12 Nov), but it was no longer active (its hold had ended and it could not be taken again, or it was cancelled). ₹120 was refunded. |  |
| `owner_link_failed` | The payment link for an order could not be made | ग्राहक +919811111111 के ऑर्डर o-3 के लिए पेमेंट लिंक नहीं बन पाया। कुछ भी ऑर्डर नहीं हुआ है। कृपया अपना पेमेंट अकाउंट देखें। | Could not make the payment link for order o-3 from +919811111111. Nothing is ordered. Please check your payment account. |  |
| `owner_message_held` | A message was held back because it did not match the order record | ग्राहक +919811111111 को भेजा जाने वाला एक संदेश रोक दिया गया क्योंकि वह ऑर्डर रिकॉर्ड से मेल नहीं खाता था। कुछ भी नहीं भेजा गया। | A message to +919811111111 was held back because it did not match the order record. Nothing was sent. |  |
| `owner_opted_out` | A customer sent STOP | ग्राहक +919811111111 ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा। | Customer +919811111111 sent STOP. No more messages will go to them. |  |
| `owner_unknown_command` | The owner's reply was not approve or deny | मैं समझ नहीं पाया। "approve" या "deny" लिखिए और उसके बाद ऑर्डर नंबर। | I didn't understand that. Reply "approve" or "deny" followed by the order reference. |  |
| `owner_wants_to_talk` | A customer tapped Talk to the owner (at most once an hour for the same customer) | ग्राहक +919811111111 आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें। | Customer +919811111111 would like to talk to you. Please message them. |  |
| `owner_ai_allowance` | Button mode, told once a month: the shop's monthly AI allowance is used up | सूचना: Annapurna Tiffins का इस महीने का AI कोटा खत्म हो गया है, इसलिए एजेंट अब बटन और सूचियों से जवाब देगा। ऑर्डर फिर भी लिए जाएँगे, और हर सीमा पहले की तरह लागू रहेगी। इसे सेट करने वाले को बता दिया गया है। सामान्य सेवा अगले महीने लौटेगी। | Notice: this month's AI allowance for Annapurna Tiffins is used up, so the agent now answers with buttons and lists. It still takes orders, and every limit still holds. The person who set it up has been told. Normal service returns next month. |  |
| `owner_ai_off` | Button mode, told once: the AI was switched off from outside | सूचना: Annapurna Tiffins के संदेश पढ़ने वाला AI अभी बंद कर दिया गया है। एजेंट बटन और सूचियों से ऑर्डर लेता रहेगा, और हर सीमा पहले की तरह लागू रहेगी। इसे सेट करने वाले को बता दिया गया है। | Notice: the AI that reads messages for Annapurna Tiffins has been switched off for now. The agent keeps taking orders with buttons and lists, and every limit still holds. The person who set it up has been told. |  |
| `owner_ai_fault` | Button mode, told at most once a day: a model did not answer, so buttons are used for a few minutes | सूचना: Annapurna Tiffins के संदेश पढ़ने वाला AI अभी जवाब नहीं दे रहा, इसलिए एजेंट बटन और सूचियाँ इस्तेमाल कर रहा है। ऑर्डर फिर भी लिए जाएँगे, और हर सीमा पहले की तरह लागू रहेगी। कुछ मिनट बाद एजेंट AI को फिर आज़माएगा। | Notice: the AI that reads messages for Annapurna Tiffins is not answering right now, so the agent is using buttons and lists. It still takes orders, and every limit still holds. It will try the AI again in a few minutes. |  |
| `owner_refund_needs_approval` | A refund above the limit waits for the owner's one-use code (sent by the approvals relay, never by the agent) | मंज़ूरी चाहिए: +919811111111 (ऑर्डर o-3, गुरुवार, 12 नवंबर) को ₹120 का रिफंड। 24 घंटे के भीतर "approve K7M2QX" या "deny K7M2QX" लिखकर भेजें। | Approval needed: refund ₹120 for +919811111111 (order o-3, Thu 12 Nov). Reply "approve K7M2QX" or "deny K7M2QX" within 24 hours. |  |
| `owner_approval_done` | The owner approved with the code: the refund is being sent | धन्यवाद। +919811111111 का ₹120 रिफंड भेजा जा रहा है, और उन्हें बता दिया जाएगा। | Thank you. The ₹120 refund for +919811111111 is being sent, and they will be told. |  |
| `owner_approval_denied` | The owner denied with the code: nothing is sent | समझ गया। +919811111111 का ₹120 रिफंड नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा। | Understood. The ₹120 refund for +919811111111 will not be sent, and they will be told. |  |
| `owner_approval_expired` | The owner answered after the request had run out: nothing was refunded | आपके जवाब देने से पहले ही वह अनुरोध खत्म हो गया, इसलिए कुछ वापस नहीं किया गया: +919811111111, ₹120। | That request ran out before you answered, so nothing was refunded: ₹120 for +919811111111. |  |
| `owner_approval_failed` | The owner's answer could not be recorded just now: send it again | मैं अभी आपका जवाब दर्ज नहीं कर पाया। कृपया कुछ मिनट बाद फिर भेजें। | I could not record your answer just now. Please send it again in a few minutes. |  |
| `owner_approval_waiting` | A refund needs several people: this person's approval is in and more are needed | धन्यवाद। +919811111111 के ₹120 के रिफंड पर आपकी मंज़ूरी दर्ज हो गई है। दूसरों से अभी इतनी मंज़ूरी और चाहिए: 1। वे मिलने पर ही रिफंड भेजा जाएगा। | Thank you. Your approval of the ₹120 refund for +919811111111 is recorded. Approvals still needed from the others: 1. It is sent only once they are given. |  |
| `owner_approval_closed` | A refund needs several people: the others approved it, so this person's answer is no longer needed | सूचना: +919811111111 के ₹120 के रिफंड को दूसरों ने मंज़ूरी दे दी है, इसलिए अब आपके जवाब की ज़रूरत नहीं है। धन्यवाद। | The ₹120 refund for +919811111111 has been approved by the others, so your answer is no longer needed. Thank you. |  |
| `owner_approval_refused` | A refund needs several people: one of them refused it, so it is not sent | सूचना: +919811111111 के ₹120 के रिफंड को मंज़ूरी देने वालों में से एक ने मना कर दिया है, इसलिए यह नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा। | The ₹120 refund for +919811111111 was refused by one of the people who approve refunds, so it will not be sent, and they will be told. |  |
| `owner_refund_settled` | A person at the server checked an uncertain refund and marked it as made: it is done and not sent again | रिफंड हो गया: +919811111111 को ₹120। आपका एजेंट सेट करने वाले व्यक्ति ने इसे जाँचकर पूरा हुआ दर्ज किया है, इसलिए यह दोबारा नहीं भेजा जाएगा। | Refund done: ₹120 for +919811111111. The person who set up your agent checked it and marked it as made, so it is not sent a second time. |  |
| `owner_upi_expected` | UPI shop: tells the owner what payment to look for in their UPI app, with the one-use code | जाँचने के लिए UPI पेमेंट: ग्राहक +919811111111 ऑर्डर o-3 (2 × वेज थाली, गुरुवार, 12 नवंबर, दोपहर 12:00 बजे से दोपहर 1:00 बजे तक) के लिए ₹120 एडवांस भेजेंगे। जब यह आपके UPI ऐप में दिखे, तो "मिल गया" दबाएँ या "received P4XR9T" लिखकर भेजें। अगर कोई और रकम आई है, तो "received P4XR9T" के बाद रकम लिखें। | UPI payment to check: customer +919811111111 will pay the ₹120 advance for order o-3 (2 × veg thali, Thu 12 Nov, 12:00 pm to 1:00 pm). When it shows in your UPI app, tap Received or reply "received P4XR9T". If a different amount came, reply "received P4XR9T" and the amount. |  |
| `owner_upi_claim` | UPI shop: the customer says they paid (a screenshot is not proof): the owner is asked to look | ग्राहक +919811111111 कह रहे हैं कि उन्होंने ऑर्डर o-3 का ₹120 एडवांस भेज दिया है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। पैसे दिखें तो "मिल गया" दबाएँ या "received P4XR9T" लिखकर भेजें। | Customer +919811111111 says they have paid the ₹120 advance for order o-3. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received P4XR9T". |  |
| `owner_upi_marked` | UPI shop: the answer to the owner's Received, the order confirmed | धन्यवाद। ऑर्डर o-3 के ₹120 आपने मिला हुआ दर्ज किया है। | Thank you. ₹120 for order o-3 is marked paid by you. |  |
| `owner_upi_part` | UPI shop: the answer to the owner's Received, part paid, with the code for the rest | आपने ऑर्डर o-3 के लिए ₹120 दर्ज किया, पर एडवांस ₹120 है, इसलिए ऑर्डर अभी पक्का नहीं हुआ। रोक का समय खत्म होने तक ऑर्डर रुका रहेगा। बाकी ₹100 आने पर "मिल गया" दबाएँ या "received P4XR9T" लिखकर भेजें। | You marked ₹120 for order o-3, but the advance is ₹120, so it is not confirmed yet. The order stays held until the hold ends. When the other ₹100 arrives, tap Received or reply "received P4XR9T". |  |
| `owner_upi_already` | UPI shop: the owner used a code that was already used: counted once | यह पेमेंट पहले ही दर्ज है। इसे एक ही बार गिना गया है। | That payment is already marked. It is counted once. |  |
| `owner_upi_unknown` | UPI shop: the owner used a code the agent never gave | मैं यह कोड नहीं पहचानता। कृपया उस पेमेंट के बारे में मेरे सबसे नए संदेश वाला कोड इस्तेमाल करें। | I don't know that code. Please use the code in my latest message about the payment. |  |
| `owner_upi_late` | UPI shop: the owner marked the advance after the hold ended: take the order by hand or send the money back | आपने ऑर्डर o-3 के ₹120 उसकी रोक खत्म होने के बाद दर्ज किए, इसलिए ऑर्डर अपने-आप दोबारा पक्का नहीं हुआ। ग्राहक +919811111111 का ऑर्डर खुद दोबारा लें, या ₹120 UPI से वापस भेजें। फिर "रिफंड भेज दिया" या "ऑर्डर के लिए रखा" दबाएँ, या "refunded P4XR9T" या "kept P4XR9T" लिखकर भेजें। | You marked ₹120 received for order o-3 after its hold had ended, so it was not confirmed again by itself. Take customer +919811111111's order again yourself, or send the ₹120 back by UPI. Then tap Refund sent or Kept for order, or reply "refunded P4XR9T" or "kept P4XR9T". |  |
| `owner_upi_refund_owed` | UPI shop: a refund the owner must send from their UPI app, with the code | वापस भेजना है: ग्राहक +919811111111 (ऑर्डर o-3) को UPI से ₹120। एजेंट कभी पैसे नहीं भेजता। भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded P4XR9T" लिखकर भेजें। | Refund to send: customer +919811111111 (order o-3) is owed ₹120 by UPI. The agent never sends money. After you send it, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_reminder` | UPI shop: a reminder of a refund still owed (once a day, three times at most) | याद दिलाना: ग्राहक +919811111111 (ऑर्डर o-3) को ₹120 अभी भी वापस देना है। UPI से भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded P4XR9T" लिखकर भेजें। | Reminder: customer +919811111111 (order o-3) is still owed ₹120. After you send it by UPI, tap Refund sent or reply "refunded P4XR9T". |  |
| `owner_upi_refund_marked` | UPI shop: the answer to the owner's Refund sent | धन्यवाद। ऑर्डर o-3 का ₹120 रिफंड भेजा हुआ दर्ज हो गया है, और ग्राहक को बता दिया गया है। | Thank you. The ₹120 refund for order o-3 is marked sent, and the customer has been told. |  |
| `owner_upi_refund_kept` | UPI shop: the owner kept the money for an order they take by hand | ठीक है। ऑर्डर o-3 के ₹120 आपके खुद लिए गए ऑर्डर के लिए रखे गए हैं। अब कुछ वापस देना बाकी नहीं है। | Okay. The ₹120 for order o-3 is kept for an order you take by hand. Nothing more is owed back. |  |
| `owner_licence_paused` | The one notice to the owner when the licence winds down: online ordering is paused, who to contact. Never about money | सूचना: Annapurna Tiffins के ऑनलाइन ऑर्डर अभी रुके हुए हैं। पहले के ऑर्डर, रद्द करना और रिफंड पहले की तरह चलते रहेंगे। इस बारे में कृपया Divya, Sri Sai Digital से संपर्क करें। | Notice: online ordering for Annapurna Tiffins is paused for now. Existing orders, cancellations and refunds still go through. Please contact Divya, Sri Sai Digital. |  |
| `owner_licence_stopped` | The one notice to the owner at the licence's final stop: the partner's service has ended, what is still open, and that hello@geometer.dev will connect the owner with another local partner | सूचना: Annapurna Tiffins के ऑनलाइन ऑर्डर बंद हो गए हैं, क्योंकि Divya, Sri Sai Digital की सेवा समाप्त हो गई है। आने वाले ऑर्डर: 4। इसे किसी दूसरे स्थानीय पार्टनर के साथ जारी रखने के लिए hello@geometer.dev पर लिखें, Geometer आपको जोड़ देगा। | Notice: online ordering for Annapurna Tiffins has stopped, because the service from Divya, Sri Sai Digital has ended. Orders still to come: 4. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you. |  |

### The words on the buttons and the lists

Some of the messages above come with buttons (up to 3, each 20 letters at most) or a list that the customer taps instead of typing. A label never carries an amount or a date.

| Id | Text (Hindi) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `yes` | हाँ | Yes |  |
| `no` | नहीं | No |  |
| `owner` | मालिक से बात करें | Talk to the owner |  |
| `cancel` | ऑर्डर रद्द करें | Cancel order |  |
| `cancelYes` | हाँ, रद्द करें | Yes, cancel |  |
| `keep` | नहीं, रहने दें | No, keep it |  |
| `pickItem` | चीज़ चुनें | Pick an item |  |
| `pickTime` | समय चुनें | Pick a time |  |
| `pickup` | पिकअप | Pickup |  |
| `delivery` | डिलीवरी | Delivery |  |
| `paid` | मैंने पैसे भेजे | I have paid |  |
| `received` | मिल गया | Received |  |
| `refundSent` | रिफंड भेज दिया | Refund sent |  |
| `keptForBooking` | ऑर्डर के लिए रखा | Kept for order |  |

## 3. Dates as the agent writes them

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

Dates are written weekday, day, month ("गुरुवार, 12 नवंबर"); a time window is written "from … to …" with the part of the day before each time.

## 4. Item names in the example shop (Annapurna Tiffins)

| Item | Names in Hindi (the first is what the agent says; the rest are what customers may call it) | Native reviewer: OK / change to … |
| --- | --- | --- |
| veg thali | वेज थाली · थाली |  |
| chicken meal | चिकन मील · चिकन थाली |  |
| curd | दही |  |

## 5. What the agent understands from a customer

Words in Latin letters are how people type the language on WhatsApp. They are listed in one row, with the English ones, because the lists are shared by the languages.

| Meaning | English | Words and phrases (Hindi letters first, then the Latin letters people type it in) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| an order (words that mean the customer wants something) | order, want, need | ऑर्डर · चाहिए · मँगवाना · बुक — Latin letters: order · orders · want · need · get me · send · book · tiffin · i'd like · i would like · chahiye · chahie · bhej do · mangwana · venam · beku · bekittu |  |
| pickup | pickup, collect, take away | पिकअप · पिक अप · लेने आ · खुद ले — Latin letters: pickup · pick up · pick-up · collect · takeaway · take away · take-away · come and take · aake le · lene aunga · lene aaunga |  |
| delivery | delivery, deliver | डिलीवरी · डिलिवरी · पहुँचा · पहुंचा · घर पर — Latin letters: deliver · delivery · home delivery · send it to · bhej do · bhejna · pahuncha |  |
| I have paid (a claim; checked against the payment record, never believed on its own) | paid, I have paid | पेमेंट कर दिया · भुगतान कर दिया · पैसे भेज दिए · पैसे भेजे · भेज दिया · भर दिया · दे दिया · पे कर दिया — Latin letters: paid · i paid · i have paid · have paid · payment done · payment made · sent the money · money sent · transferred · paid it · advance paid · bhar diya · pay kar diya · payment kar diya · paid kar diya · de diya · paise bhej diye · adachu · payment cheythu · paid aanu · paavatisiddene · payment madide |  |
| money back | refund, money back | रिफंड · वापस — Latin letters: refund · refunded · money back · give back · return my money · get back my money · paise wapas · wapas |  |
| talk to the owner | owner, talk to | मालिक · बात करनी · बात करना · फोन करो — Latin letters: owner · talk to · call me · speak to · manager · malik |  |
| a quantity in words (one to ten in English and Hindi, one to five in Malayalam and Kannada) | one, two, three | एक · दो · तीन · चार · पाँच · पांच · छह · छः · सात · आठ · नौ · दस — Latin letters: one · two · three · four · five · six · seven · eight · nine · ten · ek · teen · char · chaar · paanch · panch · chhe · chhah · saat · aath · nau · das · onnu · randu · moonnu · munnu · naalu · anchu · ondu · eradu · mooru · naalku · aidu |  |

The shop's own item names and its slot names ("lunch", "dinner") are the shop's settings, written by the person who sets the shop up: they are not in this list.

### Whole sentences, and what the agent reads from them

| Customer writes | Meaning | The agent reads | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| कल 2 वेज थाली पिकअप | 2 veg thali tomorrow, pickup | order, items 2×veg-thali, pickup |  |
| वेज थाली डिलीवरी 12 nov | veg thali, delivery, 12 Nov | order, items 1×veg-thali, delivery |  |
| मैंने पेमेंट कर दिया | I have paid | paid |  |
| ऑर्डर रद्द करें | Cancel my order | cancel |  |
| मुझे मालिक से बात करनी है | I want to talk to the owner | owner |  |
| पैसे वापस चाहिए | I want my money back | refund |  |

## 6. The monthly report

The owner's monthly text is five short lines of "label: number". Every number, amount and date is counted from the record and written by the same formatters as the messages; only the words around them are below.

### The five lines, with sample numbers

```text
Annapurna Tiffins · फरवरी 2027 · अभ्यास वाले नकली सिस्टम, टेस्ट पैसा
मालिक द्वारा मिला हुआ दर्ज एडवांस: ₹24,000 · पिकअप पर लेना बाकी: ₹9,000 (ऑर्डर: 6) · मालिक द्वारा भेजा हुआ दर्ज रिफंड: ₹600
लिए गए ऑर्डर: 41 · रद्द हुए: 3 · आपसे पूछा गया: 3 · आपने मंज़ूर किया: 2 · आपने मना किया: 1
आपकी सीमाओं ने रोका: 7 (दिन के स्टॉक से ज़्यादा के ऑर्डर: 3 · कट-ऑफ़ के बाद के ऑर्डर: 2 · डिलीवरी क्षेत्र के बाहर के पते: 1 · …)
जाँचा नहीं गया: पिकअप पर नकद या UPI से दी गई बाकी रकम · भुगतान की अपने-आप जाँच (UPI में हर भुगतान आप दर्ज करते हैं) · असली WhatsApp · शब्दों की किसी मूल भाषी से जाँच · और 16 बातें (पूरी रिपोर्ट में)। जाँच हाथ से की गई।
```

### The monthly report on WhatsApp, with sample numbers

```text
मासिक रिपोर्ट: Annapurna Tiffins · फरवरी 2027
एडवांस जमा हुआ: ₹24,000 · वापस किया: ₹600 · पिकअप पर लेना बाकी: ₹9,000 (ऑर्डर: 6)
लिए गए ऑर्डर: 41 · रद्द हुए: 3
आपसे पूछा गया: 3 · आपने मंज़ूर किया: 2 · आपने मना किया: 1
आपकी सीमाओं ने रोका: 7
जाँचा नहीं गया: पिकअप पर नकद या UPI से दी गई बाकी रकम · भुगतान की अपने-आप जाँच (UPI में हर भुगतान आप दर्ज करते हैं) · असली WhatsApp · शब्दों की किसी मूल भाषी से जाँच · और 16 बातें (पूरी रिपोर्ट में)। जाँच हाथ से की गई।
कोड: 7K2M-9QXD · पूरी रिपोर्ट: https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-hi.html
सपोर्ट को लिखें। एक इंसान जवाब देता है।
तैयार किया: Divya, Sri Sai Digital · Geometer
★ इनोवेटर
```

### Every word and phrase of the report

| Id | Text (Hindi) | Meaning (English) | Native reviewer: OK / change to … |
| --- | --- | --- | --- |
| `agent` | ऑर्डर एजेंट | Orders agent |  |
| `monthlyReport` | मासिक रिपोर्ट | Monthly report |  |
| `goLiveCertificate` | चालू करने से पहले का जाँच प्रमाणपत्र | Go-live certificate |  |
| `fullReport` | पूरी रिपोर्ट | Full report |  |
| `helpLine` | सपोर्ट को लिखें। एक इंसान जवाब देता है। | Write to support. A person answers. |  |
| `promise` | भुगतान के रिकॉर्ड (या UPI में आपकी पुष्टि) के बिना कोई ऑर्डर पक्का नहीं; हर रिफंड का हिसाब। | No order confirmed without the payment record (or your confirmation for UPI); every refund tracked. |  |
| `label.collected` | एडवांस जमा हुआ | Advance collected |  |
| `label.stillToCollect` | पिकअप पर लेना बाकी | To collect at pickup |  |
| `label.givenBack` | वापस किया | Given back |  |
| `label.ordersTaken` | लिए गए ऑर्डर | Orders taken |  |
| `label.cancelled` | रद्द हुए | Cancelled |  |
| `label.wasAsked` | आपसे पूछा गया | You were asked |  |
| `label.approved` | आपने मंज़ूर किया | You approved |  |
| `label.saidNo` | आपने मना किया | You said no |  |
| `label.stoppedByLimits` | आपकी सीमाओं ने रोका | Stopped by your limits |  |
| `label.notChecked` | जाँचा नहीं गया | Not checked |  |
| `label.orders` | ऑर्डर | orders |  |
| `stop.price-at-or-above-menu` | मेन्यू से कम दाम | Prices below your menu |  |
| `stop.order-size` | बहुत ज़्यादा चीज़ों वाले ऑर्डर | Orders with too many items |  |
| `stop.within-stock` | दिन के स्टॉक से ज़्यादा के ऑर्डर | Orders past the day's stock |  |
| `stop.within-day-cap` | दिन की सीमा से ज़्यादा ऑर्डर | Orders past the day's limit |  |
| `stop.before-cutoff` | कट-ऑफ़ के बाद के ऑर्डर | Orders after the cut-off |  |
| `stop.within-delivery-area` | डिलीवरी क्षेत्र के बाहर के पते | Addresses outside your delivery area |  |
| `stop.confirm-only-when-recorded` | बिना भुगतान रिकॉर्ड के "पक्का" | "Confirmed" with no payment on record |  |
| `stop.one-advance-per-order` | एक ऑर्डर का दूसरा एडवांस | A second advance on one order |  |
| `stop.refund-limit` | सीमा से ऊपर के रिफंड | Refunds above your limit |  |
| `stop.message-matches-record` | रिकॉर्ड से न मिलने वाले संदेश | Messages that did not match the record |  |
| `stop.opt-out` | STOP के बाद संदेश | Messages after STOP |  |
| `handRun` | जाँच हाथ से की गई। | Checks were run by hand. |  |
| `sourceTag.stand-in` | अभ्यास वाले नकली सिस्टम, टेस्ट पैसा | stand-in services, test money |  |
| `sourceTag.test-mode` | टेस्ट मोड, टेस्ट पैसा | test mode, test money |  |
| `more` | और 12 बातें (पूरी रिपोर्ट में) | and 12 more (see the full report) |  |
| `notChecked.cash` | पिकअप पर नकद या UPI से दी गई बाकी रकम | balance paid in cash or UPI at pickup |  |
| `notChecked.upi` | Razorpay के बाहर के भुगतान | payments outside Razorpay |  |
| `notChecked.whatsapp` | असली WhatsApp | real WhatsApp |  |
| `notChecked.razorpay` | असली Razorpay | real Razorpay |  |
| `notChecked.review` | शब्दों की किसी मूल भाषी से जाँच | a native speaker's review of the wording |  |
| `languageName.hi` | हिंदी | Hindi |  |
| `languageName.en` | अंग्रेज़ी | English |  |
| `languageName.ml` | मलयालम | Malayalam |  |
| `languageName.kn` | कन्नड़ | Kannada |  |
| `upiLabel.collected` | मालिक द्वारा मिला हुआ दर्ज एडवांस | Advance marked paid by owner |  |
| `upiLabel.givenBack` | मालिक द्वारा भेजा हुआ दर्ज रिफंड | Refunds marked sent by owner |  |
| `upiLabel.notChecked` | भुगतान की अपने-आप जाँच (UPI में हर भुगतान आप दर्ज करते हैं) | automatic payment checking (with UPI you mark each payment) |  |
| `notTested.balance-at-pickup` | बाकी रकम, जो पिकअप या डिलीवरी पर नकद या UPI से दी जाती है (सिर्फ़ एडवांस का हिसाब रखा जाता है) | The rest of the price, paid in cash or by UPI at pickup or delivery (only the advance is tracked) |  |
| `notTested.kitchen-and-delivery` | खाना बना, लिया गया या पहुँचा या नहीं (स्लॉट खत्म होने पर ऑर्डर पूरा माना जाता है) | Whether the food was made, collected or delivered (an order is completed when its slot ends) |  |
| `notTested.order-changes` | पक्के ऑर्डर में बदलाव (ग्राहक रद्द करके दोबारा ऑर्डर करता है) | Changing a confirmed order (a customer cancels and orders again) |  |
| `notTested.payments-outside-razorpay` | Razorpay के बाहर के भुगतान (यह दुकान Razorpay से लेती है) | Payments outside Razorpay (this shop takes Razorpay) |  |
| `notTested.real-whatsapp` | असली WhatsApp | Real WhatsApp |  |
| `notTested.real-razorpay` | असली Razorpay (टेस्ट मोड या लाइव) | Real Razorpay (test mode or live) |  |
| `notTested.webhook-signatures` | वेबहुक के हस्ताक्षर | Webhook signatures |  |
| `notTested.real-model` | असली AI मॉडल (नियम और नकली मॉडल चलाए गए; संदेश तय साँचे वाले हैं) | A real AI model (the rules and stand-in models were run; messages are fixed templates) |  |
| `notTested.other-languages` | तमिल, तेलुगु और दूसरी भाषाएँ | Tamil, Telugu and other languages |  |
| `notTested.native-review` | हिंदी, मलयालम और कन्नड़ के शब्दों की किसी मूल भाषी से जाँच | A native speaker's review of the Hindi, Malayalam and Kannada wording |  |
| `notTested.restart-mid-step` | किसी कदम के बीच में क्रैश या रीस्टार्ट | A crash or restart in the middle of a step |  |
| `notTested.same-instant` | ठीक एक ही पल में आखिरी हिस्सा लेने वाले दो ग्राहक | Two customers taking the last portion at the exact same instant |  |
| `notTested.number-words` | एक से दस (अंग्रेज़ी और हिंदी में) और एक से पाँच (मलयालम और कन्नड़ में) के अलावा शब्दों में लिखी मात्राएँ | Quantities written in words other than one to ten (English and Hindi) and one to five (Malayalam and Kannada) |  |
| `notTested.other-faults` | हाथ की जाँच में बताई गई गड़बड़ियों से अलग गड़बड़ियाँ | Faults beyond the ones the hand check lists |  |
| `notTested.upi-not-automatic` | भुगतान की अपने-आप जाँच: UPI में हर भुगतान मालिक खुद मिला हुआ दर्ज करते हैं | automatic payment checking: with UPI the owner marks each payment received |  |
| `notTested.real-upi` | असली UPI ऐप से असली UPI ID पर भुगतान (मालिक का दर्ज करना आज़माया गया, भुगतान नहीं) | a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment) |  |
| `notTested.own-settings` | ये जाँचें इस दुकान की अपनी सेटिंग पर (चालू करने से पहले का जाँच प्रमाणपत्र कहता है कि वे उदाहरण दुकान Annapurna Tiffins पर चली थीं) | These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Annapurna Tiffins) |  |
| `notTested.other-settings` | ये जाँचें इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे अलग सेटिंग पर चली थीं) | These checks on this shop's own settings (the go-live certificate says they ran on different settings) |  |
| `notTested.no-go-live-certificate` | ये जाँचें इस दुकान की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र नहीं दिया गया) | These checks on this shop's own settings (no go-live certificate was given) |  |
| `notTested.go-live-untrusted` | ये जाँचें इस दुकान की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया) | These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used) |  |
| `notTested.situations-skipped` | वे स्थितियाँ जो इन सेटिंग पर चल नहीं सकीं (जाँच प्रमाणपत्र में उनके नाम हैं) | Situations these settings could not run (named in the go-live certificate) |  |
| `notCounted.balance-at-pickup` | बाकी रकम जो पिकअप या डिलीवरी पर नकद या UPI से दी गई: रिकॉर्ड में सिर्फ़ एडवांस है | The rest of the price, paid in cash or by UPI at pickup or delivery: the record only holds the advance |  |
| `notCounted.kitchen-and-delivery` | खाना बना, लिया गया या पहुँचा या नहीं | Whether the food was made, collected or delivered |  |
| `notCounted.read-receipts` | ग्राहक ने संदेश पढ़ा या नहीं | Whether a customer read a message |  |
| `notCounted.outside-agent` | एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने Razorpay, UPI ऐप या WhatsApp में किया) | Anything done outside the agent (by you or anyone else, in Razorpay, your UPI app or WhatsApp) |  |
| `notCounted.outside-agent-upi` | एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने UPI ऐप या WhatsApp में किया) | Anything done outside the agent (by you or anyone else, in your UPI app or WhatsApp) |  |
| `notCounted.rule-breaks` | वे नियम-उल्लंघन जो एजेंट ने देखे नहीं: रिकॉर्ड में वही है जो एजेंट ने किया या जिससे उसे रोका गया | Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing |  |
| `cert.date` | तारीख़ | Date |  |
| `cert.held` | 26 में से 25 स्थितियाँ ठीक रहीं। 1 में गड़बड़ हुई। 12 बातें जाँची नहीं गईं। | Held 25 of 26 situations. 1 failed. 12 not tested. |  |
| `cert.intro` | चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: खोए हुए जवाब, दो बार या देर से आया भुगतान, बिना भरे "भर दिया" कहने वाले ग्राहक, स्टॉक से ज़्यादा या कट-ऑफ़ के बाद के ऑर्डर, रिफंड की माँग, और एजेंट को चकमा देने वाले ग्राहक। | Before switching on, we tried situations that could go wrong: lost replies, a payment arriving twice or late, customers saying they paid when they had not, orders past the stock or after the cut-off, requests for refunds, and customers trying to trick the agent. |  |
| `cert.yourLimits` | आपकी सीमाएँ | Your limits |  |
| `cert.paidRule` | भुगतान का रिकॉर्ड (या UPI में आपका दर्ज करना) पूरा एडवांस न दिखाए तो ऑर्डर पक्का नहीं होता | No order is confirmed until the payment record (or your UPI mark) shows the whole advance |  |
| `cert.menu` | मेन्यू और एक दिन में ज़्यादा से ज़्यादा बनने वाली मात्रा: Veg thali ₹120 (12) · Curd ₹20 (30) | Menu and the most made in a day: Veg thali ₹120 (12) · Curd ₹20 (30) |  |
| `cert.orderLimits` | एक दिन में ज़्यादा से ज़्यादा 8 ऑर्डर, एक ऑर्डर में 10 चीज़ें, 7 दिन आगे तक | At most 8 orders a day, 10 items in one order, up to 7 days ahead |  |
| `cert.cutoff` | आम कट-ऑफ़: ऑर्डर 1 दिन पहले 20:00 पर बंद होते हैं | The usual cut-off: orders close at 20:00, 1 day before |  |
| `cert.advance` | कीमत का 50% एडवांस में लिया जाता है; इसके लिए ऑर्डर 30 मिनट रोका जाता है | 50% of the price is paid as the advance; the order is held 30 minutes for it |  |
| `cert.delivery` | डिलीवरी सिर्फ़ यहाँ: Kakkanad, Edappally, Infopark | Delivery only to: Kakkanad, Edappally, Infopark |  |
| `cert.noDelivery` | सिर्फ़ पिकअप, डिलीवरी नहीं | Pickup only, no delivery |  |
| `cert.window` | स्लॉट से कम से कम 6 घंटे पहले रद्द करने पर एडवांस वापस होता है; उसके बाद का फ़ैसला आपका | Cancel at least 6 hours before the slot and the advance is refunded; later, it is your call |  |
| `cert.refund` | ₹300 से ऊपर का रिफंड आपसे पूछकर | Refunds above ₹300 only with your OK |  |
| `cert.approve` | ₹1,000 से ऊपर का ऑर्डर कोई भुगतान माँगने से पहले आपकी मंज़ूरी का इंतज़ार करता है | An order above ₹1,000 waits for your OK before any payment is asked |  |
| `cert.noApprove` | कोई ऑर्डर सिर्फ़ बड़े होने की वजह से आपकी मंज़ूरी का इंतज़ार नहीं करता | No order waits for your OK because of its size |  |
| `cert.notAGrade` | यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती। | This counts the situations tried. It does not grade the agent. |  |
| `cert.didNotHold` | जिनमें गड़बड़ हुई | Did not hold |  |
| `cert.handRunLine` | जाँच हाथ से की गई, असली WhatsApp या पेमेंट पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम (stand-in services) पर। सिर्फ़ टेस्ट पैसा। | Checks were run by hand against stand-in services, not real WhatsApp or payments. Test money only. |  |
| `cert.checkedOn` | जाँच इन पर की गई | Checks run on |  |
| `goLive.heading` | चालू करने से पहले की जाँच | Go-live checks |  |
| `goLive.own` | चालू करने से पहले की जाँच इसी दुकान की अपनी सेटिंग पर चली थी, 2 Nov 2026 के जाँच प्रमाणपत्र के अनुसार। | The go-live checks ran on this shop's own settings, in the go-live certificate of 2 Nov 2026. |  |
| `goLive.example` | 2 Nov 2026 का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण दुकान Annapurna Tiffins पर चली थी, इस दुकान की अपनी सेटिंग पर नहीं। | The go-live certificate of 2 Nov 2026 says its checks ran on the example shop, Annapurna Tiffins, not on this shop's own settings. |  |
| `goLive.different` | 2 Nov 2026 का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस दुकान से अलग सेटिंग पर चली थी, इसलिए उससे इस दुकान की अपनी सेटिंग का हाल पता नहीं चलता। | The go-live certificate of 2 Nov 2026 says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave. |  |
| `goLive.untrusted` | एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह इस एजेंट का जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया। | A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used. |  |
| `goLive.none` | कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी। | No go-live certificate was given, so this document does not say what the go-live checks ran on. |  |
| `goLive.signedWith` | जाँच प्रमाणपत्र पर key-3f9a1c कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है। | The go-live certificate is signed with key-3f9a1c. A key does not show who holds it. |  |
| `page.numbers` | आँकड़े | The numbers |  |
| `page.item` | क्या | What |  |
| `page.count` | कितने | How many |  |
| `page.amount` | रकम | Amount |  |
| `page.ordersTaken` | लिए गए ऑर्डर | Orders taken |  |
| `page.ordersCompleted` | पूरे हुए ऑर्डर | Orders completed |  |
| `page.ordersCancelled` | पक्के होने के बाद रद्द हुए ऑर्डर | Orders cancelled after they were confirmed |  |
| `page.holdsRanOut` | एडवांस आने से पहले खत्म हुए होल्ड | Holds that ran out before an advance |  |
| `page.soldHeading` | इस महीने के दिनों के ऑर्डर | Orders for days in this month |  |
| `page.soldOrders` | पक्के या पूरे हुए ऑर्डर | Confirmed or completed orders |  |
| `page.pickup` | पिकअप | Pickup |  |
| `page.delivery` | डिलीवरी | Delivery |  |
| `page.itemsSold` | बिकी चीज़ें | Items sold |  |
| `page.noItems` | कोई नहीं | None |  |
| `page.messagesHeading` | संदेश | Messages |  |
| `page.toYou` | आपको, मालिक को | To you, the owner |  |
| `page.heldBack` | भेजने से पहले रोके गए | Held back before sending |  |
| `page.stoppedHeading` | आपकी सीमाओं ने क्या रोका | What your limits stopped |  |
| `page.rule` | सीमा | Limit |  |
| `page.times` | बार | Times |  |
| `page.stoppedCustomers` | STOP भेजने वाले ग्राहक | Customers who sent STOP |  |
| `page.notCountedHeading` | गिना नहीं गया | Not counted |  |
| `page.notTestedHeading` | जाँचा नहीं गया | Not tested |  |
| `page.unconfirmed` | जो पक्का नहीं हुआ या नहीं हो पाया | Left unconfirmed or failed |  |
| `page.checkHeading` | इस दस्तावेज़ को जाँचें | Check this document |  |
| `page.code` | कोड | Code |  |
| `page.digest` | डाइजेस्ट | Digest |  |
| `page.countedFrom` | कहाँ से गिना | Counted from |  |
| `page.setUpBy` | तैयार किया | Set up by |  |
| `page.madeOn` | बनाया गया | Made on |  |
| `page.signedBy` | हस्ताक्षर | Signed by |  |
| `page.notSigned` | हस्ताक्षर नहीं | Not signed |  |
| `page.scanToCheck` | इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके पार्टनर या Geometer की टीम ने दी है। | Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you. |  |
| `page.signatureNote` | हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं। | A signature shows who made this document and that it has not changed. It does not show that what it counts is complete. |  |
| `page.notAGrade` | ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं। | These are counts of what the record shows. They do not grade the agent. |  |
| `page.period` | अवधि | Period |  |
| `page.showWhatWeDid` | देखें हमने क्या किया ▸ | Show what we did ▸ |  |
| `page.byActionHeading` | एजेंट ने क्या किया, काम के हिसाब से | What the agent did, by action |  |
| `page.action` | काम | Action |  |
| `page.agentVersion` | एजेंट का संस्करण | Agent version |  |
| `page.limitsDigest` | सीमाओं का डाइजेस्ट | Limits digest |  |
| `page.recordDigest` | रिकॉर्ड का डाइजेस्ट | Record digest |  |
| `page.liveServices` | असली सिस्टम | Live services |  |

