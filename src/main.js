import "./style.css";
import "./refinement.css";
import { analyse, validateTransaction, orderedTransactions, removePurchaseTransaction } from "./ledger.js";
import { parseStatement, parseRows } from "./importer.js";
import { parseReferenceStatement, summarizeReferenceEntries } from "./reference-reports.js";
import { fresh, load, saveIfUnchanged, validateBackup, KEY } from "./storage.js";
import { csvCell, allocateLots, growwInvestedSummary, holdingPriceSignal, holdingReturnPercent, selectHoldings } from "./ui-logic.js";
import { selectDiaryEntries } from "./diary-view.js";
import { prepareTradeReplacement, applyVerifiedCorporateActions, normalizeSnapshots, reconcileHoldings, suspectedShareAdjustmentSymbols } from "./import-workflow.js";
import { MARKET_KEY, MARKET_CACHE_KEY, MARKET_INTERVAL_KEY, marketIntervalMs, marketTicker, readMarketCache, usableMarketQuote, resolveHoldingPrice, fetchIndianQuote, fetchYahooBatchQuotes, fetchVerifiedShareEvents } from "./market-data.js";
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
    : state?.privacyMode
      ? "••••"
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
  holdingMetric = "pnl",
  holdingPosition = "all",
  holdingSort = "name",
  holdingSortDirection = "asc",
  selected = "",
  pending = null,
  installPrompt = null,
  demo = false,
  baselineRaw = null,
  stale = false,
  updateReady = false,
  importRun = 0;
let diaryTab = 'activity', diaryQuery = '', diaryKind = 'all', diaryMonth = '', diaryLimit = 30, noteDraft = null, modalReturnFocus = null;
let pendingPurchaseDeleteId = '';
const displayDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
let marketQuotes = readMarketCache(localStorage),
  marketRefreshing = false,
  marketMessage = "",
  marketLastAttempt = 0,
  marketAttempts = {};
const ACTION_CHECK_KEY = 'lotbook.share-check.v1';
let actionRefreshing = false,
  actionMessage = '';
try {
  baselineRaw = localStorage.getItem(KEY);
  state = load();
} catch (e) {
  state = fresh();
  loadError =
    "Your saved diary could not be read. It has not been overwritten. Export the stored file below, then restore a valid backup. " +
    e.message;
}
const priceFor = (symbol) => resolveHoldingPrice(symbol, state.prices, marketQuotes, true);
const live = () => analyse(state.transactions, Object.fromEntries(
  [...new Set([...Object.keys(state.prices), ...Object.keys(marketQuotes)])]
    .filter(symbol => priceFor(symbol) != null).map(symbol => [symbol, priceFor(symbol)]),
));
const quoteDetail = symbol => {
  const quote = marketQuotes[symbol];
  if (usableMarketQuote(quote)) {
    const marketTime = quote.marketAt || quote.fetchedAt;
    const when = new Date(marketTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const old = Date.now() - Date.parse(marketTime) > 24 * 60 * 60 * 1000;
    return `${old ? 'Older quote · ' : ''}${quote.source || 'IndianAPI'} · ${quote.marketAt?'market':'fetched'} ${when}${quote.marketAt?'':' · market time unverified'}`;
  }
  return state.prices[symbol] ? `Manual · entered ${state.prices[symbol].date || 'date unknown'}` : 'No price available';
};
const holdingMetricText = holding => {
  if (holdingMetric === 'pnl') return money(holding.unrealized);
  const value = holdingReturnPercent(holding.cost, holding.unrealized);
  return value === null ? '—' : state.privacyMode ? '••••' : `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(value)}%`;
};
const holdingPriceSignalText = holding => {
  const signal = holdingPriceSignal(holding);
  if (signal.status === 'unknown') return {status:'unknown', text:''};
  if (signal.status === 'above') return {status:'above', text:`Above lowest buy · +${money(signal.difference)} vs ${money(signal.lowestPrice)}`};
  if (signal.status === 'below') return {status:'not-above', text:`Below lowest buy · −${money(Math.abs(signal.difference))} vs ${money(signal.lowestPrice)}`};
  return {status:'not-above', text:`At lowest buy · ${money(signal.lowestPrice)}`};
};
const quoteSummary = symbol => {
  const quote = marketQuotes[symbol];
  if (usableMarketQuote(quote)) {
    const date = new Date(quote.marketAt || quote.fetchedAt);
    return `${Date.now()-date.getTime()>86400000?'Older quote':'Quote'} · ${date.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}${quote.marketAt?'':' · time unverified'}`;
  }
  return state.prices[symbol] ? 'Manual price' : 'Price unavailable';
};
const commit = (next) => {
  if (loadError) throw Error("Recover your existing diary before saving.");
  if (demo)
    throw Error("Exit the sample diary before saving your own records.");
  saveIfUnchanged(next, baselineRaw);
  baselineRaw = localStorage.getItem(KEY);
  state = validateBackup(next);
  render();
  queueMicrotask(scheduleMarketRefresh);
};
const marketIsOpen = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
};
async function refreshCorporateActions(force = false) {
  if (demo || loadError || !state.onboarded || actionRefreshing || !navigator.onLine) return;
  const buys = state.transactions.filter(t => t.side === 'BUY' && !t.corporateAction);
  const earliest = new Map();
  for (const trade of buys) {
    const current = earliest.get(trade.symbol);
    if (!current || trade.date < current) earliest.set(trade.symbol, trade.date);
  }
  let checked;
  try { checked = JSON.parse(localStorage.getItem(ACTION_CHECK_KEY) || '{}'); }
  catch { checked = {}; }
  if (!checked || typeof checked !== 'object' || Array.isArray(checked)) checked = {};
  const unresolved = new Set(suspectedShareAdjustmentSymbols(state.transactions,state.snapshots,state.snapshotDate));
  const due = [...earliest].filter(([symbol]) => force || unresolved.has(symbol) || Date.now() - Number(checked[symbol] || 0) > 7 * 24 * 60 * 60 * 1000);
  if (!due.length) return;
  actionRefreshing = true;
  actionMessage = 'Checking exchange-confirmed share changes…';
  if (!$('#modal-root .dialog')) render();
  const events = [], issues = [];
  for (let index = 0; index < due.length; index += 3) {
    await Promise.all(due.slice(index, index + 3).map(async ([symbol, firstDate]) => {
      try {
        if (usableMarketQuote(marketQuotes[symbol]) && marketQuotes[symbol].exchange === 'BSE') {
          checked[symbol] = Date.now();
          return;
        }
        events.push(...await fetchVerifiedShareEvents(symbol, firstDate));
        checked[symbol] = Date.now();
      } catch (error) { issues.push(`${symbol}: ${error.message}`); }
    }));
  }
  try { localStorage.setItem(ACTION_CHECK_KEY, JSON.stringify(checked)); }
  catch { issues.push('Could not save share-check time on this device.'); }
  try {
    const result = applyVerifiedCorporateActions(state.transactions, events, state.snapshots, state.snapshotDate);
    issues.push(...result.issues);
    if (result.applied.length) commit({...state, transactions:result.transactions});
    actionMessage = result.applied.length || issues.length
      ? `${result.applied.length} verified share adjustment${result.applied.length===1?'':'s'} applied${issues.length?` · ${issues.length} need review: ${issues[0]}`:''}.`
      : '';
  } catch (error) {
    actionMessage = `Share changes were not saved: ${error.message}`;
  } finally {
    actionRefreshing = false;
    if (!$('#modal-root .dialog')) render();
  }
}
async function refreshMarket(force = false) {
  const key = localStorage.getItem(MARKET_KEY);
  if (demo || loadError || !state.profile || !state.onboarded || marketRefreshing) return;
  if (!navigator.onLine) {
    if (force) { marketMessage = 'Offline. Stored manual or recent quotes remain available.'; render(); }
    return;
  }
  const symbols = live().holdings.filter(h => h.quantity > 0).map(h => h.symbol);
  if (!symbols.length) {
    if (force) { marketMessage = 'No current equity holdings to quote yet.'; render(); }
    return;
  }
  const now = Date.now();
  const interval = marketIntervalMs(localStorage);
  const due = symbols.filter(symbol => force ||
    ((!usableMarketQuote(marketQuotes[symbol]) || now - Date.parse(marketQuotes[symbol].fetchedAt) >= interval) &&
      now - (marketAttempts[symbol] || 0) >= interval));
  if (!due.length) return;
  marketRefreshing = true;
  marketLastAttempt = now;
  marketMessage = '';
  if (!$('#modal-root .dialog')) render();
  let updated = 0;
  const errors = [];
  const holdingsBySymbol = new Map(live().holdings.map(holding => [holding.symbol, holding]));
  const batchHoldings = [];
  for (const symbol of due) {
    marketAttempts[symbol] = now;
    if (!marketTicker(symbol)) errors.push(`${symbol}: no matching market ticker`);
    else batchHoldings.push(holdingsBySymbol.get(symbol) || {symbol,name:symbol});
  }
  try {
    const result = await fetchYahooBatchQuotes(batchHoldings);
    Object.assign(marketQuotes, result.quotes);
    updated += Object.keys(result.quotes).length;
    const unresolved = result.errors.map(error => error.split(':')[0]);
    if (key && unresolved.length && localStorage.getItem(MARKET_KEY) === key) {
      const indianResults = await Promise.allSettled(unresolved.map(symbol => fetchIndianQuote(symbol, key)));
      indianResults.forEach((result, index) => {
        if (result.status === 'fulfilled') { marketQuotes[unresolved[index]] = result.value; updated++; }
        else errors.push(`${unresolved[index]}: ${result.reason?.message || 'no verified quote was returned'}`);
      });
    } else errors.push(...result.errors);
  } catch (error) { errors.push(`Batch quotes: ${error.message}`); }
  if (localStorage.getItem(MARKET_KEY) !== key) { marketRefreshing = false; return; }
  try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(marketQuotes)); }
  catch { errors.push('Could not cache quotes on this device'); }
  marketRefreshing = false;
  marketMessage = errors.length ? `${updated} updated · ${errors.length} issue(s): ${errors[0]}` : `${updated} price${updated === 1 ? '' : 's'} updated`;
  if (!$('#modal-root .dialog')) render();
}
function scheduleMarketRefresh() {
  if (!state.onboarded || demo) return;
  if (document.visibilityState !== 'visible' || $('#modal-root .dialog') ||
      document.activeElement?.matches('input, textarea, select')) return;
  if (!marketLastAttempt || marketIsOpen()) refreshMarket();
}
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
const navIcon = paths => `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  holdings: navIcon('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M9 10h12"/>'),
  cycles: navIcon('<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>'),
  diary: navIcon('<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M11 8h5M11 12h5M11 16h3"/>'),
  import: navIcon('<path d="M12 16V3m-4 4 4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>'),
  info: navIcon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  settings: navIcon('<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="10" cy="18" r="2" fill="white"/>'),
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
    info: "How LotBook works",
    settings: "Your space",
  };
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#"><span class="logo">L</span> Lotbook<span class="badge">PERSONAL</span></a><p class="side-label">YOUR INVESTING SPACE</p><nav>${Object.entries(
      icons,
    )
      .map(
        ([v, i]) =>
          `<button class="nav ${v === view ? "active" : ""}" data-view="${v}"><span>${i}</span>${{ holdings: "Holdings", cycles: "Cycles", diary: "Diary", import: "Statements", info: "Info", settings: "Settings" }[v]}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-foot"><span class="privacy-dot"></span> Private on this device<p>Your data stays with you.</p><a href="./guide.html" target="_blank" rel="noopener">How Lotbook works ↗</a></div></aside>
  <div class="workspace"><header><div class="mobile-brand"><span class="logo">L</span> Lotbook</div><div class="breadcrumb">PERSONAL DIARY <span>/</span> ${esc(titles[view])}</div><div class="profile"><button class="privacy-toggle" data-action="privacy" aria-pressed="${state.privacyMode?'true':'false'}" title="${state.privacyMode?'Show amounts':'Hide amounts'}">${state.privacyMode?'◉':'◌'} <span>${state.privacyMode?'Amounts hidden':'Hide amounts'}</span></button><span class="avatar">${esc(state.profile[0].toUpperCase())}</span><span>${esc(state.profile)}</span></div></header><main class="content"><div class="page-title"><div><h1>${titles[view]}</h1><p>${{ holdings: "A little clarity for every share you own.", cycles: "Your sold-lot results, month by month.", diary: "Every trade, clearly organised.", import: "Two steps to bring your portfolio up to date.", info: "How your lots, profit figures, reports and privacy settings work.", settings: "Back up your diary, install the app, and manage your data." }[view]}</p></div>${view === "holdings" ? '<button data-action="buy">＋ Add a purchase</button>' : ""}</div>
  ${demo ? '<div class="notice">You are exploring synthetic demo data. It is not saved. <button class="text-button" data-action="enddemo">Exit demo</button></div>' : ""}
  ${a.errors.length ? `<div class="notice error">${a.errors.length} transactions could not be applied. ${esc(a.errors[0].message)} Check your history before relying on totals.</div>` : ""}
  ${view === "holdings" ? holdings(a) : view === "cycles" ? cycles(a) : view === "diary" ? diary(a) : view === "import" ? uploadContent() : view === "info" ? infoContent(a) : settings()}
  <footer>Saved on this device <span>·</span> v${__APP_VERSION__}</footer></main></div><nav class="mobile-nav">${Object.entries(
    icons,
  )
    .map(
      ([v, i]) =>
        `<button data-view="${v}" class="${view === v ? "active" : ""}"><span>${i}</span>${{ holdings: "Holdings", cycles: "Cycles", diary: "Diary", import: "Import", info: "Info", settings: "Settings" }[v]}</button>`,
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
`<div class="welcome-wrap"><section class="welcome-art"><div class="brand"><span class="logo light">L</span> Lotbook</div><div class="eyebrow">YOUR SHARES. YOUR STORY.</div><h1>Know the story<br>behind every trade.</h1><p>A personal space for your core holdings,<br>trading cycles, and everything in between.</p><div class="paper"><span class="eyebrow">A LITTLE LOT CLARITY</span><div class="paper-row">Core holding <b>10 shares · ₹1,300</b></div><div class="paper-row">Trading purchase <b>10 shares · ₹1,250</b></div><div class="paper-row">Trading sale <b>10 shares · ₹1,270</b></div><div class="paper-result">One completed cycle <strong>+₹200</strong></div><small>Synthetic example · before charges</small></div><p class="privacy">● Diary data stays on this device.</p></section><section class="welcome-form"><span class="step-label">LET’S MAKE THIS YOURS</span><h2>Welcome to Lotbook.</h2><p>Your diary starts with a name.<br>No passwords. No broker credentials.</p><form id="welcome-form"><label>Your name<input name="name" maxlength="60" placeholder="What should we call you?" autocomplete="given-name" required></label><button class="full">Start my diary →</button></form><p class="fine">This is a local profile, not an authenticated account. Anyone with access to this browser can open it.</p><button class="text-button" data-action="demo">Explore a sample diary</button></section></div>`;
}
function marketPanel(a) {
  const held=a.holdings.filter(h=>h.quantity>0), linked=held.filter(h=>usableMarketQuote(marketQuotes[h.symbol])).length;
  const older=held.filter(h=>usableMarketQuote(marketQuotes[h.symbol])&&Date.now()-Date.parse(marketQuotes[h.symbol].marketAt||marketQuotes[h.symbol].fetchedAt)>86400000).length;
  return `<section class="panel market-panel"><div class="market-toolbar"><div><h2>Market prices</h2><p>${linked} of ${held.length} quoted${older?' · '+older+' older than 24h':''} · Quotes may be delayed</p></div><button class="secondary" data-action="refreshquotes" ${marketRefreshing?'disabled':''}>${marketRefreshing?'Updating…':'Refresh prices'}</button></div>${marketMessage?`<p class="market-feedback" role="status">${esc(marketMessage)}</p>`:''}${actionMessage?`<p class="market-feedback" role="status">${esc(actionMessage)}</p>`:''}<details class="market-disclosure"><summary>Source &amp; freshness</summary><p>Prices are requested in rate-safe batches and checked every ${marketIntervalMs(localStorage)/60000} minutes while open during market hours. A failed batch is retried once; manual prices fill any remaining gaps. Tap a stock for its source and timestamp.</p><p>Share adjustments are checked separately after statement imports, not by the price button. Statements and share counts stay on this device.</p></details></section>`;
}
function stats(a) {
  const enteredValue = a.totals.unpriced && a.holdings.every(h => h.currentPrice === null) ? null : a.totals.currentValue;
  const latestTransactionDate=state.transactions.reduce((latest,t)=>t.date>latest?t.date:latest,'');
  const broker=growwInvestedSummary({holdings:a.holdings,fifoInvested:a.totals.fifoInvested,snapshots:state.snapshots,snapshotDate:state.snapshotDate,latestTransactionDate});
  const brokerLabel=broker.source==='statement'?`Groww statement · ${displayDate(broker.asOf)}`:'FIFO estimate · import current holdings to match Groww';
  return `<div class="stats summary-stats"><div class="stat-card"><span>Groww invested</span><strong>${money(broker.value)}</strong><small>${esc(brokerLabel)}</small></div><div class="stat-card"><span>Current value</span><strong>${money(enteredValue)}</strong><small>${a.totals.unpriced ? 'Partial · '+a.totals.unpriced+' missing prices' : 'At available market / manual prices'}</small></div><div class="stat-card featured"><span>Sold-lot profit / loss</span><strong class="${tone(a.totals.realizedNet)}">${money(a.totals.realizedNet)}</strong><small>${a.totals.unknownCharges ? "Some fees missing · provisional" : "After recorded costs · before tax"}</small></div></div>`;
}
function profitExplanation(a) {
  return `<details class="panel disclosure"><summary>Understand your profit figures</summary><div class="disclosure-body"><p>Sold-lot results use the lowest-price available lots by default. Custom lot choices are kept. Changing the match changes diary attribution, not broker proceeds, taxable FIFO or total wealth.</p><div class="kv profit-kv"><span><b>Selected-lot cost still held</b><small>LotBook diary basis, including recorded buy costs</small></span><b class="money-value">${money(a.totals.invested)}</b></div><div class="kv profit-kv"><span><b>FIFO comparison</b><small>Independent diary comparison</small></span><b class="${tone(a.totals.fifoNet)} money-value">${money(a.totals.fifoNet)}</b></div><p class="fine">This is not a verified broker or tax result. ${a.totals.unknownCharges?'Fees are missing for '+a.totals.unknownCharges+' trades; profit is provisional. Add costs inside each trade in Diary.':'Includes recorded costs only; verify against your contract notes.'}</p></div></details>`;
}
function holdings(a) {
  const soldResults = new Map();
  for (const cycle of a.cycles) soldResults.set(cycle.symbol, (soldResults.get(cycle.symbol) || 0) + cycle.net);
  const heldSymbols=new Set(a.holdings.map(h=>h.symbol));
  const closedSymbols=[...soldResults].filter(([symbol])=>!heldSymbols.has(symbol) && (!query||symbol.toLowerCase().includes(query.toLowerCase())));
  const allHeld = a.holdings.filter((h) => h.quantity > 0);
  const positionCounts = allHeld.reduce((counts, holding) => {
    const status = holdingPriceSignal(holding).status;
    if (status === 'above') counts.above += 1;
    else if (status === 'below' || status === 'at') counts.notAbove += 1;
    else counts.unknown += 1;
    return counts;
  }, {above:0, notAbove:0, unknown:0});
  const list = selectHoldings(a.holdings, {
    query,
    position: holdingPosition,
    sort: holdingSort,
    direction: holdingSortDirection,
  });
  const filtered = Boolean(query || holdingPosition !== 'all');
  const rows = list.length
    ? `<div class="holdings-head"><span>Stock / price</span><span>Average / cost</span><span>Value / quote</span><span>${holdingMetric === 'pnl' ? 'Unrealised P&L' : 'Unrealised return'}</span></div>${list.map((h) => {
      const priceSignal = holdingPriceSignalText(h);
      return `<button class="holding-row" data-stock="${esc(h.symbol)}" data-price-position="${priceSignal.status}"><div class="stock-main"><span class="stock-icon">${esc(h.symbol.slice(0, 2))}</span><div><b>${esc(h.name || h.symbol)}</b><small>${esc(h.symbol)} · ${num(h.quantity)} shares</small><small class="stock-price">Price ${money(h.currentPrice)} / share</small><small class="stock-quote">${esc(quoteSummary(h.symbol))}</small>${priceSignal.text?`<small class="stock-lot-signal">${priceSignal.text}</small>`:''}${soldResults.has(h.symbol)?`<small class="stock-sold">Sold shares P&amp;L ${money(soldResults.get(h.symbol))}</small>`:''}</div></div><div><b>${money(h.averageCost)}</b><small>${money(h.cost)}</small></div><div><b>${money(h.currentValue)}</b><small>Value at available price</small></div><div><b class="${h.unrealized === null ? "" : tone(h.unrealized)}">${holdingMetricText(h)}</b><small>${holdingMetric === 'pnl' ? 'Unrealised P&L' : 'Return on remaining cost'}</small><small>View lots →</small></div></button>`;
    }).join("")}`
    : `<div class="empty"><span class="empty-icon">◫</span><h3>${filtered ? "No stocks match these filters" : "Your portfolio starts here"}</h3><p>${filtered ? 'Try another search or clear the portfolio filters.' : 'Import your Groww order history, or add your first purchase.<br>Every purchase becomes a lot you can follow.'}</p>${filtered?'<button class="secondary" data-action="holdingreset">Clear filters</button>':'<button data-action="buy">Add a purchase</button><button class="secondary" data-view="import">Import statements</button>'}</div>`;
  const filterBar = `<div class="holding-filter-bar"><div class="holding-position-filters" role="group" aria-label="Position versus cheapest open buy"><button data-action="holdingposition" data-position="all" aria-pressed="${holdingPosition==='all'}" class="${holdingPosition==='all'?'active':''}">All <span>${allHeld.length}</span></button><button data-action="holdingposition" data-position="above" aria-pressed="${holdingPosition==='above'}" class="positive-filter ${holdingPosition==='above'?'active':''}">Above cheapest <span>${positionCounts.above}</span></button><button data-action="holdingposition" data-position="not-above" aria-pressed="${holdingPosition==='not-above'}" class="negative-filter ${holdingPosition==='not-above'?'active':''}">Below / at <span>${positionCounts.notAbove}</span></button></div><div class="holding-sort-controls"><label><span>Sort by</span><select id="holding-sort"><option value="name" ${holdingSort==='name'?'selected':''}>Name</option><option value="returns" ${holdingSort==='returns'?'selected':''}>Return %</option><option value="price" ${holdingSort==='price'?'selected':''}>Current price</option><option value="cheapest-gap" ${holdingSort==='cheapest-gap'?'selected':''}>Distance from cheapest buy</option><option value="pnl" ${holdingSort==='pnl'?'selected':''}>Unrealised P&amp;L</option></select></label><button class="sort-direction" data-action="holdingsortdirection" aria-label="Sort ${holdingSortDirection==='asc'?'descending':'ascending'}" title="Reverse sort order">${holdingSortDirection==='asc'?'↑ Low to high':'↓ High to low'}</button></div></div>`;
  return `${stats(a)}${marketPanel(a)}<section class="panel"><div class="panel-title portfolio-title"><div><h2>Portfolio</h2><span>${list.length}${filtered?` of ${allHeld.length}`:''} holdings · Tap a stock to see lots${positionCounts.unknown?` · ${positionCounts.unknown} without comparison`:''}</span></div><div class="portfolio-controls"><input class="search" id="search" value="${esc(query)}" placeholder="Search your stocks" aria-label="Search stocks"><div class="metric-switch" role="group" aria-label="Holding result display"><button data-action="holdingmetric" data-metric="pnl" aria-pressed="${holdingMetric === 'pnl'}" class="${holdingMetric === 'pnl' ? 'active' : ''}">P&amp;L</button><button data-action="holdingmetric" data-metric="returns" aria-pressed="${holdingMetric === 'returns'}" class="${holdingMetric === 'returns' ? 'active' : ''}">Returns %</button></div></div></div>${filterBar}${rows}</section>${closedSymbols.length?`<section class="panel mini"><h2>Fully sold stocks</h2><p>Diary result after recorded costs. Automatic sales use the lowest-price lots; custom matches are retained.</p>${closedSymbols.map(([symbol,net])=>`<div class="kv"><span><b>${esc(symbol)}</b><small>No shares remaining</small></span><b class="${tone(net)}">${money(net)}</b></div>`).join('')}</section>`:''}${profitExplanation(a)}${reconciliation(a)}<div class="two-col"><section class="panel mini"><div class="panel-title"><h2>Cash balance</h2><button class="text-button" data-action="cash">Update</button></div><strong class="large">${money(state.cash)}</strong><p>Enter the balance shown in Groww manually. It is not reconstructed from equity trades.</p></section><section class="panel mini"><div class="panel-title"><h2>Your diary, your device</h2><span>↗</span></div><p>Export a backup regularly. Browser storage can be cleared or lost when you change devices.</p><button class="secondary" data-action="export">Export my diary</button></section></div>`;
}
function reconciliation(a) {
  if (!state.snapshots.length && !state.snapshotComplete) return "";
  const cutoff=state.snapshotDate;
  const rows=reconcileHoldings(state.transactions.filter(t=>!cutoff||t.date<=cutoff),state.snapshots,{complete:state.snapshotComplete});
  const diffs=rows.filter(r=>Math.abs(r.difference)>1e-8);
  const newer=cutoff&&state.transactions.some(t=>t.date>cutoff);
  const matching=rows.length-diffs.length;
  const comparison=diffs.length?diffs:rows.slice(0,3);
  const note=diffs.length
    ? `${diffs.length} ${diffs.length===1?'quantity differs':'quantities differ'}. ${newer?'Your diary contains newer activity, so these are comparison notes—not errors.':'Review only if you did not trade or receive a share adjustment around the statement date.'}`
    : 'Supplied quantities match the diary at the statement date.';
  return `<details class="panel disclosure reconciliation"><summary>Holdings statement comparison${diffs.length?` · ${diffs.length} noted`:" · Matched"}</summary><div class="disclosure-body"><div class="reconciliation-meta"><span>${state.snapshotComplete?'Complete statement':'Partial statement'}</span><span>${cutoff?`As of ${esc(cutoff)}`:'Date not supplied'}</span></div><p>${note}</p>${comparison.map(r=>`<div class="reconciliation-row"><span><b>${esc(r.symbol)}</b><small>Broker average ${money(r.averageCost)}</small></span><span><b>${num(r.reported)}</b><small>Statement</small></span><span><b>${num(r.actual)}</b><small>Diary at that date</small></span>${Math.abs(r.difference)>1e-8?`<span class="reconciliation-note"><b>${r.difference>0?'+':''}${num(r.difference)}</b><small>Statement − diary</small></span>`:''}</div>`).join('')}${matching?`<p class="matched-count">✓ ${matching} other position${matching===1?'':'s'} matched and hidden</p>`:''}<p class="fine">This comparison is informational. Newer manual purchases are valid diary activity; snapshots never create or delete purchases. Verified bonuses and splits are applied separately.</p><button class="secondary" data-action="snapshot">Enter / replace snapshot</button></div></details>`;
}
function cycles(a) {
  const months={};
  for(const c of a.cycles)(months[c.sellDate.slice(0,7)] ||= []).push(c);
  return `<div class="stats summary-stats"><div class="stat-card featured"><span>Sold-lot profit / loss</span><strong class="${tone(a.totals.realizedNet)}">${money(a.totals.realizedNet)}</strong><small>${a.totals.unknownCharges?'Some fees missing · provisional':'After recorded costs · before tax'}</small></div><div class="stat-card"><span>Closed purchase lots</span><strong>${a.cycles.length}</strong><small>${a.cycles.filter(c=>c.net>0).length} profitable · ${a.cycles.filter(c=>c.net<0).length} loss-making</small></div><div class="stat-card"><span>Recorded trade costs</span><strong>${money(a.totals.charges)}</strong><small>Across all buys and sells</small></div></div>${Object.entries(months).sort(([a],[b])=>b.localeCompare(a)).map(([month,cs],i)=>`<details class="panel disclosure cycle-month" ${i===0?'open':''}><summary><span>${new Date(month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}<small>${cs.length} lot closures</small></span><b class="${tone(a.monthlyResults.find(r=>r.month===month).net)}">${money(a.monthlyResults.find(r=>r.month===month).net)}</b></summary>${cs.map(c=>`<button class="activity-row" data-action="history" data-id="${esc(c.sellId)}"><span class="trade-mark sell" aria-hidden="true">↗</span><span class="activity-stock"><b>${esc(c.symbol)}</b><small>${num(c.quantity)} shares · ${c.holdingDays} days held</small><small>${money(c.buyPrice)} → ${money(c.sellPrice)}</small></span><span class="activity-value"><b class="${tone(c.net)}">${money(c.net)}</b><small>${displayDate(c.sellDate)}</small></span><span class="row-chevron">›</span></button>`).join('')}</details>`).join('')||'<section class="panel empty"><h3>No sales yet</h3><p>Record a sale from Holdings to see its matched-lot results here.</p><button class="secondary" data-view="holdings">View holdings</button></section>'}${profitExplanation(a)}`;
}
function diary(a) {
  if(diaryTab==='rights'&&!state.rightsTrades?.length)diaryTab='activity';
  const tabs = `<div class="view-tabs" role="group" aria-label="Diary sections">${[['activity','Activity'],['notes','Notes'],...(state.rightsTrades?.length?[['rights','Rights trades']]:[])].map(([key,label])=>`<button data-action="diarytab" data-tab="${key}" aria-pressed="${diaryTab===key}" class="${diaryTab===key?'active':''}">${label}</button>`).join('')}</div>`;
  if (diaryTab === 'notes') return `${tabs}<section class="panel mini note-editor"><div class="section-heading"><div><h2>Today’s note</h2><p>${displayDate(today())} · A little context for your next decision.</p></div></div><form id="note-form"><label>What did you learn or plan?<textarea name="note" maxlength="3000" placeholder="Why did I buy? What would make me exit?">${esc(noteDraft ?? state.notes[today()] ?? '')}</textarea></label><button>Save note</button></form></section><div class="notes-grid">${Object.entries(state.notes).filter(([,n])=>n.trim()).sort(([a],[b])=>b.localeCompare(a)).map(([date,note])=>`<article class="panel mini"><h2>${displayDate(date)}</h2><p class="note-text">${esc(note)}</p></article>`).join('') || '<div class="empty panel"><h3>Your thinking belongs here</h3><p>Save a note above to start your decision journal.</p></div>'}</div>`;
  if (diaryTab === 'rights') return `${tabs}<section class="panel"><div class="panel-title"><div><h2>Rights-entitlement trades</h2><span>Separate from ordinary shares · ${state.rightsTrades.length} records</span></div></div><p class="section-hint">These records can originate from a rights issue. Profit is not calculated without a verified acquisition cost.</p>${state.rightsTrades.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<div class="activity-row rights-row"><span class="trade-mark">${t.side==='SELL'?'↗':'↙'}</span><div class="activity-stock"><b>${esc(t.symbol)}</b><small>${displayDate(t.date)} · ${esc(t.side==='SELL'?'Sold':'Bought')} ${num(t.quantity)} units</small></div><div class="activity-value"><b>${money(t.price*t.quantity)}</b><small>${money(t.price)} / unit</small></div></div>`).join('')}</section>`;
  const result=selectDiaryEntries(state.transactions,{query:diaryQuery,kind:diaryKind,month:diaryMonth,limit:diaryLimit});
  const saleResults=new Map();
  for(const c of a.cycles) saleResults.set(c.sellId,(saleResults.get(c.sellId)||0)+c.net);
  let previousDate='';
  const rows=result.entries.map(t=>{
    const dateHeading=t.date!==previousDate?`<h3 class="activity-date">${displayDate(t.date)}</h3>`:'';
    previousDate=t.date;
    const adjustment=Boolean(t.corporateAction), sale=t.side==='SELL', profit=saleResults.get(t.id);
    const label=adjustment?(t.corporateAction==='BONUS'?'Bonus shares':'Share split'):sale?'Sold':'Bought';
    const detail=adjustment?(t.side==='SPLIT'?`Factor ${num(t.quantity)}:1`:`${num(t.quantity)} new shares`):`${num(t.quantity)} shares × ${money(t.price)}`;
    return `${dateHeading}<button class="activity-row" data-action="history" data-id="${esc(t.id)}" aria-label="${esc(label+' '+t.symbol+' on '+displayDate(t.date))}"><span class="trade-mark ${adjustment?'adjustment':sale?'sell':'buy'}" aria-hidden="true">${adjustment?'✦':sale?'↗':'↙'}</span><span class="activity-stock"><b>${esc(t.symbol)}</b><small>${label} · ${detail}</small></span><span class="activity-value"><b class="${sale&&profit!==undefined?tone(profit):''}">${adjustment?'Verified':sale?money(profit):money(t.quantity*t.price)}</b><small>${adjustment?'Share adjustment':sale?'Sold-lot P&L':'Purchase value'}</small></span><span class="row-chevron" aria-hidden="true">›</span></button>`;
  }).join('');
  return `${tabs}<section class="panel diary-panel"><div class="panel-title"><div><h2>Your activity</h2><span>Latest first · Tap a trade for details</span></div><button class="secondary" data-action="buy">＋ Add purchase</button></div><div class="diary-filters"><label class="diary-search-label"><span>Find a stock</span><input id="diary-search" value="${esc(diaryQuery)}" placeholder="Search name or symbol" type="search"></label><label><span>Type</span><select id="diary-kind">${[['all','All activity'],['buy','Purchases'],['sell','Sales'],['adjustment','Share adjustments']].map(([key,label])=>`<option value="${key}" ${diaryKind===key?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Period</span><select id="diary-month"><option value="">All months</option>${result.months.map(month=>`<option value="${month}" ${diaryMonth===month?'selected':''}>${new Date(month+'-01T12:00:00').toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</option>`).join('')}</select></label></div><div class="activity-count"><span>${result.total} matching ${result.total===1?'entry':'entries'}</span>${diaryQuery||diaryKind!=='all'||diaryMonth?'<button class="text-button" data-action="diaryreset">Clear filters</button>':'<span>Costs & lot matching inside each trade</span>'}</div>${rows || `<div class="empty"><h3>${state.transactions.length?'No matching activity':'Your diary starts with a trade'}</h3><p>${state.transactions.length?'Try another stock or clear your filters.':'Import an order history or add a purchase to begin.'}</p><button class="secondary" ${state.transactions.length?'data-action="diaryreset"':'data-view="import"'}>${state.transactions.length?'Clear filters':'Import statements'}</button></div>`}${result.entries.length<result.total?`<div class="activity-more"><span>Showing ${result.entries.length} of ${result.total}</span><button class="secondary" data-action="diarymore">Show more</button></div>`:''}</section><p class="fine diary-footnote">Sold-lot P&amp;L uses your matched purchase lots and recorded costs. Missing fees make it provisional; it is not a tax result.</p>`;
}
function transactionDetail(transactionId) {
  const t=state.transactions.find(t=>t.id===transactionId);
  if(!t)throw Error('This transaction is no longer available.');
  const cs=live().cycles.filter(c=>c.sellId===t.id), sale=t.side==='SELL', adjustment=Boolean(t.corporateAction);
  const result=cs.length?cs.reduce((sum,c)=>sum+c.net,0):null;
  modal(`${t.symbol} · ${adjustment?'share adjustment':sale?'sale':'purchase'}`,`
    <div class="transaction-hero"><small>${displayDate(t.date)}${t.tradeTime?' · '+esc(t.tradeTime):''}</small><strong class="${sale&&result!==null?tone(result):''}">${adjustment?(t.side==='SPLIT'?num(t.quantity)+':1':num(t.quantity)+' new shares'):sale?money(result):money(t.quantity*t.price)}</strong><span>${adjustment?'Verified '+esc(t.corporateAction.toLowerCase()):sale?'Sold-lot profit / loss':'Purchase value · before charges'}</span></div>
    ${!adjustment?`<div class="kv"><span>Quantity</span><b>${num(t.quantity)} shares</b></div><div class="kv"><span>Price per share</span><b>${money(t.price)}</b></div><div class="kv"><span>Trade value</span><b>${money(t.price*t.quantity)}</b></div><div class="kv"><span>Recorded costs</span><b>${t.chargesKnown?money(t.charges):'Not added'}</b></div>`:''}
    ${sale?`<details class="disclosure" open><summary>Matched purchase lots · ${cs.length}</summary>${cs.map(c=>`<div class="kv"><span>${displayDate(c.buyDate)}<small>${num(c.quantity)} shares at ${money(c.buyPrice)}</small></span><b class="${tone(c.net)}">${money(c.net)}</b></div>`).join('')}<p class="fine">Automatic sales fill lowest-price lots. Custom selections stay as chosen. ${cs.some(c=>!c.chargesKnown)?'Some costs are missing; this result is provisional.':'Includes recorded costs.'}</p></details>`:''}
    ${t.note?`<p class="note-text">${esc(t.note)}</p>`:''}
    ${!adjustment?`<div class="detail-actions"><button class="secondary" data-action="charges" data-id="${esc(t.id)}">Edit costs</button>${sale?`<button class="secondary" data-action="allocation" data-id="${esc(t.id)}">Change lot match</button>`:`<button class="text-button danger" data-action="deletepurchase" data-id="${esc(t.id)}">Delete purchase</button>`}</div>`:''}
    <details class="disclosure"><summary>Record information</summary>${[['ISIN',t.isin],['Exchange',t.exchange],['Order ID',t.exchangeOrderId],['Trade ID',t.tradeId]].filter(([,v])=>v).map(([k,v])=>`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('') || '<p class="fine">No additional identifiers recorded.</p>'}<p class="fine">Saved on this device. Broker records are unchanged.</p>${!adjustment&&t.id===state.transactions.at(-1)?.id?'<button class="text-button danger" data-action="undo">Undo last entered transaction</button>':''}</details>`);
}
function deletePurchaseForm(transactionId) {
  const t = state.transactions.find(transaction => transaction.id === transactionId);
  if (!t || t.side !== 'BUY' || t.corporateAction) throw Error('This purchase is no longer available.');
  pendingPurchaseDeleteId = t.id;
  const imported = Boolean(t.tradeId || t.exchangeOrderId || t.orderId || t.isin || t.exchange);
  modal('Delete this purchase?', `<div class="transaction-hero"><small>${displayDate(t.date)}</small><strong>${esc(t.symbol)} · ${num(t.quantity)} shares</strong><span>${money(t.price)} per share</span></div><p>This removes only this purchase and recalculates the diary. It cannot be deleted if any of its shares were already sold.</p>${imported?'<p class="notice">This record contains broker identifiers. Re-import the complete order history if it was removed by mistake.</p>':''}<div class="detail-actions"><button class="secondary" data-action="close">Keep purchase</button><button class="danger" data-action="confirmdeletepurchase">Delete purchase</button></div>`);
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
  return `<div class="import-intro"><span class="privacy-dot"></span><span>Files are read on this device. Nothing is uploaded.</span></div><div class="upload-grid"><section class="panel mini"><span class="step-label">START HERE</span><h2>1. Order history</h2><p>Your executed buys and sells build the diary. Use the complete history you want to keep.</p><label class="upload-target">⇧ <b>Choose order history</b><small>CSV · Excel · PDF preview</small><input type="file" class="statement" data-kind="trades" accept=".csv,.xlsx,.xls,.pdf"></label><small>Review before replacing. This replaces the previous trade diary.</small></section><section class="panel mini"><span class="step-label">THEN CHECK</span><h2>2. Current holdings</h2><p>Compare your diary quantities with Groww’s holdings statement. This does not create purchases.</p><label class="upload-target">⇧ <b>Choose holdings statement</b><small>CSV · Excel · PDF preview</small><input type="file" class="statement" data-kind="holdings" accept=".csv,.xlsx,.xls,.pdf"></label><button class="text-button" data-action="snapshot">Or enter holdings manually</button></section></div><details class="panel disclosure"><summary>Optional broker reports</summary><div class="disclosure-body"><p>Keep P&amp;L and Capital Gains reports as references. They do not change trade lots or calculate tax.</p><div class="upload-grid"><label class="upload-target">⇧ <b>Choose P&amp;L report</b><small>CSV · Excel</small><input type="file" class="statement" data-kind="pnl" accept=".csv,.xlsx,.xls"></label><label class="upload-target">⇧ <b>Choose Capital Gains report</b><small>One per financial year · CSV · Excel</small><input type="file" class="statement" data-kind="capital-gains" accept=".csv,.xlsx,.xls"></label></div></div></details><details class="panel disclosure"><summary>Where to find your statements</summary><div class="disclosure-body"><p>In Groww, download Stocks Order History and Stock Holding Statement. Add P&amp;L and Capital Gains reports only if you want them kept as references.</p><p>CSV and Excel are best for imports. PDFs are previewed; they are not automatically converted into executed trades. Maximum file size: 15 MB.</p><a href="https://groww.in/help/my-account/ma-others/where-can-i-get-the-transaction-history" target="_blank" rel="noopener noreferrer">Groww’s report instructions ↗</a></div></details>${state.imports.length?`<details class="panel disclosure"><summary>Import history · ${state.imports.length}</summary><div class="disclosure-body">${state.imports.slice().reverse().map(i=>`<div class="kv"><span>${esc(i.date)} · ${esc(i.kind)}</span><b>${i.count} records</b></div>`).join('')}</div></details>`:''}`;
}
function referenceReports(kind){return state.referenceReports.filter(report=>!kind||report.kind===kind);}
function reportPeriod(report){return report.period?.start&&report.period?.end?`${report.period.start} to ${report.period.end}`:'Period not identified';}
function infoContent(a) {
  const pnl=referenceReports('pnl'),capital=referenceReports('capital-gains');
  return `<section class="panel info-hero"><div><span class="eyebrow">ⓘ LOTBOOK GUIDE</span><h2>How your diary works</h2><p>Import executed orders to build purchase lots. For each sale, LotBook fills the lowest-price available lots first unless you choose specific lots.</p></div><button class="secondary" data-action="privacy">${state.privacyMode?'Show amounts':'Hide amounts'} in public</button></section><section class="panel"><h2>What each report does</h2><div class="report-grid"><article><b>Order History</b><p>Creates buys, sales and selected-lot diary results. Rights entitlements are kept separately, not treated as ordinary shares.</p></article><article><b>Holdings</b><p>Supplies the broker quantity and average used for the Groww invested total when the snapshot is current and matches the diary.</p></article><article><b>Profit &amp; Loss</b><p>Saved as a broker reference only. ${pnl.length} report${pnl.length===1?'':'s'} stored on this device.</p></article><article><b>Capital Gains</b><p>Saved as the tax reference. ${capital.length} report${capital.length===1?'':'s'} stored. LotBook does not claim an exact tax liability.</p></article></div></section><section class="two-col"><section class="panel mini"><h2>Profit figures</h2><p><b>Groww invested</b> uses a current matching holdings statement, or a clearly labelled FIFO estimate. <b>Selected-lot cost</b> is LotBook's separate lowest-price-first diary basis.</p><p>Changing the lot match changes diary attribution, not broker proceeds, taxable FIFO or account wealth.</p></section><section class="panel mini"><h2>Market prices</h2><p>Quotes are best-effort, can be delayed and may be unavailable. Their source and timestamp appear under each stock. No statement or share count is sent to the quote service.</p></section></section><section class="panel mini"><h2>Tax: why no exact PAT is shown</h2><p>Indian equity capital gains are determined from taxable FIFO lots, holding period, eligible costs, corporate actions and the complete financial-year position across accounts. Selling below the displayed average but above the cheapest purchase does not by itself prove a tax loss.</p><p>Use the broker Capital Gains report for filing. A short-term capital loss can generally offset short- or long-term capital gains; a long-term capital loss can generally offset only long-term capital gains. Unused eligible losses may require a timely return to carry forward. Rates, exemptions, cess and surcharge can change, so LotBook keeps tax as a reference rather than presenting a misleading exact PAT.</p></section><section class="panel mini"><h2>Privacy and backup</h2><p>Hide amounts masks values on screen, but is not encryption. The diary is stored in this browser, so export a backup before clearing browser data or changing devices.</p></section>`;
}
function marketSettings() {
  const connected = Boolean(localStorage.getItem(MARKET_KEY));
return `<section class="panel mini"><h2>Free market prices</h2><p>The keyless Yahoo/Jina fallback is available now; an IndianAPI key is optional. Only stock tickers are requested, never holdings quantities or statement contents. The relay and quote source can see which tickers you request.</p><form id="market-key-form"><label>Refresh while app is open<select name="refreshMinutes">${[15,30,60,120].map(n=>`<option value="${n}" ${marketIntervalMs(localStorage)/60000===n?'selected':''}>Every ${n} minutes</option>`).join('')}</select></label><label>IndianAPI key (optional)<input name="marketKey" type="password" autocomplete="off" placeholder="Leave blank for keyless quotes" maxlength="300"></label><button>Save quote settings</button></form>${connected ? '<button class="secondary" data-action="clearmarketkey">Remove saved IndianAPI key</button>' : ''}<p class="fine">Yahoo via Jina is an unofficial, best-effort personal-use fallback; it may be delayed or unavailable. Your key and quote cache stay in this browser and are not exported. Never paste a key in chat or commit one to GitHub. <a href="https://indianapi.in/indian-stock-market" target="_blank" rel="noopener noreferrer">IndianAPI ↗</a></p>${marketMessage ? `<p class="notice" role="status">${esc(marketMessage)}</p>` : ''}</section>`;
}
function settings() {
  return `<div class="two-col"><section class="panel mini"><h2>Backup &amp; restore</h2><p>Your diary lives on this device. Keep a backup before changing phones or replacing records.</p><div class="detail-actions"><button data-action="export">Export backup</button><label class="button secondary">Restore backup<input type="file" id="restore" accept=".json" hidden></label></div><button class="text-button" data-action="csv">Export trades as CSV</button></section><section class="panel mini"><h2>App updates · v${__APP_VERSION__}</h2><p>Get the latest version without clearing your saved diary.</p><div class="detail-actions"><button data-action="checkupdate">Check for app update</button><button class="secondary" data-action="refresh">Refresh app</button></div></section></div><details class="panel disclosure"><summary>Market price settings</summary><div class="disclosure-body">${marketSettings()}</div></details><details class="panel disclosure"><summary>Your profile</summary><div class="disclosure-body"><form id="profile-form"><label>Name<input name="name" value="${esc(state.profile)}" maxlength="60" required></label><button>Save name</button></form><p class="fine">A local profile, not a password-protected account.</p></div></details><details class="panel disclosure"><summary>Install on your phone</summary><div class="disclosure-body"><p>Android: open in Chrome → Install app or Add to Home screen.<br>iPhone: open in Safari → Share → Add to Home Screen.</p><button class="secondary" data-action="install">Install / instructions</button></div></details><details class="panel disclosure"><summary>Privacy &amp; data</summary><div class="disclosure-body"><p>Statements are processed locally. Your name, records and share counts are not uploaded. Quote services receive the requested stock symbols; GitHub receives normal app-file requests.</p><p>Local storage is not encrypted. Anyone with access to this browser can open it, and clearing browser data can erase it. Hide amounts is a screen-privacy feature, not encryption.</p><button class="secondary" data-action="privacy">${state.privacyMode?'Show':'Hide'} amounts</button></div></details><details class="panel disclosure"><summary>Clear local data</summary><div class="disclosure-body"><p>This removes the saved diary from this browser. Export a backup first; there is no cloud copy.</p><button class="danger secondary" data-action="clear">Clear all local data</button></div></details>`;
}
function modal(title, body) {
  if (!$('#modal-root .dialog')) modalReturnFocus = document.activeElement;
  $("#modal-root").innerHTML =
    `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-title"><h2>${esc(title)}</h2><button class="close secondary" data-action="close" aria-label="Close dialog">×</button></div>${body}</section></div>`;
  $("#modal-root").querySelector("input,button")?.focus();
}
function close() {
  const wasOpen = Boolean($('#modal-root .dialog'));
  $("#modal-root").innerHTML = "";
  if (wasOpen && modalReturnFocus?.isConnected) modalReturnFocus.focus({preventScroll:true});
  modalReturnFocus = null;
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
  const soldCycles=a.cycles.filter(c=>c.symbol===symbol);
  const soldNet=soldCycles.reduce((sum,c)=>sum+c.net,0);
  modal(
    symbol + " · Lot history",
    `<div class="detail-summary"><div><small>Shares held</small><strong>${num(h.quantity)}</strong></div><div><small>Diary average</small><strong>${money(h.averageCost)}</strong></div><div><small>Core / trading</small><strong>${num(h.coreQuantity)} / ${num(h.tradingQuantity)}</strong></div></div>${soldCycles.length?`<p class="stock-sold"><b>Sold shares · diary P&amp;L: ${money(soldNet)}</b><br><small>${soldCycles.length} lot closure${soldCycles.length===1?'':'s'} · after recorded costs. Broker and tax P&amp;L may differ.</small></p>`:''}<div class="row-actions"><button data-action="buystock">＋ Purchase</button><button data-action="sell" ${h.quantity <= 0 ? "disabled" : ""}>Record sale</button><button class="secondary" data-action="quote">Update price</button></div><h3>Every purchase lot</h3><p class="fine">${esc(quoteDetail(symbol))}</p><p class="fine">Automatic matching starts with the cheapest available lot. You can change a sale's allocation in Diary.</p>${h.lots.map((l) => `<div class="lot-row"><div><b>${money(l.price)} per share</b><small>${esc(l.date)} · Bought ${num(l.quantity)} · Remaining ${num(l.remaining)}</small></div><div class="lot-actions"><select class="lot-purpose" data-id="${esc(l.id)}" aria-label="Purpose for lot bought ${esc(l.date)} at ${l.price}"><option value="core" ${l.purpose === "core" ? "selected" : ""}>Core</option><option value="trading" ${l.purpose === "trading" ? "selected" : ""}>Trading</option></select>${!l.corporateAction?`<button class="text-button danger" data-action="deletepurchase" data-id="${esc(l.id)}" aria-label="Delete purchase of ${num(l.quantity)} ${esc(symbol)} shares from ${esc(l.date)}">Delete</button>`:''}</div></div>`).join("")}<h3>Stock transaction history</h3>${tx.map((t) => `<div class="kv"><span>${esc(t.date)} · ${esc(t.side)} ${num(t.quantity)}</span><b>${money(t.price)}</b></div>`).join("")}`,
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
    const reference=['pnl','capital-gains'].includes(kind);
    const p = reference ? await parseReferenceStatement(file, kind) : await parseStatement(file, kind);
    if(run!==importRun)return;
    pending = { ...p, kind, reference };
    await checkImportShareEvents(pending);
    if(run!==importRun)return;
    importPreview();
  } catch (e) {
    if(run===importRun)modal('Statement could not be read',`<p class="notice error" role="alert">${esc(e.message)}</p><p>Nothing was saved. Use an unprotected CSV/XLSX export, or the template below. PDF text is a local reference, not a reliable transaction table.</p><button data-action="template">Download trade template</button>`);
  }
}
async function checkImportShareEvents(p) {
  if(!p.transactions?.length)return;
  const initial=prepareTradeReplacement(p.transactions);
  const symbols=[...new Set(initial.errors.filter(e=>/insufficient available quantity/.test(e.message)).map(e=>initial.transactions.find(t=>t.id===e.id)?.symbol).filter(Boolean))];
  if(!symbols.length)return;
  p.shareEvents=[];p.shareNotes=[];
  notify('Checking share changes for this statement…');
  for(const symbol of symbols){
    const first=p.transactions.filter(t=>t.symbol.toUpperCase()===symbol&&t.side==='BUY').map(t=>t.date).sort()[0];
    if(!first)continue;
    try { p.shareEvents.push(...await fetchVerifiedShareEvents(symbol,first)); }
    catch(error){p.shareNotes.push(`${symbol}: ${error.message} Retry the share check while online.`);}
  }
}
function referencePreview(){
  const p=pending,summary=p.summary||summarizeReferenceEntries(p.entries||[]),warnings=(p.warnings||[]);
  const name=p.kind==='pnl'?'Profit & Loss':'Capital Gains';
  const categories=p.kind==='capital-gains'?`<div class="stats compact"><div class="stat-card"><span>Short-term realised P&amp;L</span><strong class="${tone(summary.shortTerm)}">${money(summary.shortTerm)}</strong></div><div class="stat-card"><span>Long-term realised P&amp;L</span><strong class="${tone(summary.longTerm)}">${money(summary.longTerm)}</strong></div><div class="stat-card"><span>Other realised P&amp;L</span><strong class="${tone(summary.unclassified)}">${money(summary.unclassified)}</strong></div></div>`:`<div class="stats compact"><div class="stat-card"><span>Realised P&amp;L</span><strong class="${tone(summary.realised)}">${money(summary.realised)}</strong></div><div class="stat-card"><span>Unrealised P&amp;L</span><strong class="${tone(summary.unrealised)}">${money(summary.unrealised)}</strong></div></div>`;
  modal(`Review ${name} report`,`<div class="notice">This is a local broker-reference import. It will not create, change, or allocate diary lots.</div>${warnings.length?`<details><summary>${warnings.length} file note${warnings.length===1?'':'s'}</summary><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}<p><b>${p.entries?.length||0} readable reference rows</b> · ${esc(p.period?.start&&p.period?.end?`${p.period.start} to ${p.period.end}`:'report period not identified')}</p>${categories}<div class="preview-list">${(p.entries||[]).slice(0,80).map(entry=>`<div class="preview-row"><div><b>${esc(entry.symbol)} · ${entry.type}</b><small>${entry.term.replace('-', ' ')} · ${entry.buyDate||entry.closingDate||'date not supplied'}${entry.sellDate?` → ${entry.sellDate}`:''}</small></div><b class="${tone(entry.pnl)}">${money(entry.pnl)}</b></div>`).join('')}${(p.entries||[]).length>80?'<p class="fine">Only the first 80 rows are shown here. All parsed reference rows will be saved locally.</p>':''}</div><button class="full" data-action="confirmimport" ${(p.entries||[]).length?'':'disabled'}>Save ${name} reference</button>`);
}
function importPreview() {
  const p = pending;
  if(p.reference){referencePreview();return;}
  const warnings = [...(p.warnings || []).filter(w=>!/^Skipped \d+ (metadata|footer)/.test(String(w))),...(p.shareNotes||[])].map((w) =>
    typeof w === "string" ? w : w.message || JSON.stringify(w),
  );
  const plan=p.transactions?.length?prepareTradeReplacement(p.transactions,undefined,p.shareEvents||[]):null;
  const blockers=[...(p.blockingErrors||[]),...(plan?.conflicts||[]),...(plan?.errors||[]).map(e=>e.message)];
  const rightsCount=plan?.rightsTrades?.length||0;
  const labels={symbol:'Stock symbol',date:'Execution date',side:'Buy / sell',quantity:'Quantity',price:p.kind==='holdings'?'Average buy price (optional)':'Price per share (optional if total value)',tradeValue:'Gross total trade value (optional if price)',charges:'Total charges (optional)',companyName:'Company name (optional)',isin:'ISIN (optional)',tradeTime:'Execution time (optional)',tradeQuantity:'Executed quantity (optional)',status:'Order status (optional)',exchange:'Exchange (optional)',orderId:'Order ID (optional)',exchangeOrderId:'Exchange order ID (optional)',tradeId:'Trade / execution ID (optional)'};
  const fields=p.kind==='trades'?['symbol','date','side','quantity','price','tradeValue','charges','companyName','isin','tradeTime','tradeQuantity','status','exchange','orderId','exchangeOrderId','tradeId']:['symbol','quantity','price','isin'];
  const mapping=!p.fatal&&p.headers?.length?`<details ${p.mappingRequired?'open':''}><summary>Review or change column mapping</summary><form id="mapping-form"><div class="form-grid">${fields.map(k=>`<label>${labels[k]}<select name="${k}"><option value="">Not supplied</option>${p.headers.map((h,i)=>`<option value="${i}" ${p.columns?.[k]===i?'selected':''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div><button>Read matched columns</button></form></details>`:'';
  const issues=(p.rowIssues||[]).filter(issue=>issue.code==='invalid-row').length;
  const valueBasis=p.transactions?.some(t=>t.priceSource==='trade-value');
  if (plan) {
    modal('Replace diary from broker history', `<div class="notice"><b>${state.transactions.length} existing diary trades will be replaced.</b> Export a backup if you need the old records. The new statement will become the diary.</div>${rightsCount?`<p class="fine"><b>${rightsCount} rights-entitlement trade${rightsCount===1?'':'s'}</b> will be retained separately in Diary. They cannot be matched to ordinary share purchases, so they are excluded from share-lot P&amp;L.</p>`:''}${warnings.length?`<details><summary>${warnings.length} file notes</summary><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}${blockers.length?`<div class="notice error" role="alert">Import blocked: ${blockers.slice(0,8).map(esc).join('<br>')}</div>`:''}${blockers.length?'<button class="secondary" data-action="retryimportshares">Retry share-change check</button>':''}${mapping}<p><b>${plan.added} share trades</b>${rightsCount?` · ${rightsCount} rights trades`:''} · ${plan.adjustments.length ? `${plan.adjustments.length} verified share adjustment(s) included` : 'Share changes checked after saving.'}</p><div class="preview-list">${p.transactions.slice(0,20).map((t,i)=>`<div class="preview-row"><div><b>${esc(t.symbol)} · ${esc(t.side)}</b><small>${esc(t.date)} ${esc(t.tradeTime||'')}</small><small>${num(t.quantity)} × ${money(t.price)}</small></div>${t.side==='BUY'?`<select class="import-purpose" data-index="${i}" aria-label="Purpose for ${esc(t.symbol)}"><option value="core" ${t.purpose!=='trading'?'selected':''}>Core</option><option value="trading" ${t.purpose==='trading'?'selected':''}>Trading</option></select>`:''}</div>`).join('')}</div>${p.transactions.length>20?`<p class="fine">Showing 20 of ${p.transactions.length} trades. All parsed trades will be saved.</p>`:''}<label class="check-label"><input type="checkbox" id="executed-confirm">Replace my existing diary with this executed order history.</label>${valueBasis?'<label class="check-label"><input type="checkbox" id="value-confirm">The source Value is gross executed value excluding charges.</label>':''}${issues?'<label class="check-label"><input type="checkbox" id="issues-confirm">I reviewed excluded rows and accept that this history may be incomplete.</label>':''}<button class="full" data-action="confirmimport" ${p.fatal||blockers.length?'disabled':''}>Replace diary with statement</button>`);
    return;
  }
  modal(
    "Review your statement",
    `<div class="notice">Nothing has been saved yet. ${p.selectedSheet?`Worksheet: <b>${esc(p.selectedSheet)}</b>. `:''}Review the ${esc(p.kind)} below.</div>${warnings.length?`<details open><summary>${warnings.length} warnings · ${issues} rows need review</summary><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}${blockers.length?`<div class="notice error" role="alert"><b>Import blocked. Nothing will be saved.</b><p>${blockers.slice(0,12).map(esc).join('<br>')}</p><p>Correct the report or upload the missing older purchases. Do not invent a backdated purchase from today's holdings.</p></div>`:''}${mapping}${p.text?`<details><summary>Extracted PDF text (local only)</summary><pre>${esc(p.text.slice(0,18000))}</pre></details>`:''}<p><b>${p.transactions?.length||0} readable transactions</b> · <b>${p.holdings?.length||0} snapshot rows</b></p>${plan?`<div class="notice"><b>${plan.added} new · ${plan.skipped} matched / repeated · ${plan.updated} existing records enriched</b><p>Separate identical fills within a first upload are retained. Without execution IDs, overlapping identical trades are matched by occurrence count: review this count before confirming.</p></div><p class="fine">Same-day trades use execution times only when every trade that day has a time; otherwise source order is retained. Sale allocations and IDs on matched records are preserved.</p><div class="preview-list">${p.transactions.map((t,i)=>`<div class="preview-row"><div><b>${esc(t.symbol)} · ${esc(t.side)}</b><small>${esc(t.name||'')} · ${esc(t.date)} ${esc(t.tradeTime||'')}</small><small>${num(t.quantity)} × ${money(t.price)}${t.priceSource==='trade-value'?` · Total ${money(t.tradeValue)} ÷ quantity`:''} · Charges ${t.chargesKnown?money(t.charges):'unknown'}</small></div>${t.side==='BUY'?`<select class="import-purpose" data-index="${i}" aria-label="Purpose for imported ${esc(t.symbol)}"><option value="core" ${t.purpose!=='trading'?'selected':''}>Core</option><option value="trading" ${t.purpose==='trading'?'selected':''}>Trading</option></select>`:''}</div>`).join('')}</div><label class="check-label"><input type="checkbox" id="executed-confirm">This report contains actual executed equity trades, not pending orders.</label>${valueBasis?'<label class="check-label"><input type="checkbox" id="value-confirm">Value is the gross total for the executed quantity, excluding charges. I checked a source entry.</label>':''}${issues?'<label class="check-label"><input type="checkbox" id="issues-confirm">I reviewed the excluded rows and understand this import may be incomplete.</label>':''}<button class="full" data-action="confirmimport" ${p.fatal||blockers.length?'disabled':''}>Confirm transactions</button>`:p.holdings?.length?`${p.holdings.map(h=>`<div class="kv"><span>${esc(h.symbol)}</span><b>${num(h.quantity)} shares · Broker average ${money(h.avgPrice)}</b></div>`).join('')}${field('Snapshot as-of date','snapshotDate','date',today(),'id="snapshot-date" required')}<label class="check-label"><input type="checkbox" id="snapshot-complete">This is the complete holdings list for this account (missing stocks mean zero).</label><p class="fine">Leave unchecked for a partial list. No purchase history is created from this snapshot.</p>${issues?'<label class="check-label"><input type="checkbox" id="issues-confirm">I reviewed the excluded rows. The remaining snapshot may be incomplete.</label>':''}<button class="full" data-action="confirmimport" ${p.fatal||blockers.length?'disabled':''}>Save snapshot for reconciliation</button>`:'<p>No readable records found. Try a compatible CSV/XLSX report or the template.</p><button class="secondary" data-action="template">Download trade template</button>'}`,
  );
}
function confirmImport() {
  const p=pending,next=structuredClone(state);
  let replacedTrades=false;
  if(!p)throw Error('Choose a statement first.');
  if(p.reference){
    if(!p.entries?.length)throw Error('No readable reference rows were found. Nothing was saved.');
    const report={id:id(),kind:p.kind,importedAt:today(),period:p.period||{start:null,end:null},entries:p.entries};
    const samePeriod=existing=>existing.kind===report.kind&&existing.period?.start===report.period?.start&&existing.period?.end===report.period?.end;
    next.referenceReports=[...next.referenceReports.filter(existing=>!samePeriod(existing)),report];
    next.imports.push({date:today(),kind:p.kind,count:p.entries.length});
    next.onboarded=true;
    commit(next);pending=null;close();notify(`${p.entries.length} ${p.kind==='pnl'?'P&L':'Capital Gains'} reference rows saved locally.`);return;
  }
  if(p.fatal||p.blockingErrors?.length)throw Error('This statement cannot be confirmed. Correct the source file and retry.');
  if($('#issues-confirm')&&!$('#issues-confirm').checked)throw Error('Review and acknowledge the excluded rows first.');
  let added=0,skipped=0,updated=0;
  if(p.transactions?.length){
    if(!$('#executed-confirm')?.checked)throw Error('Confirm that these are executed equity trades.');
    if($('#value-confirm')&&!$('#value-confirm').checked)throw Error('Verify that Value is gross executed value, excluding charges, then confirm its basis.');
    const plan=prepareTradeReplacement(p.transactions,undefined,p.shareEvents||[]);
    if(plan.conflicts.length||plan.errors.length)throw Error('Import not saved: '+(plan.conflicts[0]||plan.errors[0].message));
    next.transactions=plan.transactions;next.rightsTrades=plan.rightsTrades;({added,skipped,updated}=plan);
    next.snapshots=[];next.snapshotComplete=false;next.snapshotDate='';
    next.referenceReports=[];next.prices={};next.cash=null;next.imports=[];
    replacedTrades=true;
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
  if(replacedTrades){
    marketQuotes={};marketAttempts={};
    localStorage.removeItem(MARKET_CACHE_KEY);
    render();
  }
  pending = null;
  close();
  if (replacedTrades || p.holdings?.length) {
    localStorage.removeItem(ACTION_CHECK_KEY);
    queueMicrotask(() => refreshCorporateActions(true));
  }
  notify(
    `${p.transactions?.length?`Replaced diary with ${added} trades.`:''} ${p.holdings?.length||0} snapshot rows saved.`,
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
    window.scrollTo({top:0,behavior:'instant'});
    return;
  }
  const symbol = el.dataset.stock;
  if (symbol) {
    stockDetail(symbol);
    return;
  }
  if (el.dataset.action === 'holdingmetric') {
    if (el.dataset.metric === 'pnl' || el.dataset.metric === 'returns') {
      holdingMetric = el.dataset.metric;
      render();
    }
    return;
  }
  if (el.dataset.action === 'holdingposition') {
    if (['all', 'above', 'not-above'].includes(el.dataset.position)) {
      holdingPosition = el.dataset.position;
      render();
    }
    return;
  }
  if (el.dataset.action === 'holdingsortdirection') {
    holdingSortDirection = holdingSortDirection === 'asc' ? 'desc' : 'asc';
    render();
    return;
  }
  safely(() => {
    switch (el.dataset.action) {
      case "close":
        close();
        break;
      case "holdingreset":
        query = '';
        holdingPosition = 'all';
        holdingSort = 'name';
        holdingSortDirection = 'asc';
        render();
        break;
      case "privacy":
        if(demo){state={...state,privacyMode:!state.privacyMode};render();}
        else commit({ ...state, privacyMode: !state.privacyMode });
        notify(state.privacyMode ? 'Amounts hidden on this device.' : 'Amounts visible on this device.');
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
      case "deletepurchase":
        deletePurchaseForm(el.dataset.id);
        break;
      case "confirmdeletepurchase": {
        const target = state.transactions.find(transaction => transaction.id === pendingPurchaseDeleteId);
        if (!target) throw Error('This purchase is no longer available.');
        const transactions = removePurchaseTransaction(state.transactions, pendingPurchaseDeleteId);
        const next = structuredClone(state);
        next.transactions = transactions;
        if (!transactions.some(transaction => transaction.symbol === target.symbol) && !next.snapshots.some(snapshot => snapshot.symbol === target.symbol)) {
          delete next.prices[target.symbol];
          delete marketQuotes[target.symbol];
          try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(marketQuotes)); } catch {}
        }
        commit(next);
        pendingPurchaseDeleteId = '';
        close();
        notify('Purchase deleted. Diary totals recalculated.');
        break;
      }
      case "allocation":
        allocationForm(el.dataset.id);
        break;
      case "history": transactionDetail(el.dataset.id); break;
      case "diarytab": diaryTab = el.dataset.tab; render(); $(`[data-tab="${diaryTab}"]`)?.focus({preventScroll:true}); break;
      case "diarymore": diaryLimit += 30; render(); break;
      case "diaryreset": diaryQuery=''; diaryKind='all'; diaryMonth=''; diaryLimit=30; render(); break;
      case "skip":
        commit({ ...state, onboarded: true });
        break;
      case "demo":
        noteDraft = null;
        state = demoState();
        demo = true;
        render();
        break;
      case "enddemo":
        noteDraft = null;
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
      case "retryimportshares": {
        const target=pending;
        void checkImportShareEvents(target).then(()=>{if(pending===target)importPreview();}).catch(error=>notify(error.message));
        break;
      }
      case "quote":
        modal(
          "Update manual price",
          `<form id="quote-form">${field("Price per share (₹)", "price", "number", state.prices[selected]?.price || "", 'required min="0.01" step="any"')}<p class="fine">Manual prices are used when no recent usable market quote is available.</p><button>Save price</button></form>`,
        );
        break;
      case "refreshquotes":
        refreshMarket(true).catch(error => notify(error.message));
        break;
      case "clearmarketkey":
        if (demo) throw Error('Exit the sample diary before changing quote settings.');
        localStorage.removeItem(MARKET_KEY);
        localStorage.removeItem(MARKET_CACHE_KEY);
        localStorage.removeItem(MARKET_INTERVAL_KEY);
        marketQuotes = {};
        marketMessage = 'IndianAPI key removed. Keyless Yahoo fallback remains available.';
        render();
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
      case "market-key-form":
        if (demo) throw Error('Exit the sample diary before connecting quotes.');
        if (d.marketKey && d.marketKey.trim().length < 8) throw Error('The IndianAPI key appears too short. Leave blank for keyless quotes.');
        if (![15, 30, 60, 120].includes(Number(d.refreshMinutes))) throw Error('Choose a supported refresh interval.');
        if (d.marketKey?.trim()) localStorage.setItem(MARKET_KEY, d.marketKey.trim());
        localStorage.setItem(MARKET_INTERVAL_KEY, d.refreshMinutes);
        marketMessage = 'Quote settings saved. Checking prices…';
        render();
        notify('Quote settings saved on this device.');
        refreshMarket(true).catch(error => notify(error.message));
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
        noteDraft = null;
        notify("Decision note saved");
        break;
      case "clear-form":
        if (d.confirm === "CLEAR") {
          if(localStorage.getItem(KEY)!==baselineRaw)throw Error('This diary changed in another tab. Refresh before clearing it.');
          localStorage.removeItem(KEY);
          localStorage.removeItem(MARKET_KEY);
          localStorage.removeItem(MARKET_CACHE_KEY);
          localStorage.removeItem(MARKET_INTERVAL_KEY);
          marketQuotes = {};
          baselineRaw = null;
          state = fresh();
          noteDraft = null;
          demo = false;
          loadError = "";
          view = "holdings";
          render();
          close();
        }
        break;
      case "mapping-form": {
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
        const target=pending;
        void checkImportShareEvents(target).then(()=>{if(pending===target)importPreview();}).catch(error=>notify(error.message));
        break;
      }
    }
  });
});
document.addEventListener("input", (e) => {
  if (e.target.id === 'diary-search') {
    diaryQuery = e.target.value; diaryLimit = 30;
    const start = e.target.selectionStart;
    render(); $('#diary-search').focus(); $('#diary-search').setSelectionRange(start,start);
  }
  if (e.target.matches('#note-form textarea')) noteDraft = e.target.value;
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
  if (e.target.id === 'holding-sort') {
    holdingSort = e.target.value;
    if (holdingSort === 'name') holdingSortDirection = 'asc';
    else holdingSortDirection = 'desc';
    render();
    $('#holding-sort')?.focus({preventScroll:true});
  }
  if (e.target.id === 'diary-kind' || e.target.id === 'diary-month') {
    const controlId = e.target.id;
    if (e.target.id === 'diary-kind') diaryKind = e.target.value;
    else diaryMonth = e.target.value;
    diaryLimit = 30; render();
    $(`#${controlId}`)?.focus({preventScroll:true});
  }
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
          marketQuotes = readMarketCache(localStorage);
          demo = false;
          loadError = "";
          close();
          render();
          notify("Backup restored");
          scheduleMarketRefresh();
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
      ...$("#modal-root").querySelectorAll("button,input,select,textarea,a[href],summary"),
    ].filter((el) => !el.disabled && el.getClientRects().length && el.tabIndex >= 0);
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
  if (e.key === MARKET_CACHE_KEY || e.key === MARKET_KEY) {
    marketQuotes = readMarketCache(localStorage);
    if (!$('#modal-root .dialog')) render();
    return;
  }
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
scheduleMarketRefresh();
queueMicrotask(() => refreshCorporateActions(false));
setInterval(scheduleMarketRefresh, 60000);
document.addEventListener('visibilitychange', scheduleMarketRefresh);
window.addEventListener('online', () => { scheduleMarketRefresh(); refreshCorporateActions(false); });
