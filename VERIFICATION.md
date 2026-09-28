# Import reliability release verification — 28 September 2026

## Passed

- 114 automated tests: pure accounting, independent FIFO, partial quantities and fee allocation, chronology, invalid/oversold lots, import multiplicity and stable identifiers, unknown-cost migration, CSV/XLSX parsing, status filtering, report mapping, snapshot reconciliation, stale-tab protection, backup validation, CSV formula protection, monthly rounding and offline cache navigation.
- Production build; production dependency audit found zero known vulnerabilities at release time.
- Browser onboarding, manual purchases, Core/Trading classification, lowest-price sale selection, manual valuation and persistence after refresh.
- Synthetic CSV browser preview and confirmation, cost correction, historical sale allocation and complete holdings reconciliation all matched the expected ledger.
- Local read-only verification against a supplied Groww report set: Stocks Order History replayed with zero ledger errors or import conflicts; Stock Holding Statement reconciled positions and visibly surfaced a real missing-history difference. P&amp;L and Capital Gains summaries were blocked as trade sources. No filenames, account identifiers, position counts or personal values were committed or uploaded.
- Browser JSON export created a local file; restore validated the file, requested confirmation, and preserved 5 synthetic transactions.
- Mobile-width holdings, cycle and settings views; desktop and hosted demo rendering. No horizontal overflow observed in checked views.
- GitHub Actions build and Pages deployment; hosted app, guide, manifest, service worker and all install icons returned HTTP 200.

## Not represented as verified

- Other Groww report versions can still change their headings or semantics. Every import remains a review step; verify that Value is gross executed consideration and that the report contains executed equity orders.
- No physical Android/iPhone was available. Manifest, icons, HTTPS and service worker are configured; installation/offline reopening must be confirmed in the phone's normal browser. Stopping the local preview did not provide a reliable offline browser check; cache logic has automated coverage.
- Arbitrary PDFs are not auto-converted into trade histories. PDF text is shown locally; use CSV/XLSX or manual purchases.
- No live trading, broker API, tax output, dividends or corporate-action support. Past imported sales may now be rematched to available diary lots, but this never changes broker records or tax FIFO.

## Privacy boundaries

Only source code and synthetic tests were committed. No user statements or backups entered the repository. The release has no analytics or external data-processing calls; files are parsed in browser memory and records saved locally. CSP restricts runtime connections to the hosting origin.

Local storage is not encrypted or authenticated. Shared/unlocked browser access and other trusted apps on the same GitHub Pages origin are security boundaries, not separate user accounts. Browser clearing or device loss can erase the diary; export private JSON backups regularly. GitHub still receives ordinary asset requests.
