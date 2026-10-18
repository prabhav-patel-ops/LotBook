# LotBook 1.7.1 mobile reconciliation verification — 18 October 2026

- Profit figures and holdings-statement rows now use explicit mobile grids, block-level labels and non-wrapping monetary values instead of concatenated text and broken amount lines.
- The statement comparison shows only differing rows (or a small matched sample), hides the remaining matched positions, and treats newer manual diary activity as neutral context rather than an error.
- A snapshot whose quantity factor and inverse average-cost movement agree within tolerance triggers another generic public corporate-action verification. No LICI, bonus or split value is hardcoded and no shares are created without external verification.
- All 178 automated tests and the production build passed.

## LotBook 1.7.0 portfolio filter verification — 16 October 2026

- Holdings can be filtered to all positions, positions trading above their cheapest open purchase, or positions trading at/below that purchase. Unknown-price positions remain available under All instead of being misclassified.
- The portfolio can be ordered by name, current price, return percentage, unrealised profit/loss, or percentage distance from the cheapest open purchase, in either direction. Missing numeric values stay at the end.
- The cheapest-purchase filter reuses the verified corporate-action-adjusted lot comparison, so eligible splits and bonuses are reflected before a position is marked green or red.
- All 177 automated tests and the production build passed. New tests cover filters, text search, each numeric sort and missing-value ordering.

## LotBook 1.6.2 broker-total and tax-boundary verification — 15 October 2026

- The Holdings headline now prefers the imported Groww quantity × average-cost total only when every current quantity matches and no transaction is newer than that statement. Otherwise it says `FIFO estimate` instead of presenting a selected-lot diary cost as Groww's number.
- LotBook's lowest-price-first remaining cost is retained separately under `Understand your profit figures`. The independent FIFO replay excludes diary buy charges from the broker-style invested estimate.
- The Info tab explains that a custom lot match does not alter taxable FIFO and that selling below the displayed average does not by itself establish a capital loss. Broker Capital Gains remains the filing reference; no exact PAT is claimed.
- All 175 automated tests and the production build passed. New tests cover exact statement totals and stale, incomplete, missing-average and quantity-mismatch fallbacks.

## LotBook 1.6.1 corporate-action cost-basis verification — 15 October 2026

- The red/green comparison now dilutes each eligible purchase price by verified bonus factors. A ₹808 purchase followed by a 1:1 bonus is therefore compared at ₹404, and the zero-cost bonus record is excluded from the threshold.
- Verified splits continue to scale pre-action lot prices, while purchases made after a bonus or split retain their original price. Original transactions and existing saved lot selections remain unchanged for backward compatibility.
- Tests cover bonus, split, post-action purchases and closed-lot exclusion. All 173 automated tests and the production build passed.

## LotBook 1.6.0 lowest-open-lot signal verification — 15 October 2026

- Every quoted holding now compares its current market/manual price with the cheapest purchase lot that still has shares remaining. Closed lots cannot influence the signal.
- Rows above that level are visibly green; rows at or below it are visibly red. Each row also gives an explicit `Above`, `Below`, or `At lowest buy` label and the rupee difference, while missing prices remain neutral.
- Privacy mode masks every rupee amount inside the new comparison. All 171 automated tests and the production build passed.

## LotBook 1.5.2 relay-safe price verification — 15 October 2026

- Reproduced the reported production failure: the live relay returned HTTP 200 but rejected each 25-symbol nested URL, producing exactly `15 updated · 25 issue(s)` for a 40-stock portfolio.
- Quote groups are now capped at 10 symbols. A live 40-stock NSE regression resolves 39 current symbols directly; the one retired ticker is discovered generically from its verified company identity and then quoted under its current exchange symbol.
- 168 automated tests passed, including guards for the 10-symbol relay limit and generic renamed-ticker discovery without a hardcoded map.

## LotBook 1.5.1 rate-safe price verification — 15 October 2026

- 166 automated tests passed. A synthetic 70-stock portfolio refreshes in three sequential Yahoo/Jina batch requests rather than 70–140 per-stock requests; observed request concurrency is exactly one.
- Mixed NSE and BSE coverage passed: direct BSE symbols and verified NSE-to-BSE fallbacks resolve inside the batch pipeline without ticker-specific rules.
- Each returned quote still requires an exact ticker, INR currency, recent market timestamp and usable positive price. BSE fallback additionally requires matching company identity.
- A failed or rate-limited batch is retried once without discarding successful batches. An optional IndianAPI key is used only for symbols left unresolved after the faster free batch refresh.
- Ampersands inside symbols such as `M&M` survive both relay decoding layers and reach Yahoo as part of the ticker.
- Price refresh is fully separated from corporate-action checks, so the price button does not start dozens of share-event requests or produce their rate-limit warnings. Share events remain checked after statement imports.

## LotBook 1.4.1 BSE and mobile-layout verification — 14 October 2026

- 162 automated tests passed. New cases cover normalized full-name and legal-acronym identity matching, exact BSE fallback, truncated provider company names and rejection of unrelated same-ticker results.
- Production build passed. A dedicated 390 × 844 Edge regression reproduced the reported `NSE$` holding: the NSE quote failed, `NSE.BO` resolved with an exact BSE identity, and no irrelevant NSE corporate-action request or warning was produced.
- Large Indian-formatted holding totals remained on one line without clipping. The Holdings summary becomes compact single-column cards on narrow phones.
- The Info guide hero and report heading use consistent mobile insets. The dedicated regression also confirmed no horizontal page overflow.
- The quote logic remains generic: no NSE, NSDL, split or bonus price is hardcoded. Only a quote whose returned company identity agrees with the local holding is accepted.

## LotBook 1.4.0 usability verification — 14 October 2026

- 160 automated tests passed, including diary name/type/month filters, stable ordering, complete history pagination beyond 500 entries, and input immutability. The accounting engine is unchanged.
- Production build passed. Isolated Edge checks at 320, 390, 768 and 1440 pixels covered all six screens without horizontal overflow.
- Browser checks covered search, combined filters, empty results, Show more, transaction details, cost editing, cheapest-lot matching, saved notes after reload, unsaved notes across tabs, rights records and privacy masking.
- The 424-row replacement and verified bonus-sale import regression checks also passed on the redesigned production build. Only synthetic records were used.
- Screenshots were inspected for mobile and desktop layout. Physical phones and arbitrary third-party report variants were not available for testing.

## LotBook 1.3.0 verification — 14 October 2026

- 149 automated tests passed, covering cheapest-lot matching, rights-entitlement separation and backup retention, legacy explicit-allocation recovery, verified bonus/split handling, chronological multiple actions and snapshot-date cutoffs.
- Production build passed; production dependency audit reported zero known vulnerabilities.
- Headless Edge at 390 × 844: sold-lot P&L visible, no page overflow, a 424-row synthetic import confirmed and replaced prior test history, and a rights-entitlement sale remained in Diary separately.
- Live public-source checks: NSDL's BSE price and timestamp returned through the generic quote fallback; LICI's bonus factor was matched against NSE. The relay intermittently omits source content; unmatched events remain unapplied and can be retried.
- No personal statement, backup, account identifier or private position was published. Market requests contain public tickers and history parameters; purchase dates are filtered locally.
- Physical phone installation and the reporting user's exact 424-trade file were not directly tested. Synthetic reproduction covers the screenshot's STALL-RE blocker. The free external services remain best-effort.

## Earlier release record — 28 September 2026

## Passed

- 117 automated tests: pure accounting, independent FIFO, partial quantities and fee allocation, chronology, invalid/oversold lots, import multiplicity and stable identifiers, unknown-cost migration, CSV/XLSX parsing, status filtering, report mapping, snapshot reconciliation, stale-tab protection, backup validation, CSV formula protection, monthly rounding, offline cache navigation, Capital Gains term separation, P&amp;L reference parsing and reference-backup validation.
- Production build; production dependency audit found zero known vulnerabilities at release time.
- Browser onboarding, manual purchases, Core/Trading classification, lowest-price sale selection, manual valuation and persistence after refresh.
- Synthetic CSV browser preview and confirmation, cost correction, historical sale allocation and complete holdings reconciliation all matched the expected ledger.
- Local read-only verification against a supplied Groww report set: Stocks Order History replayed with zero ledger errors or import conflicts; Stock Holding Statement reconciled positions and visibly surfaced a real missing-history difference. P&amp;L and Capital Gains reports parsed as local references, with short-term and long-term Capital Gains sections kept distinct; they remain blocked from changing trade lots. No filenames, account identifiers, position counts or personal values were committed or uploaded.
- Browser JSON export created a local file; restore validated the file, requested confirmation, and preserved 5 synthetic transactions.
- Mobile-width holdings, cycle and settings views; desktop and hosted demo rendering. No horizontal overflow observed in checked views.
- GitHub Actions build and Pages deployment; hosted app, guide, manifest, service worker and all install icons returned HTTP 200.

## Not represented as verified

- Other Groww report versions can still change their headings or semantics. Every import remains a review step; verify that Value is gross executed consideration and that the report contains executed equity orders.
- No physical Android/iPhone was available. Manifest, icons, HTTPS and service worker are configured; installation/offline reopening must be confirmed in the phone's normal browser. Stopping the local preview did not provide a reliable offline browser check; cache logic has automated coverage.
- Arbitrary PDFs are not auto-converted into trade histories. PDF text is shown locally; use CSV/XLSX or manual purchases.
- No live trading, broker API, final tax-payable calculation, dividends or corporate-action support. The Info tab states the applicable report meanings and tax-reference boundaries; past imported sales may now be rematched to available diary lots, but this never changes broker records or tax FIFO.

## Privacy boundaries

Only source code and synthetic tests were committed. No user statements or backups entered the repository. The release has no analytics or external data-processing calls; files are parsed in browser memory and records saved locally. CSP restricts runtime connections to the hosting origin.

Local storage is not encrypted or authenticated. Shared/unlocked browser access and other trusted apps on the same GitHub Pages origin are security boundaries, not separate user accounts. Browser clearing or device loss can erase the diary; export private JSON backups regularly. GitHub still receives ordinary asset requests.
