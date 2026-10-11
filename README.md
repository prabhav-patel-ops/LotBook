# Lotbook

A local-only personal equity trading diary. Track purchase lots, core holdings, chosen-lot trading cycles, and an independent FIFO comparison.

**Live:** https://prabhav-patel-ops.github.io/LotBook/

**User flow and privacy:** [Guide](public/guide.html)

Enter a name → upload Groww equity order history CSV/XLSX → review and classify buys → holdings → record an actual broker sale in the diary → allocate purchase lots → view cycles and monthly results.

This does not execute orders or change a broker's FIFO or tax records. Total economic results do not change when lots are matched differently. Full history is required; holdings snapshots only reconcile quantities. Arbitrary PDFs receive local text preview, not guessed trading records.

## Free market-price connection

In **Settings → Free market prices**, enter your own free [IndianAPI stock key](https://indianapi.in/indian-stock-market). Do not put the key in GitHub or send it in chat. Lotbook requests the current NSE/BSE quote for each held ticker directly from your browser; only the ticker, your provider key, and ordinary network metadata reach IndianAPI. Names, share counts, transactions, statements and notes are never sent. The key and quote cache stay on this device and are excluded from JSON diary backups. Disconnect or Clear all local data removes them.

Quotes refresh when the app opens, and while visible during NSE hours at the chosen 15/30/60/120-minute interval (60 minutes by default, to conserve free API credits). A Refresh prices button requests updates on demand. The app is not a background quote service and does not refresh when closed. Provider limits, unsupported tickers and outages leave the most recent usable quote or a manually entered price; quotes older than seven days are excluded from valuation. Each holding shows its source and fetch time. The provider's documented response does not guarantee a market-trade timestamp, so *fetched now* must not be read as *traded now*. Verify material values against the broker before acting. Cash remains manual, and corporate actions can require reconciliation.

## Development

Node 22.16+; `npm ci`, `npm test`, `npm run dev`, `npm run build`. GitHub Actions tests and publishes `dist` through Pages. Base path is case-sensitive `/LotBook/`.

No app server, analytics, remote fonts or embedded secrets are included. Libraries are bundled. Financial records persist only in localStorage; raw documents are not retained. The shell cache stores public app assets only. JSON exports contain private records and belong in a private location. Profile naming is not authentication. Browser storage can be lost: export backups regularly.

All fixtures in tests are synthetic. Never commit user statements or backups. Private files belong outside the checkout or in the ignored `private-data/` directory.

MVP limits: long equity only; no corporate actions, dividends, short positions, mutual funds, margin, F&O, broker price API or cash-ledger reconstruction. The optional third-party quote feed is separate from Groww and does not certify prices, positions or taxes. The current Groww Stocks Order History and Stock Holding Statement layouts are locally verified; P&L and Capital Gains summaries are intentionally rejected as execution history. Future report variations may require mapping or aliases.

