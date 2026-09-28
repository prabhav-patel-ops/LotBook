# Lotbook

A local-only personal equity trading diary. Track purchase lots, core holdings, chosen-lot trading cycles, and an independent FIFO comparison.

**Live:** https://prabhav-patel-ops.github.io/LotBook/

**User flow and privacy:** [Guide](public/guide.html)

Enter a name → upload Groww equity order history CSV/XLSX → review and classify buys → holdings → record an actual broker sale in the diary → allocate purchase lots → view cycles and monthly results.

This does not execute orders or change a broker's FIFO or tax records. Manual quotes are not live data. Total economic results do not change when lots are matched differently. Full history is required; holdings snapshots only reconcile quantities. Arbitrary PDFs receive local text preview, not guessed trading records.

## Development

Node 22.16+; `npm ci`, `npm test`, `npm run dev`, `npm run build`. GitHub Actions tests and publishes `dist` through Pages. Base path is case-sensitive `/LotBook/`.

No server, analytics, remote fonts, secrets or account data are included. Libraries are bundled. Financial records persist only in localStorage; raw documents are not retained. The shell cache stores public app assets only. JSON exports contain private records and belong in a private location. Profile naming is not authentication. Browser storage can be lost: export backups regularly.

All fixtures in tests are synthetic. Never commit user statements or backups. Private files belong outside the checkout or in the ignored `private-data/` directory.

MVP limits: long equity only; no corporate actions, dividends, short positions, mutual funds, margin, F&O, price APIs or cash-ledger reconstruction. The current Groww Stocks Order History and Stock Holding Statement layouts are locally verified; P&L and Capital Gains summaries are intentionally rejected as execution history. Future report variations may require mapping or aliases.
