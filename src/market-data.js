// Quote credentials and cache stay on this device, outside the exported diary.
export const MARKET_KEY = 'lotbook.market-key.v1';
export const MARKET_CACHE_KEY = 'lotbook.market-cache.v1';
export const MARKET_INTERVAL_KEY = 'lotbook.market-interval.v1';
export const MARKET_INTERVAL_MS = 60 * 60 * 1000;
export const MARKET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function marketTicker(symbol) {
  const text = String(symbol || '').trim().toUpperCase();
  const match = /^(?:(NSE|BSE):)?([A-Z0-9&._-]+)$/.exec(text);
  if (!match) return null;
  const suffix = /\.(NS|BO)$/.exec(match[2]);
  return { exchange: match[1] || (suffix?.[1] === 'BO' ? 'BSE' : 'NSE'), ticker: match[2].replace(/\.(NS|BO)$/, '') };
}

export function marketIntervalMs(storage) {
  const minutes = Number(storage.getItem(MARKET_INTERVAL_KEY));
  return [15, 30, 60, 120].includes(minutes) ? minutes * 60 * 1000 : MARKET_INTERVAL_MS;
}

export function readMarketCache(storage) {
  try {
    const raw = JSON.parse(storage.getItem(MARKET_CACHE_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([symbol, quote]) =>
      marketTicker(symbol) && quote && Number.isFinite(quote.price) && quote.price > 0 &&
      typeof quote.fetchedAt === 'string' && Number.isFinite(Date.parse(quote.fetchedAt))));
  } catch { return {}; }
}

export function usableMarketQuote(quote, now = Date.now()) {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return false;
  const age = now - Date.parse(quote.fetchedAt);
  const marketAge = quote.marketAt ? now - Date.parse(quote.marketAt) : age;
  return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= MARKET_MAX_AGE_MS &&
    Number.isFinite(marketAge) && marketAge >= -5 * 60 * 1000 && marketAge <= MARKET_MAX_AGE_MS;
}

/** Temporary keyless personal-use fallback. Only the ticker is sent to Jina/Yahoo. */
export function parseYahooQuote(payload, symbol, fetchedAt = new Date().toISOString()) {
  const wanted = marketTicker(symbol);
  const suffix = wanted?.exchange === 'BSE' ? '.BO' : '.NS';
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!wanted || payload?.chart?.error || meta?.symbol !== `${wanted.ticker}${suffix}` || meta?.currency !== 'INR')
    throw Error(`Yahoo quote identity or currency could not be verified for ${symbol}.`);
  const price = Number(meta.regularMarketPrice);
  const stamp = Number(meta.regularMarketTime) * 1000;
  if (!Number.isFinite(stamp) || stamp <= 0) throw Error(`Yahoo returned no market timestamp for ${symbol}.`);
  const marketAt = new Date(stamp).toISOString();
  if (!Number.isFinite(price) || price <= 0 || !usableMarketQuote({price,fetchedAt,marketAt}))
    throw Error(`Yahoo returned no usable recent market price for ${symbol}.`);
  return {price,fetchedAt,marketAt,exchange:wanted.exchange,source:'Yahoo via Jina (unofficial)'};
}

export async function fetchYahooFallback(symbol, fetcher = fetch) {
  const mapped = marketTicker(symbol);
  if (!mapped) throw Error(`Unsupported market symbol ${symbol}.`);
  const suffix = mapped.exchange === 'BSE' ? '.BO' : '.NS';
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped.ticker + suffix)}?range=1d%26interval=1d`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(`https://r.jina.ai/${target}`, {
      headers:{'X-No-Cache':'true',accept:'text/plain'},signal:controller.signal,cache:'no-store',
    });
    if (!response.ok) throw Error(`Free quote relay returned ${response.status}.`);
    const text = await response.text();
    const marker = text.indexOf('Markdown Content:');
    const start = text.indexOf('{', marker);
    if (marker < 0 || start < 0 || text.length > 100000) throw Error('Free quote relay returned an unexpected format.');
    return parseYahooQuote(JSON.parse(text.slice(start).trim()), symbol);
  } catch(error) {
    if (error.name === 'AbortError') throw Error('Free quote request timed out.');
    if (error instanceof TypeError || error instanceof SyntaxError) throw Error('Free quote relay could not be read in this browser.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export function resolveHoldingPrice(symbol, manualPrices, marketQuotes, connected, now = Date.now()) {
  if (connected && usableMarketQuote(marketQuotes[symbol], now)) return marketQuotes[symbol].price;
  return manualPrices[symbol]?.price ?? null;
}

export function parseIndianQuote(payload, symbol, fetchedAt = new Date().toISOString()) {
  const wanted = marketTicker(symbol);
  if (!wanted) throw Error(`No market ticker mapped for ${symbol}. Enter a price manually.`);
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const actual = marketTicker(data?.tickerId || data?.symbol || '');
  if (!actual || actual.ticker !== wanted.ticker) {
    throw Error(`Quote identity for ${symbol} could not be verified. No price was changed.`);
  }
  const raw = data?.currentPrice?.[wanted.exchange];
  const price = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(price) || price <= 0) {
    throw Error(`No valid ${wanted.exchange} price was returned for ${symbol}.`);
  }
  // The documented stock response has no guaranteed exchange timestamp.
  // fetchedAt is request time, never represented as a trade or market-data time.
  return { price, fetchedAt, exchange: wanted.exchange, source: 'IndianAPI' };
}

export async function fetchIndianQuote(symbol, apiKey, fetcher = fetch) {
  const mapped = marketTicker(symbol);
  if (!mapped) throw Error(`Unsupported market symbol ${symbol}. Enter a price manually.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const url = new URL('https://stock.indianapi.in/stock');
    url.searchParams.set('name', mapped.ticker);
    const response = await fetcher(url.toString(), {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403)
      throw Error('Quote API key was rejected. Check your free IndianAPI key in Settings.');
    if (response.status === 400) throw Error(`Quote request for ${symbol} was rejected. Check its ticker and your key.`);
    if (response.status === 429) throw Error('Free quote API limit reached. Try again later or use a manual price.');
    if (!response.ok) throw Error(`Quote service returned ${response.status}. Stored prices were not changed.`);
    return parseIndianQuote(await response.json(), symbol);
  } catch (error) {
    if (error.name === 'AbortError') throw Error('Quote request timed out. Stored prices were not changed.');
    if (error instanceof TypeError) throw Error('Quote connection failed in this browser. Reopen LotBook while online and try again; no prices were changed.');
    throw error;
  } finally { clearTimeout(timeout); }
}
