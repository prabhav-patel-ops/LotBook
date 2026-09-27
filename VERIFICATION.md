# First release verification — 27 September 2026

## Passed

- 53 automated tests: pure accounting, independent FIFO, partial quantities and fee allocation, chronology, invalid/oversold lots, CSV/XLSX parsing, status filtering, report mapping, backup validation, CSV formula protection, monthly rounding and offline cache navigation.
- Production build; production dependency audit found zero known vulnerabilities at release time.
- Browser onboarding, manual purchases, Core/Trading classification, lowest-price sale selection, manual valuation and persistence after refresh.
- Synthetic CSV preview and confirmation: 2 executed trades accepted; 1 cancelled order excluded. Resulting holdings and fees matched the expected ledger.
- Browser JSON export created a local file; restore validated the file, requested confirmation, and preserved 5 synthetic transactions.
- Mobile-width holdings, cycle and settings views; desktop and hosted demo rendering. No horizontal overflow observed in checked views.
- GitHub Actions build and Pages deployment; hosted app, guide, manifest, service worker and all install icons returned HTTP 200.

## Not represented as verified

- An actual Groww export has not been supplied. The first import needs reconciliation against the broker's holdings and executed trades. Format variations may need column mapping or aliases.
- No physical Android/iPhone was available. Manifest, icons, HTTPS and service worker are configured; installation/offline reopening must be confirmed in the phone's normal browser. Stopping the local preview did not provide a reliable offline browser check; cache logic has automated coverage.
- Arbitrary PDFs are not auto-converted into trade histories. PDF text is shown locally; use CSV/XLSX or manual purchases.
- No live trading, broker API, tax output, dividends or corporate-action support. Past imported sales use FIFO; selecting lots applies to newly recorded sales.

## Privacy boundaries

Only source code and synthetic tests were committed. No user statements or backups entered the repository. The release has no analytics or external data-processing calls; files are parsed in browser memory and records saved locally. CSP restricts runtime connections to the hosting origin.

Local storage is not encrypted or authenticated. Shared/unlocked browser access and other trusted apps on the same GitHub Pages origin are security boundaries, not separate user accounts. Browser clearing or device loss can erase the diary; export private JSON backups regularly. GitHub still receives ordinary asset requests.
