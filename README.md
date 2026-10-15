# Lotbook

A local-only personal equity trading diary. Track purchase lots, core holdings, chosen-lot trading cycles, and an independent FIFO comparison.

**Live:** https://prabhav-patel-ops.github.io/LotBook/

**User flow and privacy:** [Guide](public/guide.html)

## Everyday use · v1.5.2

- **Diary → Activity:** newest-first date groups, search by stock name/symbol, type/month filters, and Show more. Tap any trade for costs, matched purchase lots, and record details. Sales show sold-lot P&L; purchases show gross purchase value with distinct labels.
- **Diary → Notes:** keep decision notes separately from transactions. Unsaved text survives in-app tab changes; Save note is required to keep it after a reload.
- **Diary → Rights trades:** separate entitlement records, when present. No acquisition cost or profit is invented.
- **Holdings:** three summary figures, compact price controls, and visible sold-share results. Tap a stock for quote source/time and purchase lots; expand the profit explanation for the FIFO comparison.
- **Statements:** order history first, holdings second; optional broker reports are grouped below. Replacement always requires review and confirmation.
- **Settings:** backups and updates first; quote settings, profile, installation, privacy and clearing data are expandable sections.

The layout refresh does not change the accounting engine or remove existing diary records.

Enter a name → upload Groww equity order history CSV/XLSX → review and classify buys → holdings → record an actual broker sale in the diary → allocate purchase lots → view cycles and monthly results.

This does not execute orders or change a broker's FIFO or tax records. Total economic results do not change when lots are matched differently. Full history is required; holdings snapshots only reconcile quantities. Arbitrary PDFs receive local text preview, not guessed trading records.

## Free market-price connection

In **Holdings → Refresh prices**, Lotbook can request keyless Yahoo Finance quotes through Jina Reader as a temporary, unofficial personal-use fallback. An optional [IndianAPI stock key](https://indianapi.in/indian-stock-market) can still be stored in Settings; if that service fails, the fallback is tried. Requested tickers are sent to quote providers. Only when a ticker has been renamed and both exchange forms fail, its public company name is sent to Yahoo Search to discover a current symbol; quantities, transactions, statements and notes are never sent. Never put a provider key in GitHub or chat. The key and quote cache stay on this device and are excluded from JSON diary backups.

Quotes refresh when the app opens, and while visible during NSE hours at the chosen 15/30/60/120-minute interval (60 minutes by default). A Refresh prices button requests updates on demand. Yahoo symbols are requested in validated, sequential batches of up to 10, keeping the nested relay URL below its rejection threshold; a failed batch is retried once. A 60–70 stock portfolio therefore normally needs six or seven rate-safe NSE requests plus any required BSE fallback batches instead of one or two requests per stock. Symbols containing punctuation such as `M&M` are safely relayed. The app does not refresh when closed. Provider limits, unsupported tickers and outages leave the most recent usable quote or a manually entered price; quotes older than seven days are excluded from valuation. Each holding shows its source and age; Yahoo's reported market timestamp is checked, while IndianAPI's fetch time is not a verified trade time. The relay has no uptime guarantee. Verify material values against Groww before acting. Cash remains manual.

If a broker statement still uses an old ticker after a rename or demerger, Lotbook searches by company name and accepts the replacement only when the company identity, Indian exchange, INR currency and returned quote all verify. This is generic discovery rather than a hardcoded ticker or corporate-action table.

## Development

Node 22.16+; `npm ci`, `npm test`, `npm run dev`, `npm run build`. GitHub Actions tests and publishes `dist` through Pages. Base path is case-sensitive `/LotBook/`.

No app server, analytics, remote fonts or embedded secrets are included. Libraries are bundled. Financial records persist only in localStorage; raw documents are not retained. The shell cache stores public app assets only. JSON exports contain private records and belong in a private location. Profile naming is not authentication. Browser storage can be lost: export backups regularly.

All fixtures in tests are synthetic. Never commit user statements or backups. Private files belong outside the checkout or in the ignored `private-data/` directory.

Automatic sales use the lowest-price available purchase lots. Explicit lot choices remain authoritative, and an older diary with conflicting manual choices is migrated by preserving its valid historical allocations. Sold-share P&L is visible for both current holdings and fully sold stocks. FIFO remains an independent comparison.

Corporate actions are detected separately after statement imports from Yahoo's public history and confirmed against the NSE action type, date and ratio; the Refresh prices button does not start these slower checks. Bonuses create zero-cost share lots; splits adjust quantities and unit costs without changing invested cost. Multiple actions are staged chronologically, and any supplied broker snapshot is checked at its own date. No ticker-specific bonus or split table is used. Sources that disagree, unsupported events, fractional bonus entitlements and incomplete histories require review. BSE corporate-action confirmation, dividends, short positions, mutual funds, margin, F&O and cash-ledger reconstruction are not automatic.

A complete Groww order-history import replaces the existing diary trades and clears prior snapshots, reference reports, manual prices, cash and import logs after confirmation. Rights-entitlement trades ending in `-RE` are retained separately in Diary and JSON backups, excluded from ordinary share-lot P&L; no missing purchase is invented. Holdings snapshots replace earlier snapshots, and P&L/Capital Gains reports replace matching report periods. Tax liability is not calculated. Future statement variations may require mapping. Export a backup before replacement.

Broker ticker display markers are normalized for quotes. If an NSE quote is unavailable, the app automatically tries the matching BSE ticker and accepts it only when the returned company identity agrees with the holding name. Full names and meaningful legal-name acronyms are supported, including truncated provider names; this generic path covers BSE-only holdings such as NSE and NSDL without a ticker-specific price table. Routine NSE corporate-action checks are skipped for confirmed BSE-only quotes, so they do not create irrelevant warnings.
