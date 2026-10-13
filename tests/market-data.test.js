import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marketTicker, readMarketCache, usableMarketQuote, resolveHoldingPrice, parseIndianQuote,
  fetchIndianQuote, marketIntervalMs, MARKET_CACHE_KEY, MARKET_INTERVAL_KEY,
} from '../src/market-data.js';

test('maps Groww-style symbols without guessing company names', () => {
  assert.deepEqual(marketTicker('NSE:RELIANCE'), { exchange: 'NSE', ticker: 'RELIANCE' });
  assert.deepEqual(marketTicker('500325.BO'), { exchange: 'BSE', ticker: '500325' });
  assert.equal(marketTicker('HDFC BANK'), null);
});

test('refresh interval defaults to an hour and accepts only approved free-credit settings', () => {
  assert.equal(marketIntervalMs({ getItem: () => null }), 60 * 60000);
  assert.equal(marketIntervalMs({ getItem: key => key === MARKET_INTERVAL_KEY ? '15' : null }), 15 * 60000);
  assert.equal(marketIntervalMs({ getItem: () => '1' }), 60 * 60000);
});

test('accepts only an exact ticker, exchange and finite positive price', () => {
  const response = { tickerId: 'RELIANCE', currentPrice: { NSE: 1420.25, BSE: 1421 } };
  assert.deepEqual(parseIndianQuote(response, 'RELIANCE', '2026-10-11T10:00:00.000Z'), {
    price: 1420.25, fetchedAt: '2026-10-11T10:00:00.000Z', exchange: 'NSE', source: 'IndianAPI',
  });
  assert.equal(parseIndianQuote(response, 'BSE:RELIANCE').price, 1421);
  assert.throws(() => parseIndianQuote(response, 'INFY'), /identity/);
  assert.throws(() => parseIndianQuote({ tickerId: 'RELIANCE', currentPrice: { NSE: 0 } }, 'RELIANCE'), /valid NSE price/);
});

test('keeps expired, future, and malformed cached prices out of valuations', () => {
  const now = Date.parse('2026-10-11T10:00:00.000Z');
  assert.equal(usableMarketQuote({ price: 100, fetchedAt: '2026-10-10T10:00:00.000Z' }, now), true);
  assert.equal(usableMarketQuote({ price: 100, fetchedAt: '2026-10-01T10:00:00.000Z' }, now), false);
  assert.equal(usableMarketQuote({ price: 100, fetchedAt: '2026-10-11T12:00:00.000Z' }, now), false);
  const storage = { getItem: key => key === MARKET_CACHE_KEY ? JSON.stringify({
    RELIANCE: { price: 100, fetchedAt: '2026-10-11T10:00:00.000Z' },
    INFY: { price: -1, fetchedAt: '2026-10-11T10:00:00.000Z' },
  }) : null };
  assert.deepEqual(Object.keys(readMarketCache(storage)), ['RELIANCE']);
});

test('recent quote revalues a holding but expired or disconnected quotes use manual fallback', () => {
  const now = Date.parse('2026-10-11T10:00:00.000Z');
  const manual = { RELIANCE: { price: 100 } };
  const quotes = { RELIANCE: { price: 120, fetchedAt: '2026-10-11T09:00:00.000Z' } };
  assert.equal(resolveHoldingPrice('RELIANCE', manual, quotes, true, now), 120);
  assert.equal(resolveHoldingPrice('RELIANCE', manual, quotes, false, now), 100);
  assert.equal(resolveHoldingPrice('RELIANCE', manual, { RELIANCE: { ...quotes.RELIANCE, fetchedAt: '2026-10-01T09:00:00.000Z' } }, true, now), 100);
  assert.equal(resolveHoldingPrice('INFY', manual, quotes, true, now), null);
});

test('quote request sends only the ticker and private API key, not holdings', async () => {
  let called;
  const result = await fetchIndianQuote('RELIANCE', 'private-key', async (url, options) => {
    called = { url, options };
    return { ok: true, json: async () => ({ tickerId: 'RELIANCE', currentPrice: { NSE: 100 } }) };
  });
  assert.equal(new URL(called.url).searchParams.get('name'), 'RELIANCE');
  assert.equal(called.options.headers['x-api-key'], 'private-key');
  assert.equal(called.url.includes('private-key'), false);
  assert.equal(result.price, 100);
});

test('rate-limit and symbol mismatch do not produce a usable quote', async () => {
  await assert.rejects(fetchIndianQuote('INFY', 'key', async () => ({ status: 429, ok: false })), /limit/);
  await assert.rejects(fetchIndianQuote('INFY', 'key', async () => ({ ok: true, json: async () => ({ tickerId: 'RELIANCE', currentPrice: { NSE: 100 } }) })), /identity/);
});

test('browser connection failure is explained without claiming a bad key', async () => {
  await assert.rejects(
    fetchIndianQuote('INFY', 'key', async () => { throw new TypeError('Load failed'); }),
    /connection failed in this browser/,
  );
});
