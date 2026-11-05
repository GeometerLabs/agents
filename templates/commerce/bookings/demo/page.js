// The demo page. Plain browser JavaScript, no libraries, no calls to anywhere but this server.
// Every piece of text from the server (a shop name, a customer's message) goes into the page with textContent or .value,
// never as HTML, so nothing a person types can become markup.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var S = null;            // the last state the server sent
  var busy = false;
  var tab = "customer";
  var recordShown = false;
  var toastTimer = null;
  function t(key) { return S && S.ui && typeof S.ui[key] === "string" ? S.ui[key] : ""; }

  // ---- talking to the server ---------------------------------------------------------------------------------------
  function toast(message) {
    var node = $("toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 5000);
  }

  function call(path, body) {
    if (busy) return Promise.resolve(null);
    setBusy(true);
    var init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    return fetch(path, init)
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; }, function () { return { ok: false, data: { error: "The demo did not answer." } }; });
      })
      .then(function (r) {
        if (r.ok) { S = r.data; render(); if (S.notice) toast(S.notice); }
        else if (!r.data.errors) toast(r.data.error || "Something went wrong.");
        return r;
      }, function () {
        toast("Could not reach the demo. Is it still running on the laptop?");
        return null;
      })
      .then(function (r) { setBusy(false); return r; });
  }

  function setBusy(value) {
    busy = value;
    if (S) renderControls();
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  // The buttons or the list that came with an agent message, drawn the way WhatsApp draws them under it. A tap sends the option's id back to the agent.
  function choice(option, cls) {
    var b = el("button", cls);
    b.type = "button";
    b.setAttribute("dir", "auto");
    b.appendChild(el("span", "geo-choice-title", option.title));
    if (option.description) b.appendChild(el("span", "geo-choice-desc", option.description));
    b.addEventListener("click", function () { call("/api/tap", { id: option.id }); });
    return b;
  }
  function choices(c, latest) {
    var box = el("div", "geo-choices" + (latest ? "" : " geo-choices--old"));
    (c.buttons || []).forEach(function (o) { box.appendChild(choice(o, "geo-choice")); });
    if (c.list) {
      var open = el("button", "geo-choice geo-choice--list", c.list.button);
      open.type = "button";
      open.setAttribute("aria-expanded", "false");
      var rows = el("div", "geo-rows");
      rows.hidden = true;
      c.list.rows.forEach(function (o) { rows.appendChild(choice(o, "geo-row")); });
      open.addEventListener("click", function () { rows.hidden = !rows.hidden; open.setAttribute("aria-expanded", rows.hidden ? "false" : "true"); });
      box.appendChild(open);
      box.appendChild(rows);
    }
    return box;
  }

  function bubbles(container, messages, emptyText, mine) {
    clear(container);
    if (messages.length === 0) { container.appendChild(el("div", "geo-empty", emptyText)); return; }
    messages.forEach(function (m, i) {
      var b = el("div", "geo-bubble geo-bubble--" + (m.who === "me" ? mine : "agent"));
      var p = el("p", "geo-bubble-text", m.text);
      p.setAttribute("dir", "auto");
      b.appendChild(p);
      if (m.choices) b.appendChild(choices(m.choices, i === messages.length - 1));
      b.appendChild(el("time", "geo-bubble-time", m.time));
      container.appendChild(b);
    });
    container.scrollTop = container.scrollHeight;
  }

  function render() {
    document.documentElement.setAttribute("lang", S.shop.language);
    $("banner").textContent = t("banner");
    $("shopName").textContent = S.shop.name;
    $("clock").textContent = t("clock") + ": " + S.clock;
    $("btnSetup").textContent = t("setup");
    $("btnReset").textContent = t("reset");
    $("tabCustomer").textContent = t("tabCustomer");
    $("tabRecord").textContent = t("tabRecord");
    $("btnRecord").textContent = recordShown ? t("hideRecord") : t("showRecord");
    $("msg").setAttribute("placeholder", t("typeHere"));
    $("btnSend").textContent = t("send");
    $("chipsLabel").textContent = t("trySaying");
    $("btnHour").textContent = t("time1h");
    $("btnDay").textContent = t("time1d");
    $("btnCancel").textContent = t("cancel");
    $("btnPay2").textContent = t("payTwice");
    $("btnPay").textContent = S.customer.payLabel;
    $("customerName").textContent = S.shop.name + " · " + t("testCustomer");

    bubbles($("chat"), S.customer.messages, t("chatEmpty"), "customer");
    var chips = $("chips");
    clear(chips);
    S.customer.chips.forEach(function (text) {
      var c = el("button", "geo-chip", text);
      c.type = "button";
      c.setAttribute("dir", "auto");
      c.addEventListener("click", function () { send(text); });
      chips.appendChild(c);
    });

    renderOwner();
    renderRecord();
    renderTabs();
    renderControls();
  }

  function renderControls() {
    var c = S.customer;
    $("btnPay").disabled = busy || !c.canPay;
    $("btnPay2").disabled = busy || !c.canPayTwice;
    $("btnHour").disabled = busy;
    $("btnDay").disabled = busy;
    $("btnCancel").disabled = busy || !c.canCancel;
    $("btnSend").disabled = busy;
    $("btnReset").disabled = busy;
    var chips = $("chips").children;
    for (var i = 0; i < chips.length; i++) chips[i].disabled = busy;
    var taps = $("chat").getElementsByTagName("button"); // the agent's buttons and list rows
    for (var k = 0; k < taps.length; k++) if (taps[k].className.indexOf("geo-choice--list") < 0) taps[k].disabled = busy; // the button that opens a list only shows it
    var buttons = $("waiting").getElementsByTagName("button");
    for (var j = 0; j < buttons.length; j++) buttons[j].disabled = busy;
    document.body.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function renderOwner() {
    var waiting = $("waiting");
    clear(waiting);
    var cards = S.owner.waiting;
    if (cards.length > 0) {
      waiting.appendChild(el("h2", "geo-heading", t("waitingHeading")));
      cards.forEach(function (card) {
        var box = el("div", "geo-waiting");
        box.appendChild(el("div", "geo-waiting-title", card.title));
        box.appendChild(el("div", "geo-waiting-detail", card.detail));
        if (card.reason) box.appendChild(el("div", "geo-waiting-reason", card.reason));
        var row = el("div", "geo-waiting-buttons");
        card.buttons.forEach(function (b, i) {
          var button = el("button", "geo-button" + (i === 0 ? " geo-button--primary" : ""), b.label);
          button.type = "button";
          button.addEventListener("click", function () { call("/api/owner", { command: b.command, ref: card.ref }); });
          row.appendChild(button);
        });
        box.appendChild(row);
        waiting.appendChild(box);
      });
    }
    $("plainHeading").textContent = t("plainHeading");
    var list = $("plain");
    clear(list);
    S.owner.summary.forEach(function (line) {
      var li = el("li", "geo-summary-line geo-summary-line--" + line.kind);
      li.appendChild(el("span", "geo-summary-mark", line.kind === "ok" ? "✓" : line.kind === "warn" ? "!" : line.kind === "info" ? "•" : ""));
      li.appendChild(el("span", null, line.text));
      list.appendChild(li);
    });
    $("ownerChatHeading").textContent = t("ownerHeading");
    bubbles($("ownerChat"), S.owner.messages, t("ownerEmpty"), "owner");
    var count = cards.length;
    var badge = $("badge");
    badge.hidden = count === 0;
    badge.textContent = String(count);
    $("tabOwnerText").textContent = t("tabOwner");
  }

  function renderRecord() {
    $("workDone").textContent = S.record.workDone;
    var f = S.record.fakes;
    var stand = $("standIns");
    clear(stand);
    stand.appendChild(el("h3", "geo-box-title", "What the practice services hold right now"));
    var ul = el("ul");
    ul.appendChild(el("li", null, "Calendar: " + f.calendar.length + " entries" + f.calendar.map(function (e) { return " · " + e.bookingRef + " " + e.status + " " + e.start; }).join("")));
    f.payments.forEach(function (p) {
      ul.appendChild(el("li", null, "Payment link " + p.id + " for " + p.bookingRef + ": ₹" + p.amountInr + ", " + p.status + (p.paid.length ? "; paid " + p.paid.map(function (x) { return x.id + " ₹" + x.amountInr + (x.refundedInr ? " (₹" + x.refundedInr + " refunded)" : ""); }).join(", ") : "")));
    });
    ul.appendChild(el("li", null, "Refunds: " + f.refunds.length + f.refunds.map(function (r) { return " · " + r.id + " ₹" + r.amountInr; }).join("")));
    ul.appendChild(el("li", null, "WhatsApp messages sent: " + f.messages.toCustomer + " to the customer, " + f.messages.toOwner + " to the owner"));
    stand.appendChild(ul);

    var rows = $("rows");
    clear(rows);
    S.record.rows.forEach(function (r) {
      var card = el("div", "geo-record-card");
      var head = el("div", "geo-record-head");
      head.appendChild(el("span", null, "#" + r.seq + " · " + r.time + " · " + r.who + (r.booking ? " · " + r.booking : "")));
      head.appendChild(el("span", "geo-pill geo-pill--" + r.outcome, r.outcomeText));
      card.appendChild(head);
      card.appendChild(el("div", "geo-record-what", r.action));
      if (r.notes) card.appendChild(el("div", "geo-decision", r.notes));
      r.decisions.forEach(function (d) {
        var line = el("div", "geo-decision geo-decision--" + d.verdict);
        line.appendChild(el("b", null, d.rule + ": " + (d.verdict === "allow" ? "allowed" : d.verdict === "block" ? "stopped" : "asked the owner") + ". "));
        line.appendChild(document.createTextNode(d.reason));
        card.appendChild(line);
      });
      if (r.refs.length) card.appendChild(el("div", "geo-record-refs", r.refs.map(function (kv) { return kv[0] + "=" + kv[1]; }).join("  ")));
      rows.appendChild(card);
    });
  }

  function renderTabs() {
    $("tabRecord").hidden = !recordShown;
    if (!recordShown && tab === "record") tab = "customer";
    ["customer", "owner", "record"].forEach(function (name) {
      var button = $("tab" + name.charAt(0).toUpperCase() + name.slice(1));
      button.setAttribute("aria-selected", name === tab ? "true" : "false");
      $("panel-" + name).hidden = name !== tab;
    });
  }

  function show(name) {
    tab = name;
    renderTabs();
    window.scrollTo(0, 0);
    if (name === "customer") { var chat = $("chat"); chat.scrollTop = chat.scrollHeight; }
  }

  // ---- what the buttons do -----------------------------------------------------------------------------------------------
  function send(text) {
    var value = String(text || "").trim();
    if (value === "") return;
    call("/api/say", { text: value }).then(function (r) { if (r && r.ok) { $("msg").value = ""; } });
  }

  // ---- the shop form ---------------------------------------------------------------------------------------------------------
  function field(label, input) {
    var wrap = el("label", "geo-field");
    wrap.appendChild(el("span", null, label));
    wrap.appendChild(input);
    return wrap;
  }
  function textInput(value, extra) {
    var input = el("input");
    input.type = "text";
    input.value = value;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("maxlength", "80");
    if (extra) Object.keys(extra).forEach(function (k) { input.setAttribute(k, extra[k]); });
    return input;
  }

  var formParts = null;
  function openSheet() {
    var f = S.form;
    var sheet = $("sheet");
    var body = $("sheetBody");
    clear(body);
    var parts = { services: [], days: [] };
    body.appendChild(el("h2", "geo-heading", t("formTitle")));
    body.appendChild(el("p", "geo-hint", t("formHint")));
    parts.name = textInput(f.name);
    body.appendChild(field(t("formName"), parts.name));
    parts.language = el("select");
    S.languages.forEach(function (l) {
      var o = el("option", null, l.label);
      o.value = l.code;
      if (l.code === f.language) o.selected = true;
      parts.language.appendChild(o);
    });
    body.appendChild(field(t("formLanguage"), parts.language));
    body.appendChild(el("h2", "geo-heading", t("formServices")));
    f.services.forEach(function (s) {
      var box = el("div", "geo-service");
      var row = {
        id: s.id,
        name: textInput(s.name),
        also: textInput(s.also, { maxlength: "200" }),
        price: textInput(s.price, { inputmode: "numeric", maxlength: "9" }),
        minutes: textInput(s.minutes, { inputmode: "numeric", maxlength: "3" })
      };
      box.appendChild(field(t("formServiceName"), row.name));
      box.appendChild(field(t("formAlso"), row.also));
      var two = el("div", "geo-row");
      two.appendChild(field(t("formPrice"), row.price));
      two.appendChild(field(t("formMinutes"), row.minutes));
      box.appendChild(two);
      parts.services.push(row);
      body.appendChild(box);
    });
    parts.deposit = textInput(f.deposit, { inputmode: "numeric", maxlength: "9" });
    body.appendChild(field(t("formDeposit"), parts.deposit));
    var times = el("div", "geo-row");
    parts.opens = textInput(f.opens, { type: "time" });
    parts.closes = textInput(f.closes, { type: "time" });
    times.appendChild(field(t("formOpens"), parts.opens));
    times.appendChild(field(t("formCloses"), parts.closes));
    body.appendChild(times);
    var days = el("div", "geo-days");
    S.ui.dayNames.forEach(function (name, i) {
      var label = el("label");
      var box = el("input");
      box.type = "checkbox";
      box.checked = f.days[i] === true;
      label.appendChild(box);
      label.appendChild(el("span", null, name));
      days.appendChild(label);
      parts.days.push(box);
    });
    var daysField = el("div", "geo-field");
    daysField.appendChild(el("span", null, t("formDays")));
    daysField.appendChild(days);
    body.appendChild(daysField);
    var errors = el("ul", "geo-errors");
    errors.hidden = true;
    errors.setAttribute("role", "alert");
    parts.errors = errors;
    body.appendChild(errors);
    var submit = el("button", "geo-button geo-button--primary", t("formSubmit"));
    submit.type = "submit";
    var cancel = el("button", "geo-button geo-button--quiet", t("formCancel"));
    cancel.type = "button";
    cancel.addEventListener("click", closeSheet);
    var row2 = el("div", "geo-actions");
    row2.appendChild(submit);
    row2.appendChild(cancel);
    body.appendChild(row2);
    formParts = parts;
    sheet.hidden = false;
    sheet.style.top = $("banner").offsetHeight + "px"; // the demo banner stays visible above the form
    sheet.scrollTop = 0;
  }
  function closeSheet() { $("sheet").hidden = true; formParts = null; }

  function submitSheet(event) {
    event.preventDefault();
    if (!formParts) return;
    var p = formParts;
    var form = {
      name: p.name.value,
      language: p.language.value,
      services: p.services.map(function (r) { return { id: r.id, name: r.name.value, also: r.also.value, price: r.price.value, minutes: r.minutes.value }; }),
      deposit: p.deposit.value,
      opens: p.opens.value,
      closes: p.closes.value,
      days: p.days.map(function (b) { return b.checked; })
    };
    call("/api/shop", { form: form }).then(function (r) {
      if (!r) return;
      if (r.ok) { closeSheet(); show("customer"); return; }
      clear(p.errors);
      (r.data.errors || [r.data.error || "That did not work."]).forEach(function (message) { p.errors.appendChild(el("li", null, message)); });
      p.errors.hidden = false;
      p.errors.scrollIntoView();
    });
  }

  // ---- wiring ----------------------------------------------------------------------------------------------------------------
  $("composer").addEventListener("submit", function (e) { e.preventDefault(); send($("msg").value); });
  $("btnPay").addEventListener("click", function () { call("/api/pay", { times: 1 }); });
  $("btnPay2").addEventListener("click", function () { call("/api/pay", { times: 2 }); });
  $("btnHour").addEventListener("click", function () { call("/api/time", { minutes: 60 }); });
  $("btnDay").addEventListener("click", function () { call("/api/time", { minutes: 1440 }); });
  $("btnCancel").addEventListener("click", function () { call("/api/cancel", {}); });
  $("btnReset").addEventListener("click", function () { call("/api/reset", {}); });
  $("btnSetup").addEventListener("click", function () { if (S) openSheet(); });
  $("sheetForm").addEventListener("submit", submitSheet);
  $("tabCustomer").addEventListener("click", function () { show("customer"); });
  $("tabOwner").addEventListener("click", function () { show("owner"); });
  $("tabRecord").addEventListener("click", function () { show("record"); });
  $("btnRecord").addEventListener("click", function () {
    recordShown = !recordShown;
    if (recordShown) show("record"); else show("customer");
    if (S) $("btnRecord").textContent = recordShown ? t("hideRecord") : t("showRecord");
  });

  call("/api/state");
})();
