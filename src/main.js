import "./style.css";
import { analyse, validateTransaction } from "./ledger.js";
import { parseStatement, parseRows } from "./importer.js";
import { fresh, load, save, validateBackup, KEY } from "./storage.js";
import { csvCell, allocateLots } from "./ui-logic.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const money = (v) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(v);
const num = (v) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(v || 0);
const today = () => new Date().toLocaleDateString("en-CA"),
  id = () => crypto.randomUUID(),
  tone = (v) => (v >= 0 ? "positive" : "negative");
let state,
  loadError = "",
  view = "holdings",
  query = "",
  selected = "",
  pending = null,
  installPrompt = null,
  demo = false;
try {
  state = load();
} catch (e) {
  state = fresh();
  loadError =
    "Your saved diary could not be read. It has not been overwritten. Export the stored file below, then restore a valid backup. " +
    e.message;
}
const live = () =>
  analyse(
    state.transactions,
    Object.fromEntries(
      Object.entries(state.prices).map(([s, p]) => [s, p.price]),
    ),
  );
const commit = (next) => {
  if (loadError) throw Error("Recover your existing diary before saving.");
  if (demo)
    throw Error("Exit the sample diary before saving your own records.");
  save(next);
  state = next;
  render();
};
function notify(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function safely(fn) {
  try {
    fn();
  } catch (e) {
    notify(e.message);
  }
}
const icons = {
  holdings: "◫",
  cycles: "↗",
  diary: "▤",
  import: "⇧",
  settings: "⚙",
};
function render() {
  if (loadError) {
    $("#app").innerHTML =
      `<main class="welcome"><div class="brand"><span class="logo">L</span> Lotbook</div><h1>Let’s protect your diary.</h1><p class="notice">${esc(loadError)}</p><button data-action="rawbackup">Download stored data</button><label class="button secondary">Restore a backup<input type="file" id="restore" accept=".json" hidden></label><p>Clear data is available after you download a copy.</p><button data-action="clear" class="danger">Clear this device</button></main>`;
    return;
  }
  if (!state.profile) {
    welcome();
    return;
  }
  if (!state.onboarded && view !== "settings") {
    uploadPage(true);
    return;
  }
  const a = live();
  const titles = {
    holdings: "Your holdings",
    cycles: "Trading cycles",
    diary: "Your trading diary",
    import: "Bring your history",
    settings: "Your space",
  };
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#"><span class="logo">L</span> Lotbook<span class="badge">PERSONAL</span></a><p class="side-label">YOUR INVESTING SPACE</p><nav>${Object.entries(
      icons,
    )
      .map(
        ([v, i]) =>
          `<button class="nav ${v === view ? "active" : ""}" data-view="${v}"><span>${i}</span>${{ holdings: "Holdings", cycles: "Cycles", diary: "Diary", import: "Statements", settings: "Settings" }[v]}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-foot"><span class="privacy-dot"></span> Private on this device<p>Your data stays with you.</p><a href="./guide.html" target="_blank" rel="noopener">How Lotbook works ↗</a></div></aside>
  <div class="workspace"><header><div class="mobile-brand"><span class="logo">L</span> Lotbook</div><div class="breadcrumb">PERSONAL DIARY <span>/</span> ${esc(titles[view])}</div><div class="profile"><span class="avatar">${esc(state.profile[0].toUpperCase())}</span><span>${esc(state.profile)}</span></div></header><main class="content"><div class="page-title"><div><div class="eyebrow">${view === "holdings" ? "A CLEARER PICTURE, ONE LOT AT A TIME" : "YOUR JOURNEY, IN PERSPECTIVE"}</div><h1>${titles[view]}</h1><p>${{ holdings: "A little clarity for every share you own.", cycles: "Follow the journey from a purchase to a sale.", diary: "The trades, decisions, and lessons behind your portfolio.", import: "Read your statements locally. Review before adding.", settings: "Back up your diary, install the app, and manage your data." }[view]}</p></div>${view === "holdings" ? '<button data-action="buy">＋ Add a purchase</button>' : ""}</div>
  ${demo ? '<div class="notice">You are exploring synthetic demo data. It is not saved. <button class="text-button" data-action="enddemo">Exit demo</button></div>' : ""}
  ${a.errors.length ? `<div class="notice error">${a.errors.length} transactions could not be applied. ${esc(a.errors[0].message)} Check your history before relying on totals.</div>` : ""}
  ${view === "holdings" ? holdings(a) : view === "cycles" ? cycles(a) : view === "diary" ? diary(a) : view === "import" ? uploadContent() : settings()}
  <footer>Private by design <span>·</span> Saved on this device <span>·</span> No broker connection</footer></main></div><nav class="mobile-nav">${Object.entries(
    icons,
  )
    .map(
      ([v, i]) =>
        `<button data-view="${v}" class="${view === v ? "active" : ""}"><span>${i}</span>${{ holdings: "Holdings", cycles: "Cycles", diary: "Diary", import: "Import", settings: "Settings" }[v]}</button>`,
    )
    .join("")}</nav>`;
}
function welcome() {
  $("#app").innerHTML =
    `<div class="welcome-wrap"><section class="welcome-art"><div class="brand"><span class="logo light">L</span> Lotbook</div><div class="eyebrow">YOUR SHARES. YOUR STORY.</div><h1>Know the story<br>behind every trade.</h1><p>A personal space for your core holdings,<br>trading cycles, and everything in between.</p><div class="paper"><span class="eyebrow">A LITTLE LOT CLARITY</span><div class="paper-row">Core holding <b>10 shares · ₹1,300</b></div><div class="paper-row">Trading purchase <b>10 shares · ₹1,250</b></div><div class="paper-row">Trading sale <b>10 shares · ₹1,270</b></div><div class="paper-result">One completed cycle <strong>+₹200</strong></div><small>Synthetic example · before charges</small></div><p class="privacy">● Local storage. No uploads to a server.</p></section><section class="welcome-form"><span class="step-label">LET’S MAKE THIS YOURS</span><h2>Welcome to Lotbook.</h2><p>Your diary starts with a name.<br>No passwords. No broker credentials.</p><form id="welcome-form"><label>Your name<input name="name" maxlength="60" placeholder="What should we call you?" autocomplete="given-name" required></label><button class="full">Start my diary →</button></form><p class="fine">This is a local profile, not an authenticated account. Anyone with access to this browser can open it.</p><button class="text-button" data-action="demo">Explore a sample diary</button></section></div>`;
}
function stats(a) {
  const enteredValue = a.totals.unpriced && a.holdings.every(h => h.currentPrice === null) ? null : a.totals.currentValue;
  return `<div class="stats"><div class="stat-card featured"><span>Holdings cost</span><strong>${money(a.totals.invested)}</strong><small>Cost of remaining purchase lots</small></div><div class="stat-card"><span>Value at entered prices</span><strong>${money(enteredValue)}</strong><small>${a.totals.unpriced ? "Incomplete · missing prices: " + a.totals.unpriced : "Manual prices · not a live feed"}</small></div><div class="stat-card"><span>Diary realised result</span><strong class="${tone(a.totals.realizedNet)}">${money(a.totals.realizedNet)}</strong><small>Selected lots · ${a.cycles.length} lot closures</small></div><div class="stat-card"><span>FIFO comparison</span><strong class="${tone(a.totals.fifoNet)}">${money(a.totals.fifoNet)}</strong><small>Oldest purchases matched first</small></div></div>`;
}
function holdings(a) {
  const list = a.holdings.filter(
    (h) =>
      h.quantity > 0 &&
      (!query ||
        h.symbol.toLowerCase().includes(query.toLowerCase()) ||
        h.name?.toLowerCase().includes(query.toLowerCase())),
  );
  return `${stats(a)}<div class="info-bar"><span>ⓘ</span><p>Lot selection changes how your diary attributes a sale. Your broker records and actual economic gain stay the same. FIFO here is a comparison, not a tax report.</p></div><section class="panel"><div class="panel-title"><div><h2>Portfolio</h2><span>${a.holdings.filter((h) => h.quantity > 0).length} holdings <span class="dot">·</span> Tap a stock to see every purchase</span></div><input class="search" id="search" value="${esc(query)}" placeholder="Search your holdings" aria-label="Search holdings"></div>${list.length ? `<div class="holdings-head"><span>Stock / quantity</span><span>Average / cost</span><span>Entered price / value</span><span>Unrealised</span></div>${list.map((h) => `<button class="holding-row" data-stock="${esc(h.symbol)}"><div class="stock-main"><span class="stock-icon">${esc(h.symbol.slice(0, 2))}</span><div><b>${esc(h.name || h.symbol)}</b><small>${esc(h.symbol)} · ${num(h.quantity)} shares</small><span class="tag">${num(h.coreQuantity)} core · ${num(h.tradingQuantity)} trading</span></div></div><div><b>${money(h.averageCost)}</b><small>${money(h.cost)}</small></div><div><b>${money(h.currentPrice)}</b><small>${money(h.currentValue)}</small></div><div><b class="${h.unrealized === null ? "" : tone(h.unrealized)}">${money(h.unrealized)}</b><small>View lots →</small></div></button>`).join("")}` : `<div class="empty"><span class="empty-icon">◫</span><h3>${query ? "No matching stocks" : "Your portfolio starts here"}</h3><p>Import your Groww order history, or add your first purchase.<br>Every purchase becomes a lot you can follow.</p><button data-action="buy">Add a purchase</button><button class="secondary" data-view="import">Import statements</button></div>`}</section>${reconciliation(a)}<div class="two-col"><section class="panel mini"><div class="panel-title"><h2>Cash balance</h2><button class="text-button" data-action="cash">Update</button></div><strong class="large">${money(state.cash)}</strong><p>Enter the balance shown in Groww manually. It is not reconstructed from equity trades.</p></section><section class="panel mini"><div class="panel-title"><h2>Your diary, your device</h2><span>↗</span></div><p>Export a backup regularly. Browser storage can be cleared or lost when you change devices.</p><button class="secondary" data-action="export">Export my diary</button></section></div>`;
}
function reconciliation(a) {
  if (!state.snapshots.length) return "";
  const diffs = state.snapshots
    .map((s) => ({
      s,
      actual: a.holdings.find((h) => h.symbol === s.symbol)?.quantity || 0,
    }))
    .filter((x) => Math.abs(x.actual - x.s.quantity) > 1e-6);
  return `<section class="panel mini"><h2>Holdings reconciliation</h2><p>${diffs.length ? `${diffs.length} positions differ from your last uploaded snapshot. Import missing purchases or create an explicit opening lot; snapshots never create duplicate buys.` : "Quantities match the last uploaded snapshot. Update it after new trades."}</p>${diffs.map((x) => `<div class="kv"><span>${esc(x.s.symbol)}</span><b>Snapshot ${num(x.s.quantity)} · Diary ${num(x.actual)}</b></div>`).join("")}</section>`;
}
function cycles(a) {
  const months = {};
  for (const c of a.cycles) {
    const k = c.sellDate.slice(0, 7);
    (months[k] ||= []).push(c);
  }
  return `${stats(a)}<div class="two-col"><section class="panel mini"><h2>Completed lot closures</h2><strong class="large">${a.cycles.length}</strong><p>${a.cycles.filter((c) => c.net > 0).length} profitable · ${a.cycles.filter((c) => c.net < 0).length} loss-making · ${a.cycles.filter((c) => c.net === 0).length} break-even</p></section><section class="panel mini"><h2>Recorded charges</h2><strong class="large">${money(a.totals.charges)}</strong><p>Only charges provided by you or the statement. Zero does not mean the broker charged nothing.</p></section></div>${
    Object.entries(months)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(
        ([m, cs]) =>
          `<section class="panel"><div class="panel-title"><h2>${esc(m)}</h2><b class="${tone(a.monthlyResults.find(r=>r.month===m).net)}">${money(a.monthlyResults.find(r=>r.month===m).net)}</b></div>${cs.map((c) => `<div class="cycle-row"><div><b>${esc(c.symbol)}</b><span class="tag">${esc(c.purpose)}</span><small>${esc(c.buyDate)} → ${esc(c.sellDate)} · ${num(c.quantity)} shares · ${c.holdingDays} days</small></div><div><small>Entry ${money(c.buyPrice)} → Exit ${money(c.sellPrice)}</small><small>Gross ${money(c.gross)} · Charges ${money(c.charges)}</small><b class="${tone(c.net)}">Net ${money(c.net)}</b></div></div>`).join("")}</section>`,
      )
      .join("") ||
    '<section class="panel empty"><h3>No closed cycles yet</h3><p>Record a sale from a stock’s purchase-lot view to create your first cycle.</p></section>'
  }`;
}
function diary(a) {
  const tx = [...state.transactions].reverse();
  return `<section class="panel mini"><h2>Today’s decision note</h2><form id="note-form"><label>What did you learn or plan?<textarea name="note" maxlength="3000" placeholder="Why did I enter? What would make me exit?">${esc(state.notes[today()] || "")}</textarea></label><button>Save note</button></form></section><section class="panel"><div class="panel-title"><h2>Transaction history</h2><span>${tx.length} entries</span></div>${tx.map((t, i) => `<div class="history-row"><span class="side ${t.side.toLowerCase()}">${esc(t.side)}</span><div><b>${esc(t.symbol)}</b><small>${esc(t.date)} · ${num(t.quantity)} × ${money(t.price)} · Charges ${money(t.charges)}</small>${t.note ? `<small>${esc(t.note)}</small>` : ""}</div><span class="tag">${t.side === "BUY" ? esc(t.purpose) : "Diary sale"}</span>${i === 0 ? '<button class="text-button danger" data-action="undo">Undo last</button>' : ""}</div>`).join("") || '<div class="empty">Your imports and manual transactions will appear here.</div>'}</section>${Object.entries(
    state.notes,
  )
    .filter(([, n]) => n.trim())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(
      ([d, n]) =>
        `<section class="panel mini"><span class="eyebrow">${esc(d)} · DECISION NOTE</span><p class="note-text">${esc(n)}</p></section>`,
    )
    .join("")}`;
}
function uploadPage(first) {
  $("#app").innerHTML =
    `<main class="onboarding"><div class="brand"><span class="logo">L</span> Lotbook</div><div class="step-label">STEP 2 OF 2 · YOUR HISTORY</div><h1>Bring your investing story.</h1><p>Hi ${esc(state.profile)}. Start with your Groww reports, or build the diary manually.</p>${uploadContent()}<button class="secondary full" data-action="skip">Start with an empty diary →</button></main>`;
}
function uploadContent() {
  return `<div class="upload-grid"><section class="panel mini"><span class="step-number">01</span><h2>Order / trade history</h2><p><b>Required for a full history.</b> Export equity buys and sells for the entire period from Groww → Profile → Reports → Transaction / Order history. Prefer Excel or CSV.</p><label class="upload-target">⇧ <b>Choose trade statement</b><small>CSV · XLSX · XLS · PDF · up to 15 MB</small><input type="file" class="statement" data-kind="trades" accept=".csv,.xlsx,.xls,.pdf"></label></section><section class="panel mini"><span class="step-number">02</span><h2>Current holdings</h2><p><b>Recommended to reconcile.</b> Export a current holdings snapshot with stock, quantity, and average price. It checks the history; it does not add duplicate purchases.</p><label class="upload-target">⇧ <b>Choose holdings statement</b><small>CSV · XLSX · XLS · PDF</small><input type="file" class="statement" data-kind="holdings" accept=".csv,.xlsx,.xls,.pdf"></label></section></div><div class="notice"><b>Getting the right history</b><p>Use all relevant periods. A P&amp;L summary alone cannot reconstruct purchase lots. Dividends, corporate actions, transfers, F&amp;O, mutual funds and short positions are outside this equity MVP. Add an opening purchase lot when older history is unavailable, and label it in the note.</p><p>Contract notes show charges. Enter charges per transaction if your trade report omits them. PDF layouts vary; extracted text stays local and Excel is more reliable.</p><a href="https://groww.in/help/my-account/ma-others/where-can-i-get-the-transaction-history" target="_blank" rel="noopener noreferrer">Groww’s report instructions ↗</a></div>${
    state.imports.length
      ? `<section class="panel mini"><h2>Import log</h2>${state.imports
          .slice()
          .reverse()
          .map(
            (i) =>
              `<div class="kv"><span>${esc(i.date)} · ${esc(i.kind)}</span><span>${i.count} records</span></div>`,
          )
          .join("")}</section>`
      : ""
  }`;
}
function settings() {
  return `<div class="two-col"><section class="panel mini"><h2>Your local profile</h2><form id="profile-form"><label>Name<input name="name" value="${esc(state.profile)}" maxlength="60" required></label><button>Save name</button></form><p>A convenience profile on this browser. No password or cloud account.</p></section><section class="panel mini"><h2>Install Lotbook</h2><p>On Android, open this site in Chrome and use Install app or the menu → Add to Home screen. On iPhone use Safari → Share → Add to Home Screen.</p><button data-action="install">Install / instructions</button><small>Install prompts depend on your browser. Offline use works after the app has loaded online.</small></section><section class="panel mini"><h2>Keep a backup</h2><p>Export a JSON diary for another device. Import replaces this diary only after validation and confirmation.</p><button data-action="export">Export backup</button><label class="button secondary">Import backup<input type="file" id="restore" accept=".json" hidden></label><button class="text-button" data-action="csv">Export transactions CSV</button></section><section class="panel mini"><h2>Privacy &amp; data</h2><p>Parsed records live in this browser’s local storage. Statements are processed in memory and are never sent to our servers or GitHub. No analytics, external fonts, ads, broker API, or AI service.</p><p>Public GitHub hosts the app files and receives ordinary web requests. It does not receive your name or financial records. Shared devices and browser clearing can expose or erase local data.</p><button class="danger secondary" data-action="clear">Clear all local data</button></section></div><section class="panel mini"><h2>Understand the numbers</h2><p>Selecting a purchase lot changes realised and unrealised attribution in your diary. It does not change the shares actually sold through Groww, broker FIFO records, or total wealth. Verify charges and broker records independently. Current prices and cash are manually entered and can become stale.</p><a href="./guide.html" target="_blank">Read the app flow and limitations ↗</a></section>`;
}
function modal(title, body) {
  $("#modal-root").innerHTML =
    `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-title"><h2>${esc(title)}</h2><button class="close secondary" data-action="close" aria-label="Close dialog">×</button></div>${body}</section></div>`;
  $("#modal-root").querySelector("input,button")?.focus();
}
function close() {
  $("#modal-root").innerHTML = "";
}
const field = (label, name, type = "text", value = "", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function buyForm(symbol = "") {
  modal(
    "Add a purchase",
    `<p>Record a purchase made in your broker account. This creates a diary lot.</p><form id="buy-form"><div class="form-grid">${field("Stock symbol or name", "symbol", "text", symbol, 'required maxlength="80" placeholder="e.g. RELIANCE"')}${field("Purchase date", "date", "date", today(), "required")}${field("Shares purchased", "quantity", "number", "", 'required min="0.000001" step="any"')}${field("Price per share (₹)", "price", "number", "", 'required min="0.01" step="any"')}${field("Total buy charges (₹)", "charges", "number", 0, 'required min="0" step="any"')}<label>Purpose<select name="purpose"><option value="core">Core / long-term</option><option value="trading">Trading cycle</option></select></label></div><label>Note (optional)<textarea name="note" maxlength="500" placeholder="Your entry reason, or opening balance if history is missing"></textarea></label><button class="full">Save purchase</button><p class="fine">No order is sent to Groww. Symbols are matched exactly after converting to uppercase.</p></form>`,
  );
}
function stockDetail(symbol) {
  selected = symbol;
  const a = live(),
    h = a.holdings.find((h) => h.symbol === symbol);
  if (!h) return;
  const tx = state.transactions.filter((t) => t.symbol === symbol);
  modal(
    symbol + " · Lot history",
    `<div class="detail-summary"><div><small>Shares held</small><strong>${num(h.quantity)}</strong></div><div><small>Diary average</small><strong>${money(h.averageCost)}</strong></div><div><small>Core / trading</small><strong>${num(h.coreQuantity)} / ${num(h.tradingQuantity)}</strong></div></div><div class="row-actions"><button data-action="buystock">＋ Purchase</button><button data-action="sell" ${h.quantity <= 0 ? "disabled" : ""}>Record sale</button><button class="secondary" data-action="quote">Update price</button></div><h3>Every purchase lot</h3><p class="fine">Choose purpose per lot. A sale can be matched to a specific purchase or split across lots.</p>${h.lots.map((l) => `<div class="lot-row"><div><b>${money(l.price)} per share</b><small>${esc(l.date)} · Bought ${num(l.quantity)} · Remaining ${num(l.remaining)}</small></div><select class="lot-purpose" data-id="${esc(l.id)}" aria-label="Purpose for lot bought ${esc(l.date)} at ${l.price}"><option value="core" ${l.purpose === "core" ? "selected" : ""}>Core</option><option value="trading" ${l.purpose === "trading" ? "selected" : ""}>Trading</option></select></div>`).join("")}<h3>Stock transaction history</h3>${tx.map((t) => `<div class="kv"><span>${esc(t.date)} · ${esc(t.side)} ${num(t.quantity)}</span><b>${money(t.price)}</b></div>`).join("")}`,
  );
}
function saleForm() {
  const h = live().holdings.find((h) => h.symbol === selected);
  const lots = h.lots
    .filter((l) => l.remaining > 0)
    .sort((a, b) => a.price - b.price);
  modal(
    "Record sale · " + selected,
    `<p>After selling in Groww, record it here and choose the purchase lots for your diary.</p><form id="sale-form"><div class="form-grid">${field("Sale date", "date", "date", today(), "required")}${field("Shares sold", "quantity", "number", "", 'required min="0.000001" step="any"')}${field("Sale price per share (₹)", "price", "number", "", 'required min="0.01" step="any"')}${field("Total sale charges (₹)", "charges", "number", 0, 'required min="0" step="any"')}</div><h3>Allocate your sale</h3><p class="fine">Enter the number sold from each lot. Lowest purchase price is listed first. Allocated quantities must equal shares sold.</p>${lots.map((l) => `<label class="allocation">${esc(l.date)} · ${money(l.price)} · ${esc(l.purpose)}<small>${num(l.remaining)} available</small><input type="number" name="lot_${esc(l.id)}" data-lot="${esc(l.id)}" data-price="${l.price}" min="0" max="${l.remaining}" step="any" value="0" aria-label="Allocate from ${l.date} at ${l.price}"></label>`).join("")}<div class="row-actions"><button type="button" class="secondary" data-action="lowest">Fill lowest-price lots</button><button type="button" class="secondary" data-action="fifo">Use FIFO allocation</button></div><div id="sale-preview" class="notice">Enter the sale and lot allocation to preview your gross diary result.</div><button class="full">Confirm diary sale</button><p class="fine">This does not sell shares or change the broker’s cost basis.</p></form>`,
  );
}
function previewSale() {
  const f = $("#sale-form");
  if (!f) return;
  const data = new FormData(f);
  const q = Number(data.get("quantity")),
    p = Number(data.get("price"));
  let alloc = 0,
    cost = 0;
  f.querySelectorAll("[data-lot]").forEach((e) => {
    alloc += Number(e.value);
    cost += Number(e.value) * Number(e.dataset.price);
  });
  $("#sale-preview").textContent =
    `Allocated ${num(alloc)} of ${num(q)} shares · Gross preview ${money(alloc * p - cost)} (before charges). Final net includes allocated buy and sell charges.`;
}
function fillLots(fifo = false) {
  const f = $("#sale-form"),
    q = Number(new FormData(f).get("quantity"));
  if (!(q > 0)) return notify("Enter the shares sold first.");
  const h = live().holdings.find((h) => h.symbol === selected);
  f.querySelectorAll("[data-lot]").forEach((e) => (e.value = 0));
  for (const allocation of allocateLots(h.lots, q, fifo)) {
    f.querySelector(`[data-lot="${CSS.escape(allocation.lotId)}"]`).value = allocation.quantity;
  }
  previewSale();
}
function addTransaction(t) {
  const v = validateTransaction(t),
    next = { ...state, transactions: [...state.transactions, v] };
  const a = analyse(next.transactions);
  if (a.errors.length) throw Error(a.errors[0].message);
  commit(next);
  close();
  notify("Saved privately on this device.");
}
function download(data, name, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function demoState() {
  const s = fresh();
  s.profile = "Explorer";
  s.onboarded = true;
  s.transactions = [
    {
      id: "demo-core",
      symbol: "RELIANCE",
      name: "Reliance Industries",
      date: "2026-09-01",
      side: "BUY",
      quantity: 10,
      price: 1300,
      charges: 0,
      purpose: "core",
    },
    {
      id: "demo-trade",
      symbol: "RELIANCE",
      name: "Reliance Industries",
      date: "2026-09-10",
      side: "BUY",
      quantity: 10,
      price: 1250,
      charges: 0,
      purpose: "trading",
    },
    {
      id: "demo-sale",
      symbol: "RELIANCE",
      date: "2026-09-12",
      side: "SELL",
      quantity: 10,
      price: 1270,
      charges: 0,
      purpose: "trading",
      allocations: [{ lotId: "demo-trade", quantity: 10 }],
    },
    {
      id: "demo-it",
      symbol: "INFY",
      name: "Infosys",
      date: "2026-09-15",
      side: "BUY",
      quantity: 8,
      price: 1420,
      charges: 10,
      purpose: "core",
    },
  ];
  s.prices = {
    RELIANCE: { price: 1270, date: today() },
    INFY: { price: 1475, date: today() },
  };
  s.cash = 5000;
  return s;
}
function duplicateKey(t) {
  return [t.symbol, t.date, t.side, t.quantity, t.price, t.charges].join("|");
}
async function importFile(file, kind) {
  notify("Reading locally…");
  try {
    const p = await parseStatement(file, kind);
    pending = { ...p, kind };
    importPreview();
  } catch (e) {
    notify(e.message);
  }
}
function importPreview() {
  const p = pending;
  let warnings = (p.warnings || []).map((w) =>
    typeof w === "string" ? w : w.message || JSON.stringify(w),
  );
  modal(
    "Review your statement",
    `<div class="notice">Nothing has been saved yet. Importing ${esc(p.kind)}.${warnings.length ? `<p>${warnings.slice(0, 8).map(esc).join("<br>")}</p>` : ""}</div>${p.mappingRequired && p.headers?.length ? `<form id="mapping-form"><h3>Match your columns</h3><div class="form-grid">${(p.kind === "trades" ? ["symbol", "date", "side", "quantity", "price", "charges"] : ["symbol", "quantity", "price"]).map((k) => `<label>${k}<select name="${k}"><option value="">Choose column${k === "charges" ? " (optional)" : ""}</option>${p.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join("")}</select></label>`).join("")}</div><button>Read matched columns</button></form>` : ""}${p.text ? `<details><summary>Extracted PDF text (local only)</summary><pre>${esc(p.text.slice(0, 18000))}</pre></details>` : ""}<p><b>${p.transactions?.length || 0} transactions</b> · <b>${p.holdings?.length || 0} holdings snapshots</b></p>${p.transactions?.length ? `<p class="fine">Same-day trades follow the report’s row order. If that order is incorrect, cancel and use a chronological report.</p><div class="preview-list">${p.transactions.map((t, i) => `<div class="preview-row"><div><b>${esc(t.symbol)} · ${esc(t.side)}</b><small>${esc(t.date)} · ${num(t.quantity)} × ${money(t.price)} · Fees ${money(t.charges)}</small></div>${t.side === "BUY" ? `<select class="import-purpose" data-index="${i}" aria-label="Purpose for imported ${esc(t.symbol)}"><option value="core">Core</option><option value="trading">Trading</option></select>` : ""}</div>`).join("")}</div><p class="fine">Suspected duplicates are skipped by matching stock, date, side, quantity, price, and charges. Identical separate fills may need manual entry.</p><button class="full" data-action="confirmimport">Confirm transactions</button>` : p.holdings?.length ? `${p.holdings.map((h) => `<div class="kv"><span>${esc(h.symbol)}</span><b>${num(h.quantity)} shares</b></div>`).join("")}<button class="full" data-action="confirmimport">Save snapshot for reconciliation</button>` : '<p>No readable transactions found. Use the CSV template or add purchases manually.</p><button class="secondary" data-action="template">Download CSV template</button>'}`,
  );
}
function confirmImport() {
  const p = pending,
    next = structuredClone(state),
    seen = new Set(next.transactions.map(duplicateKey));
  let added = 0,
    skipped = 0;
  for (const t of p.transactions || []) {
    const tx = validateTransaction({
      ...t,
      purpose: t.purpose || "core",
      id: id(),
    });
    const key = duplicateKey(tx);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    next.transactions.push(tx);
    seen.add(key);
    added++;
  }
  const errors = analyse(next.transactions).errors;
  if (errors.length)
    throw Error(
      "Import not saved: " +
        errors[0].message +
        " Upload older buys first, or record the missing opening lot.",
    );
  if (p.holdings?.length)
    next.snapshots = p.holdings.map((h) => ({
      symbol: h.symbol.toUpperCase(),
      quantity: h.quantity,
      averageCost: h.avgPrice,
    }));
  next.imports.push({
    date: today(),
    kind: p.kind,
    count: added || p.holdings?.length || 0,
  });
  next.onboarded = true;
  commit(next);
  pending = null;
  close();
  notify(
    `Added ${added} trades. ${skipped} suspected duplicates skipped. ${p.holdings?.length || 0} snapshots saved.`,
  );
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,a[data-view]");
  if (!el) return;
  const v = el.dataset.view;
  if (v) {
    view = v;
    selected = "";
    query = "";
    render();
    close();
    return;
  }
  const symbol = el.dataset.stock;
  if (symbol) {
    stockDetail(symbol);
    return;
  }
  safely(() => {
    switch (el.dataset.action) {
      case "close":
        close();
        break;
      case "buy":
        buyForm();
        break;
      case "buystock":
        buyForm(selected);
        break;
      case "sell":
        saleForm();
        break;
      case "lowest":
        fillLots();
        break;
      case "fifo":
        fillLots(true);
        break;
      case "skip":
        commit({ ...state, onboarded: true });
        break;
      case "demo":
        state = demoState();
        demo = true;
        render();
        break;
      case "enddemo":
        state = load();
        demo = false;
        render();
        break;
      case "export":
        if (demo)
          return notify(
            "Demo data is not your saved diary. Exit the demo first.",
          );
        download(
          JSON.stringify(state, null, 2),
          `lotbook-backup-${today()}.json`,
        );
        break;
      case "rawbackup":
        download(
          localStorage.getItem(KEY) || "",
          `lotbook-recovery-${today()}.json`,
        );
        break;
      case "template":
        download(
          "Stock,Trade Date,Buy/Sell,Quantity,Price,Charges\nRELIANCE,01/09/2026,BUY,10,1300,0\nRELIANCE,10/09/2026,BUY,10,1250,0\n",
          "lotbook-template.csv",
          "text/csv",
        );
        break;
      case "csv":
        download(
          "Symbol,Date,Side,Quantity,Price,Charges,Purpose\n" +
            state.transactions
              .map((t) =>
                [
                  t.symbol,
                  t.date,
                  t.side,
                  t.quantity,
                  t.price,
                  t.charges,
                  t.purpose,
                ]
                  .map(csvCell)
                  .join(","),
              )
              .join("\n"),
          "lotbook-transactions.csv",
          "text/csv",
        );
        break;
      case "confirmimport":
        confirmImport();
        break;
      case "quote":
        modal(
          "Update entered price",
          `<form id="quote-form">${field("Price per share (₹)", "price", "number", state.prices[selected]?.price || "", 'required min="0.01" step="any"')}<p class="fine">This is a manual snapshot, not a live quote.</p><button>Save price</button></form>`,
        );
        break;
      case "cash":
        modal(
          "Update cash balance",
          `<form id="cash-form">${field("Available balance in Groww (₹)", "cash", "number", state.cash ?? "", 'required min="0" step="any"')}<button>Save cash balance</button></form>`,
        );
        break;
      case "undo":
        modal(
          "Undo last transaction?",
          `<p>This removes only the last entered transaction and recalculates your diary. Export first if you need a copy.</p><button class="danger" data-action="confirmundo">Undo last transaction</button>`,
        );
        break;
      case "confirmundo":
        commit({ ...state, transactions: state.transactions.slice(0, -1) });
        close();
        break;
      case "clear":
        modal(
          "Clear this device?",
          `<p>This removes your local profile, transactions, quotes, and notes. Download a backup first. No cloud copy exists.</p><button class="secondary" data-action="${loadError ? "rawbackup" : "export"}">Export first</button><form id="clear-form">${field("Type CLEAR to confirm", "confirm", "text", "", 'required pattern="CLEAR" autocomplete="off"')}<button class="danger full">Clear local diary</button></form>`,
        );
        break;
      case "install":
        if (installPrompt) {
          installPrompt.prompt();
          installPrompt.userChoice.then(() => {
            installPrompt = null;
          });
        } else
          modal(
            "Install on your phone",
            `<p><b>Android:</b> open the site in Chrome. Tap the three-dot menu → Install app or Add to Home screen.</p><p><b>iPhone:</b> open in Safari → Share → Add to Home Screen.</p><p>Already installed? Open Lotbook from your home screen. In-app browsers may not support installation.</p>`,
          );
        break;
    }
  });
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target,
    d = Object.fromEntries(new FormData(f));
  safely(() => {
    switch (f.id) {
      case "welcome-form":
        commit({ ...state, profile: d.name.trim() });
        break;
      case "profile-form":
        commit({ ...state, profile: d.name.trim() });
        notify("Name saved");
        break;
      case "buy-form":
        addTransaction({
          ...d,
          id: id(),
          symbol: d.symbol.trim().toUpperCase(),
          side: "BUY",
          quantity: +d.quantity,
          price: +d.price,
          charges: +d.charges,
        });
        break;
      case "sale-form": {
        const allocations = [...f.querySelectorAll("[data-lot]")]
          .filter((e) => Number(e.value) > 0)
          .map((e) => ({ lotId: e.dataset.lot, quantity: +e.value }));
        addTransaction({
          id: id(),
          symbol: selected,
          date: d.date,
          side: "SELL",
          purpose: "trading",
          quantity: +d.quantity,
          price: +d.price,
          charges: +d.charges,
          allocations,
        });
        break;
      }
      case "quote-form":
        commit({
          ...state,
          prices: {
            ...state.prices,
            [selected]: { price: +d.price, date: today() },
          },
        });
        close();
        break;
      case "cash-form":
        commit({ ...state, cash: +d.cash });
        close();
        break;
      case "note-form":
        commit({ ...state, notes: { ...state.notes, [today()]: d.note } });
        notify("Decision note saved");
        break;
      case "clear-form":
        if (d.confirm === "CLEAR") {
          localStorage.removeItem(KEY);
          state = fresh();
          demo = false;
          loadError = "";
          view = "holdings";
          render();
          close();
        }
        break;
      case "mapping-form":
        pending = {
          ...parseRows(
            [pending.headers, ...pending.rows],
            pending.kind,
            Object.fromEntries(
              Object.entries(d)
                .filter(([, v]) => v !== "")
                .map(([k, v]) => [k, Number(v)]),
            ),
          ),
          kind: pending.kind,
        };
        importPreview();
        break;
    }
  });
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    query = e.target.value;
    const start = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(start, start);
  }
  if (e.target.closest("#sale-form")) previewSale();
});
document.addEventListener("change", async (e) => {
  if (e.target.classList.contains("statement")) {
    const f = e.target.files[0];
    if (f) await importFile(f, e.target.dataset.kind);
    e.target.value = "";
  }
  if (e.target.classList.contains("lot-purpose"))
    safely(() => {
      const next = structuredClone(state),
        t = next.transactions.find((t) => t.id === e.target.dataset.id);
      t.purpose = e.target.value;
      commit(next);
      stockDetail(selected);
    });
  if (e.target.classList.contains("import-purpose"))
    pending.transactions[+e.target.dataset.index].purpose = e.target.value;
  if (e.target.id === "restore") {
    try {
      const file = e.target.files[0];
      if (!file || file.size > 15000000)
        throw Error("Select a JSON backup smaller than 15 MB.");
      const next = validateBackup(JSON.parse(await file.text()));
      modal(
        "Restore this diary?",
        `<p>This replaces the diary on this device with ${esc(next.profile)}’s ${next.transactions.length} transactions. Export the current diary before restoring.</p><button id="do-restore">Restore validated backup</button>`,
      );
      $("#do-restore").addEventListener("click", () =>
        safely(() => {
          save(next);
          state = next;
          demo = false;
          loadError = "";
          close();
          render();
          notify("Backup restored");
        }),
      );
    } catch (err) {
      notify(err.message);
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
  if (e.key === "Tab" && $("#modal-root .dialog")) {
    const items = [
      ...$("#modal-root").querySelectorAll("button,input,select,textarea,a"),
    ].filter((el) => !el.disabled);
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    try {
      state = load();
      render();
      notify("Diary updated from another tab.");
    } catch {
      notify("Another tab changed the diary. Reload before continuing.");
    }
  }
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => {
      reg.update();
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!window.__updated) {
          window.__updated = true;
          notify("App updated. Your diary is preserved.");
        }
      });
    })
    .catch(() =>
      notify("Offline setup unavailable. The app still works online."),
    );
}
render();
