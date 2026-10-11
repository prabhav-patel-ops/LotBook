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
  return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= MARKET_MAX_AGE_MS;
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
    throw error;
  } finally { clearTimeout(timeout); }
}

