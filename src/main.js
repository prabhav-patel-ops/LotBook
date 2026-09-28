import "./style.css";
import { analyse, validateTransaction, orderedTransactions } from "./ledger.js";
import { parseStatement, parseRows } from "./importer.js";
import { fresh, load, saveIfUnchanged, validateBackup, KEY } from "./storage.js";
import { csvCell, allocateLots } from "./ui-logic.js";
import { planTransactions, normalizeSnapshots, reconcileHoldings } from "./import-workflow.js";
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
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  id = () => crypto.randomUUID(),
  tone = (v) => (v >= 0 ? "positive" : "negative");
let state,
  loadError = "",
  view = "holdings",
  query = "",
  selected = "",
  pending = null,
  installPrompt = null,
  demo = false,
  baselineRaw = null,
  stale = false,
  updateReady = false,
  importRun = 0;
try {
  baselineRaw = localStorage.getItem(KEY);
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
  saveIfUnchanged(next, baselineRaw);
  baselineRaw = localStorage.getItem(KEY);
  state = validateBackup(next);
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
    const dialog = $("#modal-root .dialog");
    if (dialog) {
      let error = dialog.querySelector('[role="alert"]');
      if (!error) { error = document.createElement('p'); error.className = 'notice error'; error.setAttribute('role','alert'); dialog.querySelector('.dialog-title').after(error); }
      error.textContent = e.message;
    }
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
  renderStatus();
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
  <footer>Private by design <span>·</span> Saved on this device <span>·</span> No broker connection <span>·</span> v${__APP_VERSION__}</footer></main></div><nav class="mobile-nav">${Object.entries(
    icons,
  )
    .map(
      ([v, i]) =>
        `<button data-view="${v}" class="${view === v ? "active" : ""}"><span>${i}</span>${{ holdings: "Holdings", cycles: "Cycles", diary: "Diary", import: "Import", settings: "Settings" }[v]}</button>`,
    )
    .join("")}</nav>`;
}
function renderStatus() {
  let banner = $('#app-status');
  if (!banner) { banner = document.createElement('div'); banner.id = 'app-status'; document.body.prepend(banner); }
  banner.innerHTML = stale ? '<div class="notice error">This diary changed in another tab. Your open form has not been saved. <button data-action="refresh">Refresh saved diary</button></div>' : updateReady ? '<div class="notice">An app update is ready. Finish your open form, then refresh. Your saved diary stays on this device. <button data-action="refresh">Refresh app</button></div>' : '';
}
function welcome() {
  $("#app").innerHTML =
    `<div class="welcome-wrap"><section class="welcome-art"><div class="brand"><span class="logo light">L</span> Lotbook</div><div class="eyebrow">YOUR SHARES. YOUR STORY.</div><h1>Know the story<br>behind every trade.</h1><p>A personal space for your core holdings,<br>trading cycles, and everything in between.</p><div class="paper"><span class="eyebrow">A LITTLE LOT CLARITY</span><div class="paper-row">Core holding <b>10 shares · ₹1,300</b></div><div class="paper-row">Trading purchase <b>10 shares · ₹1,250</b></div><div class="paper-row">Trading sale <b>10 shares · ₹1,270</b></div><div class="paper-result">One completed cycle <strong>+₹200</strong></div><small>Synthetic example · before charges</small></div><p class="privacy">● Local storage. No uploads to a server.</p></section><section class="welcome-form"><span class="step-label">LET’S MAKE THIS YOURS</span><h2>Welcome to Lotbook.</h2><p>Your diary starts with a name.<br>No passwords. No broker credentials.</p><form id="welcome-form"><label>Your name<input name="name" maxlength="60" placeholder="What should we call you?" autocomplete="given-name" required></label><button class="full">Start my diary →</button></form><p class="fine">This is a local profile, not an authenticated account. Anyone with access to this browser can open it.</p><button class="text-button" data-action="demo">Explore a sample diary</button></section></div>`;
}
function stats(a) {
  const enteredValue = a.totals.unpriced && a.holdings.every(h => h.currentPrice === null) ? null : a.totals.currentValue;
  return `<div class="stats"><div class="stat-card featured"><span>Holdings cost</span><strong>${money(a.totals.invested)}</strong><small>Cost of remaining purchase lots</small></div><div class="stat-card"><span>Value at entered prices</span><strong>${money(enteredValue)}</strong><small>${a.totals.unpriced ? "Incomplete · missing prices: " + a.totals.unpriced : "Manual prices · not a live feed"}</small></div><div class="stat-card"><span>Result after recorded costs</span><strong class="${tone(a.totals.realizedNet)}">${money(a.totals.realizedNet)}</strong><small>Selected lots · ${a.cycles.length} closures · before income tax</small></div><div class="stat-card"><span>Diary FIFO comparison</span><strong class="${tone(a.totals.fifoNet)}">${money(a.totals.fifoNet)}</strong><small>Diary comparison · not verified broker / tax FIFO</small></div></div>${a.totals.unknownCharges?`<div class="notice">Charges are unknown for ${a.totals.unknownCharges} transactions. Results after recorded costs are provisional; enter actual costs in Diary. Legacy zero charges remain unknown until verified.</div>`:'<p class="fine">Results include only recorded transaction costs, before personal income tax. Verify cost coverage independently.</p>'}`;
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
  if (!state.snapshots.length && !state.snapshotComplete) return "";
  const cutoff=state.snapshotDate;
  const rows=reconcileHoldings(state.transactions.filter(t=>!cutoff||t.date<=cutoff),state.snapshots,{complete:state.snapshotComplete});
  const diffs=rows.filter(r=>Math.abs(r.difference)>1e-8);
  return `<section class="panel mini"><h2>Broker snapshot &amp; diary reconciliation</h2><p>${state.snapshotComplete?'Complete list':'Partial list · only supplied stocks checked'} · ${cutoff?`As of ${esc(cutoff)}`:'Undated snapshot · verify its date'}</p><p>${diffs.length?`${diffs.length} quantity differences need review. Retrieve missing history; snapshots never create purchases.`:'Supplied quantities match the diary at this date. This does not prove complete history or correct cost basis.'}</p>${rows.map(r=>`<div class="kv"><span><b>${esc(r.symbol)}</b><small>Broker average ${money(r.averageCost)}</small></span><span>Snapshot ${num(r.reported)} · Diary ${num(r.actual)}<small class="${r.difference?'negative':''}">Difference ${num(r.difference)}</small></span></div>`).join('')}<p class="fine">Broker averages and diary averages have different bases. Groww may exclude same-day activity; chosen lots and recorded buy charges also affect diary cost. Check transfers, splits, bonuses and settlement cut-offs separately.</p><button class="secondary" data-action="snapshot">Enter / replace snapshot manually</button></section>`;
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
          `<section class="panel"><div class="panel-title"><h2>${esc(m)}</h2><b class="${tone(a.monthlyResults.find(r=>r.month===m).net)}">${money(a.monthlyResults.find(r=>r.month===m).net)}</b></div>${cs.map((c) => `<div class="cycle-row"><div><b>${esc(c.symbol)}</b><span class="tag">${esc(c.purpose)}</span><small>${esc(c.buyDate)} → ${esc(c.sellDate)} · ${num(c.quantity)} shares · ${c.holdingDays} days</small></div><div><small>Entry ${money(c.buyPrice)} → Exit ${money(c.sellPrice)}</small><small>Gross ${money(c.gross)} · Charges ${money(c.charges)}</small><b class="${tone(c.net)}">After recorded costs ${money(c.net)}${!c.chargesKnown?" · provisional":""}</b></div></div>`).join("")}</section>`,
      )
      .join("") ||
    '<section class="panel empty"><h3>No closed cycles yet</h3><p>Record a sale from a stock’s purchase-lot view to create your first cycle.</p></section>'
  }`;
}
function diary(a) {
  const tx = orderedTransactions(state.transactions).reverse();
  return `<section class="panel mini"><h2>Today’s decision note</h2><form id="note-form"><label>What did you learn or plan?<textarea name="note" maxlength="3000" placeholder="Why did I enter? What would make me exit?">${esc(state.notes[today()] || "")}</textarea></label><button>Save note</button></form></section><section class="panel"><div class="panel-title"><h2>Transaction history</h2><span>${tx.length} entries</span></div>${tx.map((t, i) => `<div class="history-row"><span class="side ${t.side.toLowerCase()}">${esc(t.side)}</span><div><b>${esc(t.symbol)}</b><small>${esc(t.date)} ${esc(t.tradeTime||"")} · ${num(t.quantity)} × ${money(t.price)} · Charges ${t.chargesKnown?money(t.charges):"unknown"}</small>${t.note ? `<small>${esc(t.note)}</small>` : ""}</div><span class="tag">${t.side === "BUY" ? esc(t.purpose) : "Diary sale"}</span><div class="row-actions"><button class="text-button" data-action="history" data-id="${esc(t.id)}">History</button><button class="text-button" data-action="charges" data-id="${esc(t.id)}">Costs</button>${t.side==="SELL"?`<button class="text-button" data-action="allocation" data-id="${esc(t.id)}">Match lots</button>`:""}${t.id===state.transactions.at(-1)?.id?'<button class="text-button danger" data-action="undo">Undo last entered</button>':""}</div></div>`).join("") || '<div class="empty">Your imports and manual transactions will appear here.</div>'}</section>${Object.entries(
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
function chargesForm(transactionId) {
  const t=state.transactions.find(t=>t.id===transactionId);
  if(!t)throw Error('This transaction is no longer available. Refresh the diary.');
  selected=t.id;
  modal('Review recorded costs',`<p>${esc(t.symbol)} · ${esc(t.side)} · ${esc(t.date)} · ${num(t.quantity)} shares. Use actual contract-note costs. Do not enter the same day/order charge on several fills.</p><form id="charges-form">${field('Recorded total charges (₹)','charges','number',t.chargesKnown?t.charges:'','min="0" step="any"')}<p class="fine">Leave blank for unknown. Enter 0 only for verified zero. Results stay before personal income tax.</p><button type="submit">Save recorded costs</button></form>`);
}
function snapshotForm() {
  modal('Enter holdings snapshot',`<p>Copy the broker's quantities, not new purchases. Enter one stock per line: <b>SYMBOL, quantity, average buy price</b>. Average price is optional. This replaces the previous snapshot only after validation.</p><form id="snapshot-form"><label>Holdings rows<textarea name="rows" rows="6" placeholder="ABC, 10, 1250\nXYZ, 5" required>${esc(state.snapshots.map(s=>[s.symbol,s.quantity,s.averageCost??''].join(', ')).join('\n'))}</textarea></label>${field('Snapshot as-of date','date','date',state.snapshotDate||today(),'required')}<label class="check-label"><input type="checkbox" name="complete" ${state.snapshotComplete?'checked':''}>Complete list for this account (unlisted stocks mean zero)</label><button>Save snapshot</button></form>`);
}
function allocationForm(transactionId) {
  const ordered=orderedTransactions(state.transactions),index=ordered.findIndex(t=>t.id===transactionId),t=ordered[index];
  if(!t||t.side!=='SELL')throw Error('Choose an existing sale.');
  const before=analyse(ordered.slice(0,index)),lots=before.holdings.find(h=>h.symbol===t.symbol)?.lots.filter(l=>l.remaining>0)||[];
  selected=t.id;
  modal('Review sale allocation',`<p>${esc(t.symbol)} · ${esc(t.date)} · ${num(t.quantity)} shares sold at ${money(t.price)}. Only lots available before this sale are shown.</p><form id="allocation-form"><input type="hidden" name="quantity" value="${t.quantity}">${lots.map(l=>`<label class="allocation">${esc(l.date)} · ${money(l.price)} · ${esc(l.purpose)}<small>${num(l.remaining)} available at this sale</small><input type="number" data-lot="${esc(l.id)}" data-price="${l.price}" data-date="${l.date}" min="0" max="${l.remaining}" step="any" value="${t.allocations?.find(a=>a.lotId===l.id)?.quantity||0}" aria-label="Match sale to ${esc(l.date)} at ${l.price}"></label>`).join('')}<div class="row-actions"><button type="button" class="secondary" data-action="editlowest">Fill lowest-price lots</button><button type="button" class="secondary" data-action="editfifo">Fill FIFO lots</button></div><p class="fine">Allocated quantities must equal the sale. Later sales are replayed too; a correction that breaks their chosen lots is rejected without changing your diary. Broker records and FIFO comparison do not change.</p><button type="submit">Save diary allocation</button></form>`);
}
function fillHistoricalLots(fifo) {
  const f=$('#allocation-form');
  const lots=[...f.querySelectorAll('[data-lot]')].map(e=>({id:e.dataset.lot,date:e.dataset.date,price:+e.dataset.price,remaining:+e.max}));
  f.querySelectorAll('[data-lot]').forEach(e=>e.value=0);
  for(const a of allocateLots(lots,+new FormData(f).get('quantity'),fifo))f.querySelector(`[data-lot="${CSS.escape(a.lotId)}"]`).value=a.quantity;
}
function uploadPage(first) {
  $("#app").innerHTML =
    `<main class="onboarding"><div class="brand"><span class="logo">L</span> Lotbook</div><div class="step-label">STEP 2 OF 2 · YOUR HISTORY</div><h1>Bring your investing story.</h1><p>Hi ${esc(state.profile)}. Start with your Groww reports, or build the diary manually.</p>${uploadContent()}<button class="secondary full" data-action="skip">Start with an empty diary →</button></main>`;
}
function uploadContent() {
  return `<div class="upload-grid"><section class="panel mini"><span class="step-number">01</span><h2>Order / trade history</h2><p><b>Required for a full history.</b> Export equity buys and sells for the entire period from Groww → Profile → Reports → Transactions → select the report and time frame → Download. Look for Stocks Order History; prefer an unprotected Excel or CSV file.</p><label class="upload-target">⇧ <b>Choose trade statement</b><small>CSV · XLSX · XLS · PDF · up to 15 MB</small><input type="file" class="statement" data-kind="trades" accept=".csv,.xlsx,.xls,.pdf"></label></section><section class="panel mini"><span class="step-number">02</span><h2>Current holdings</h2><p><b>Recommended to reconcile.</b> Look for Stock Holding Statement in Groww Reports. Use stock and quantity; average price is optional. It checks the history; it does not add duplicate purchases.</p><label class="upload-target">⇧ <b>Choose holdings statement</b><small>CSV · XLSX · XLS · PDF</small><input type="file" class="statement" data-kind="holdings" accept=".csv,.xlsx,.xls,.pdf"></label><button class="secondary" data-action="snapshot">Enter holdings manually</button></section></div><div class="notice"><b>Getting the right history</b><p>Use all relevant periods. A P&amp;L summary alone cannot reconstruct purchase lots. Dividends, corporate actions, transfers, F&amp;O, mutual funds and short positions are outside this equity MVP. Add an opening purchase lot when older history is unavailable, and label it in the note.</p><p>Contract notes show charges. Enter charges per transaction if your trade report omits them. PDF layouts vary; extracted text stays local and Excel is more reliable.</p><a href="https://groww.in/help/my-account/ma-others/where-can-i-get-the-transaction-history" target="_blank" rel="noopener noreferrer">Groww’s report instructions ↗</a></div>${
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
  return `<div class="two-col"><section class="panel mini"><h2>Your local profile</h2><form id="profile-form"><label>Name<input name="name" value="${esc(state.profile)}" maxlength="60" required></label><button>Save name</button></form><p>A convenience profile on this browser. No password or cloud account.</p></section><section class="panel mini"><h2>Install Lotbook</h2><p>On Android, open this site in Chrome and use Install app or the menu → Add to Home screen. On iPhone use Safari → Share → Add to Home Screen.</p><button data-action="install">Install / instructions</button><small>Install prompts depend on your browser. Offline use works after the app has loaded online.</small></section><section class="panel mini"><h2>Keep a backup</h2><p>Export a JSON diary for another device. Import replaces this diary only after validation and confirmation.</p><button data-action="export">Export backup</button><label class="button secondary">Import backup<input type="file" id="restore" accept=".json" hidden></label><button class="text-button" data-action="csv">Export transactions CSV</button></section><section class="panel mini"><h2>Privacy &amp; data</h2><p>Parsed records live in this browser’s local storage. Statements are processed in memory and are never sent to our servers or GitHub. No analytics, external fonts, ads, broker API, or AI service.</p><p>Public GitHub hosts the app files and receives ordinary web requests. It does not receive your name or financial records. Shared devices and browser clearing can expose or erase local data.</p><button class="danger secondary" data-action="clear">Clear all local data</button></section></div><section class="panel mini"><h2>App updates · v${__APP_VERSION__}</h2><p>After changes are published, refresh to load the latest app. Export before changing browsers or clearing website data.</p><button data-action="checkupdate">Check for app update</button><button class="secondary" data-action="refresh">Refresh app</button></section><section class="panel mini"><h2>Understand the numbers</h2><p>Selecting a purchase lot changes realised and unrealised attribution in your diary. It does not change the shares actually sold through Groww, broker FIFO records, or total wealth. Verify charges and broker records independently. Current prices and cash are manually entered and can become stale.</p><a href="./guide.html" target="_blank">Read the app flow and limitations ↗</a></section>`;
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
    `<p>Record a purchase made in your broker account. This creates a diary lot.</p><form id="buy-form"><div class="form-grid">${field("Stock symbol or name", "symbol", "text", symbol, 'required maxlength="80" placeholder="e.g. RELIANCE"')}${field("Purchase date", "date", "date", today(), "required")}${field("Shares purchased", "quantity", "number", "", 'required min="0.000001" step="any"')}${field("Price per share (₹)", "price", "number", "", 'required min="0.01" step="any"')}${field("Recorded buy charges (₹, optional)", "charges", "number", "", 'min="0" step="any" placeholder="Blank = unknown"')}<label>Purpose<select name="purpose"><option value="core">Core / long-term</option><option value="trading">Trading cycle</option></select></label></div><label>Note (optional)<textarea name="note" maxlength="500" placeholder="Your entry reason, or opening balance if history is missing"></textarea></label><button class="full">Save purchase</button><p class="fine">No order is sent to Groww. Symbols are matched exactly after converting to uppercase.</p></form>`,
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
    `<p>After selling in Groww, record it here and choose the purchase lots for your diary.</p><form id="sale-form"><div class="form-grid">${field("Sale date", "date", "date", today(), "required")}${field("Shares sold", "quantity", "number", "", 'required min="0.000001" step="any"')}${field("Sale price per share (₹)", "price", "number", "", 'required min="0.01" step="any"')}${field("Recorded sale charges (₹, optional)", "charges", "number", "", 'min="0" step="any" placeholder="Blank = unknown"')}</div><h3>Allocate your sale</h3><p class="fine">Enter the number sold from each lot. Lowest purchase price is listed first. Allocated quantities must equal shares sold.</p>${lots.map((l) => `<label class="allocation">${esc(l.date)} · ${money(l.price)} · ${esc(l.purpose)}<small>${num(l.remaining)} available</small><input type="number" name="lot_${esc(l.id)}" data-lot="${esc(l.id)}" data-price="${l.price}" min="0" max="${l.remaining}" step="any" value="0" aria-label="Allocate from ${l.date} at ${l.price}"></label>`).join("")}<div class="row-actions"><button type="button" class="secondary" data-action="lowest">Fill lowest-price lots</button><button type="button" class="secondary" data-action="fifo">Use FIFO allocation</button></div><div id="sale-preview" class="notice">Enter the sale and lot allocation to preview your gross diary result.</div><button class="full">Confirm diary sale</button><p class="fine">This does not sell shares or change the broker’s cost basis.</p></form>`,
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
async function importFile(file, kind) {
  const run = ++importRun;
  notify("Reading locally…");
  try {
    const p = await parseStatement(file, kind);
    if(run!==importRun)return;
    pending = { ...p, kind };
    importPreview();
  } catch (e) {
    if(run===importRun)modal('Statement could not be read',`<p class="notice error" role="alert">${esc(e.message)}</p><p>Nothing was saved. Use an unprotected CSV/XLSX export, or the template below. PDF text is a local reference, not a reliable transaction table.</p><button data-action="template">Download trade template</button>`);
  }
}
function importPreview() {
  const p = pending;
  const warnings = (p.warnings || []).map((w) =>
    typeof w === "string" ? w : w.message || JSON.stringify(w),
  );
  const plan=p.transactions?.length?planTransactions(state.transactions,p.transactions):null;
  const blockers=[...(p.blockingErrors||[]),...(plan?.conflicts||[]),...(plan?.errors||[]).map(e=>e.message)];
  const labels={symbol:'Stock symbol',date:'Execution date',side:'Buy / sell',quantity:'Quantity',price:p.kind==='holdings'?'Average buy price (optional)':'Price per share (optional if total value)',tradeValue:'Gross total trade value (optional if price)',charges:'Total charges (optional)',companyName:'Company name (optional)',isin:'ISIN (optional)',tradeTime:'Execution time (optional)',tradeQuantity:'Executed quantity (optional)',status:'Order status (optional)',exchange:'Exchange (optional)',orderId:'Order ID (optional)',exchangeOrderId:'Exchange order ID (optional)',tradeId:'Trade / execution ID (optional)'};
  const fields=p.kind==='trades'?['symbol','date','side','quantity','price','tradeValue','charges','companyName','isin','tradeTime','tradeQuantity','status','exchange','orderId','exchangeOrderId','tradeId']:['symbol','quantity','price','isin'];
  const mapping=!p.fatal&&p.headers?.length?`<details ${p.mappingRequired?'open':''}><summary>Review or change column mapping</summary><form id="mapping-form"><div class="form-grid">${fields.map(k=>`<label>${labels[k]}<select name="${k}"><option value="">Not supplied</option>${p.headers.map((h,i)=>`<option value="${i}" ${p.columns?.[k]===i?'selected':''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div><button>Read matched columns</button></form></details>`:'';
  const issues=(p.rowIssues||[]).length;
  const valueBasis=p.transactions?.some(t=>t.priceSource==='trade-value');
  modal(
    "Review your statement",
    `<div class="notice">Nothing has been saved yet. ${p.selectedSheet?`Worksheet: <b>${esc(p.selectedSheet)}</b>. `:''}Review the ${esc(p.kind)} below.</div>${warnings.length?`<details open><summary>${warnings.length} warnings · ${issues} rows need review</summary><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}${blockers.length?`<div class="notice error" role="alert"><b>Import blocked. Nothing will be saved.</b><p>${blockers.slice(0,12).map(esc).join('<br>')}</p><p>Correct the report or upload the missing older purchases. Do not invent a backdated purchase from today's holdings.</p></div>`:''}${mapping}${p.text?`<details><summary>Extracted PDF text (local only)</summary><pre>${esc(p.text.slice(0,18000))}</pre></details>`:''}<p><b>${p.transactions?.length||0} readable transactions</b> · <b>${p.holdings?.length||0} snapshot rows</b></p>${plan?`<div class="notice"><b>${plan.added} new · ${plan.skipped} matched / repeated · ${plan.updated} existing records enriched</b><p>Separate identical fills within a first upload are retained. Without execution IDs, overlapping identical trades are matched by occurrence count: review this count before confirming.</p></div><p class="fine">Same-day trades use execution times only when every trade that day has a time; otherwise source order is retained. Sale allocations and IDs on matched records are preserved.</p><div class="preview-list">${p.transactions.map((t,i)=>`<div class="preview-row"><div><b>${esc(t.symbol)} · ${esc(t.side)}</b><small>${esc(t.name||'')} · ${esc(t.date)} ${esc(t.tradeTime||'')}</small><small>${num(t.quantity)} × ${money(t.price)}${t.priceSource==='trade-value'?` · Total ${money(t.tradeValue)} ÷ quantity`:''} · Charges ${t.chargesKnown?money(t.charges):'unknown'}</small></div>${t.side==='BUY'?`<select class="import-purpose" data-index="${i}" aria-label="Purpose for imported ${esc(t.symbol)}"><option value="core" ${t.purpose!=='trading'?'selected':''}>Core</option><option value="trading" ${t.purpose==='trading'?'selected':''}>Trading</option></select>`:''}</div>`).join('')}</div><label class="check-label"><input type="checkbox" id="executed-confirm">This report contains actual executed equity trades, not pending orders.</label>${valueBasis?'<label class="check-label"><input type="checkbox" id="value-confirm">Value is the gross total for the executed quantity, excluding charges. I checked a source entry.</label>':''}${issues?'<label class="check-label"><input type="checkbox" id="issues-confirm">I reviewed the excluded rows and understand this import may be incomplete.</label>':''}<button class="full" data-action="confirmimport" ${p.fatal||blockers.length?'disabled':''}>Confirm transactions</button>`:p.holdings?.length?`${p.holdings.map(h=>`<div class="kv"><span>${esc(h.symbol)}</span><b>${num(h.quantity)} shares · Broker average ${money(h.avgPrice)}</b></div>`).join('')}${field('Snapshot as-of date','snapshotDate','date',today(),'id="snapshot-date" required')}<label class="check-label"><input type="checkbox" id="snapshot-complete">This is the complete holdings list for this account (missing stocks mean zero).</label><p class="fine">Leave unchecked for a partial list. No purchase history is created from this snapshot.</p>${issues?'<label class="check-label"><input type="checkbox" id="issues-confirm">I reviewed the excluded rows. The remaining snapshot may be incomplete.</label>':''}<button class="full" data-action="confirmimport" ${p.fatal||blockers.length?'disabled':''}>Save snapshot for reconciliation</button>`:'<p>No readable records found. Try a compatible CSV/XLSX report or the template.</p><button class="secondary" data-action="template">Download trade template</button>'}`,
  );
}
function confirmImport() {
  const p=pending,next=structuredClone(state);
  if(!p||p.fatal||p.blockingErrors?.length)throw Error('This statement cannot be confirmed. Correct the source file and retry.');
  if($('#issues-confirm')&&!$('#issues-confirm').checked)throw Error('Review and acknowledge the excluded rows first.');
  let added=0,skipped=0,updated=0;
  if(p.transactions?.length){
    if(!$('#executed-confirm')?.checked)throw Error('Confirm that these are executed equity trades.');
    if($('#value-confirm')&&!$('#value-confirm').checked)throw Error('Verify that Value is gross executed value, excluding charges, then confirm its basis.');
    const plan=planTransactions(state.transactions,p.transactions);
    if(plan.conflicts.length||plan.errors.length)throw Error('Import not saved: '+(plan.conflicts[0]||plan.errors[0].message));
    next.transactions=plan.transactions;({added,skipped,updated}=plan);
  }
  if(p.holdings?.length){
    const date=$('#snapshot-date')?.value;
    if(!date)throw Error('Enter the snapshot as-of date.');
    next.snapshots=normalizeSnapshots(p.holdings,next.transactions);
    next.snapshotComplete=$('#snapshot-complete')?.checked===true;
    next.snapshotDate=date;
  }
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
    `Added ${added} trades. ${skipped} matched / repeated. ${updated} enriched. ${p.holdings?.length||0} snapshot rows saved.`,
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
      case "editlowest":
        fillHistoricalLots(false);
        break;
      case "editfifo":
        fillHistoricalLots(true);
        break;
      case "snapshot":
        snapshotForm();
        break;
      case "charges":
        chargesForm(el.dataset.id);
        break;
      case "allocation":
        allocationForm(el.dataset.id);
        break;
      case "history": {
        const t=state.transactions.find(t=>t.id===el.dataset.id);
        if(!t)throw Error('This transaction is no longer available.');
        modal(`${t.symbol} · transaction details`,`<div class="kv"><span>Date / time</span><b>${esc(t.date)} ${esc(t.tradeTime||'time unknown')}</b></div><div class="kv"><span>Side / quantity</span><b>${esc(t.side)} · ${num(t.quantity)}</b></div><div class="kv"><span>Price / total</span><b>${money(t.price)} · ${money(t.price*t.quantity)}</b></div><div class="kv"><span>Recorded costs</span><b>${t.chargesKnown?money(t.charges):'Unknown'}</b></div>${t.isin?`<div class="kv"><span>ISIN</span><b>${esc(t.isin)}</b></div>`:''}${t.exchange?`<div class="kv"><span>Exchange</span><b>${esc(t.exchange)}</b></div>`:''}${t.exchangeOrderId?`<div class="kv"><span>Exchange order ID</span><b>${esc(t.exchangeOrderId)}</b></div>`:''}${t.tradeId?`<div class="kv"><span>Trade ID</span><b>${esc(t.tradeId)}</b></div>`:''}<p class="fine">These details stay in this browser and in your exported JSON backup.</p>`);
        break;
      }
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
        selected = state.transactions.at(-1)?.id || "";
        modal(
          "Undo last transaction?",
          `<p>This removes the last entered record (${esc(state.transactions.at(-1)?.symbol||'none')} on ${esc(state.transactions.at(-1)?.date||'')}) and recalculates your diary. If later records depend on it, the change will be rejected.</p><button class="danger" data-action="confirmundo">Undo last entered transaction</button>`,
        );
        break;
      case "confirmundo":
        commit({ ...state, transactions: state.transactions.slice(0, -1) });
        close();
        break;
      case "refresh":
        location.reload();
        break;
      case "checkupdate":
        navigator.serviceWorker?.getRegistration().then(reg=>reg?.update()).then(()=>notify('Update check complete. A refresh option will appear when a new version is ready.'));
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
          charges: d.charges===""?0:+d.charges,
          chargesKnown: d.charges!=="",
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
          charges: d.charges===""?0:+d.charges,
          chargesKnown: d.charges!=="",
          allocations,
        });
        break;
      }
      case "charges-form": {
        const next=structuredClone(state),t=next.transactions.find(t=>t.id===selected);
        if(!t)throw Error('This transaction changed. Refresh and try again.');
        t.charges=d.charges===""?0:+d.charges;
        t.chargesKnown=d.charges!=="";
        commit(next);close();notify('Recorded costs updated.');
        break;
      }
      case "allocation-form": {
        const next=structuredClone(state),t=next.transactions.find(t=>t.id===selected);
        if(!t)throw Error('This sale changed. Refresh and try again.');
        t.allocations=[...f.querySelectorAll('[data-lot]')].filter(e=>+e.value>0).map(e=>({lotId:e.dataset.lot,quantity:+e.value}));
        validateTransaction(t);
        const checked=analyse(next.transactions);
        if(checked.errors.length)throw Error('Allocation not saved: '+checked.errors[0].message);
        commit(next);close();notify('Diary lot allocation updated.');
        break;
      }
      case "snapshot-form": {
        const rows=d.rows.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{
          const cells=line.split(',').map(cell=>cell.trim());
          if(cells.length<2||cells.length>3)throw Error(`Snapshot line ${index+1} must be SYMBOL, quantity, optional average price.`);
          return {symbol:cells[0],quantity:cells[1],avgPrice:cells[2]||null};
        });
        const snapshots=normalizeSnapshots(rows,state.transactions);
        commit({...state,snapshots,snapshotDate:d.date,snapshotComplete:d.complete==='on'});
        close();notify('Holdings snapshot saved for reconciliation.');
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
          if(localStorage.getItem(KEY)!==baselineRaw)throw Error('This diary changed in another tab. Refresh before clearing it.');
          localStorage.removeItem(KEY);
          baselineRaw = null;
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
            pending,
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
          saveIfUnchanged(next,baselineRaw);
          baselineRaw=localStorage.getItem(KEY);
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
  if (e.key === KEY || e.key === null) {
    stale = true;
    pending = null;
    importRun++;
    close();
    renderStatus();
    notify("Another tab changed this diary. Refresh before saving.");
  }
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const hadController=Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`,{updateViaCache:'none'})
    .then((reg) => {
      reg.update();
      const ready=worker=>{ if(!worker)return; worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller){updateReady=true;renderStatus();}}); };
      ready(reg.installing);
      reg.addEventListener('updatefound',()=>ready(reg.installing));
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!window.__updated) {
          window.__updated = true;
          if(hadController){updateReady = true;renderStatus();}
        }
      });
    })
    .catch(() =>
      notify("Offline setup unavailable. The app still works online."),
    );
}
render();
