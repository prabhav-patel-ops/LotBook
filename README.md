# Lotbook

A local-only personal equity trading diary. Track purchase lots, core holdings, chosen-lot trading cycles, and an independent FIFO comparison.

**Live:** https://prabhav-patel-ops.github.io/LotBook/

**User flow and privacy:** [Guide](public/guide.html)

Enter a name → upload Groww equity order history CSV/XLSX → review and classify buys → holdings → record an actual broker sale in the diary → allocate purchase lots → view cycles and monthly results.

This does not execute orders or change a broker's FIFO or tax records. Total economic results do not change when lots are matched differently. Full history is required; holdings snapshots only reconcile quantities. Arbitrary PDFs receive local text preview, not guessed trading records.

## Free market-price connection

In **Holdings → Refresh prices**, Lotbook can request keyless Yahoo Finance quotes through Jina Reader as a temporary, unofficial personal-use fallback. An optional [IndianAPI stock key](https://indianapi.in/indian-stock-market) can still be stored in Settings; if that service fails, the fallback is tried. Only requested tickers are sent to quote providers, not names, quantities, transactions, statements or notes. The relay and quote provider can see the requested tickers. Never put a provider key in GitHub or chat. The key and quote cache stay on this device and are excluded from JSON diary backups.

Quotes refresh when the app opens, and while visible during NSE hours at the chosen 15/30/60/120-minute interval (60 minutes by default). A Refresh prices button requests updates on demand. The app does not refresh when closed. Provider limits, unsupported tickers and outages leave the most recent usable quote or a manually entered price; quotes older than seven days are excluded from valuation. Each holding shows its source and age; Yahoo's reported market timestamp is checked, while IndianAPI's fetch time is not a verified trade time. The relay has no uptime guarantee. Verify material values against Groww before acting. Cash remains manual.

## Development

Node 22.16+; `npm ci`, `npm test`, `npm run dev`, `npm run build`. GitHub Actions tests and publishes `dist` through Pages. Base path is case-sensitive `/LotBook/`.

No app server, analytics, remote fonts or embedded secrets are included. Libraries are bundled. Financial records persist only in localStorage; raw documents are not retained. The shell cache stores public app assets only. JSON exports contain private records and belong in a private location. Profile naming is not authentication. Browser storage can be lost: export backups regularly.

All fixtures in tests are synthetic. Never commit user statements or backups. Private files belong outside the checkout or in the ignored `private-data/` directory.

MVP limits: long equity only; one exchange-verified LICI 1:1 bonus event is supported as a zero-cost lot, but other corporate actions, dividends, short positions, mutual funds, margin, F&O, broker price API and cash-ledger reconstruction are not automatic. A complete Groww order-history import replaces the existing diary trades and clears prior snapshots, reference reports, manual prices, cash and import logs after explicit confirmation; export a backup first. Holdings snapshots replace earlier snapshots, and P&L/Capital Gains reports replace matching report periods. The optional third-party quote feed is separate from Groww and does not certify prices, positions or taxes. The current Groww Stocks Order History and Stock Holding Statement layouts are locally verified; P&L and Capital Gains summaries are intentionally rejected as execution history. Future report variations may require mapping or aliases.
