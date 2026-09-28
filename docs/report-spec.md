# Import and reconciliation correctness specification

Author: Rose, independent research and financial correctness review for Jasmine. Reviewed 28 September 2026. This is a specification and source review, not a claim that all requirements are implemented.

## Questions to resolve at the first import

Ask these before calling a report complete or reconciled; a local preview can proceed with unresolved answers clearly marked.

1. Is this **Stocks Order History**, an executed-trade report, a P&L summary, or a dated holdings statement? What account, date range, and worksheet does it cover?
2. Does `Quantity` mean shares actually executed, including partial fills, or shares ordered? Does `Value` mean gross value of those executions, a requested order amount, or an amount including charges? Confirm against one contract-note entry locally.
3. Does the history include purchases before the selected range, transfers from another broker, IPO allotments, splits, bonuses, mergers, or other quantity changes?
4. Does execution date include a time, and is the report sorted chronologically? Are there sales and repurchases of the same security on the same day? What does Groww classify as delivery versus intraday?
5. Are actual charges available in contract notes, the accompanying DP statement, or the broker ledger? Is a zero explicitly recorded or merely absent?
6. What is the holdings statement's effective date and account scope? Does quantity include pledged shares, unsettled purchases, or MTF positions, and is it total ownership or only quantity available to sell?

These are data correctness questions, not requests for PAN, passwords, credentials, or personal screenshots. Tax estimation would require a separate scope and additional evidence; see [Charges and tax boundaries](charges-and-tax-boundaries.md).

## Evidence and assumptions

- The supplied scenario specifies these headers: `Stock name, Symbol, ISIN, Type, Quantity, Value, Exchange, Exchange Order Id, Execution date`. They describe a candidate mapping, not proof of every row's execution or `Value` basis.
- No personal screenshot or financial file was opened for this review. No screenshot metadata beyond the scenario was supplied to Rose. Report name, filter range, as-of date, and units remain unverified. A screenshot capture timestamp is not an execution timestamp or statement date.
- Research used generic queries and public official webpages only. All examples below are synthetic.
- Scope is one identified account's long Indian cash equity diary, with INR amounts. `core` and `trading` are diary choices. They do not establish a broker product type or tax classification.
- Source observations refer to `README.md`, `src/importer.js`, `src/ledger.js`, and the import/reconciliation paths in `src/main.js` and `src/storage.js` as inspected. Other agents may subsequently change them.
- Ordinary cash-equity executions normally use whole shares; an unexpected fractional quantity requires format/instrument review. The current general ledger permits positive fractional quantities.

## 1. Obtain separate history and holdings evidence

Groww's official help gives the history route: Profile → Reports → Transactions → desired report → select time frame → Download. The help page describes uppercase PAN as a report password; the user should open a protected report privately. The app must not collect that password. [G1]

Groww's May 2025 product update confirms both a dated **Stock Holding Statement** in Reports and **Stocks Order History** for a date range, including intraday orders previously missing from transaction history. Choose the equity history for all relevant periods; do not assume an older transaction report includes every intraday execution. [G2]

For current quantities, look in Profile → Reports for Stock Holding Statement and choose the appropriate as-of date when offered. G2 verifies availability, but does not document an exact current submenu, download format, or worksheet schema. Do not promise a particular CSV/XLSX export or invent menu steps. Use the format Groww actually offers.

Safe manual fallback if a compatible holdings export is unavailable:

1. Privately view the broker holdings page or dated broker/depository holding statement. Groww describes access through a broker or the relevant depository portal. [G3]
2. Locally enter a snapshot table with `Symbol`, `ISIN` when known, `Quantity`, `As of`, and account alias. Add `Average price` only if the broker supplies it; identify its basis. Record pledged/unsettled/MTF scope separately.
3. Check every entered quantity against the displayed source. Mark the snapshot manually transcribed, with its coverage and date. This is reconciliation evidence, never a purchase import.
4. If the current importer insists on an average price and none is available, keep a quantity-only local table for manual comparison until supported; never invent a price to pass validation.

A PDF may be inspected locally, but arbitrary PDF text does not establish column relationships. The current importer offers local PDF text preview only. Images/screenshots require a checked manual transcription; do not send them to an AI, OCR, cloud conversion service, or research API.

## 2. Required mapping for the supplied Groww layout

| Source header | Meaning to preserve | Required normalization |
| --- | --- | --- |
| `Stock name` | Display name | Preserve separately from security identity. |
| `Symbol` | Trading symbol | Prefer this explicit column over company name; normalize whitespace/case. |
| `ISIN` | Security identifier | Preserve and use to review aliases/renames; never merge conflicting identifiers silently. |
| `Type` | Candidate BUY/SELL side | Accept explicit recognized buy/sell values; other types need review. |
| `Quantity` | Candidate executed share count | Positive finite count, with execution basis confirmed. |
| `Value` | Candidate total execution value in INR | Preserve total; derive unit price only after gross/executed basis is established. |
| `Exchange` | Execution venue | Preserve provenance; do not split identical demat holdings merely because venue differs. |
| `Exchange Order Id` | Order identifier | Preserve as text, including leading zeros; not necessarily a unique fill identifier. |
| `Execution date` | Execution date, possibly timestamp | Parse documented local format; preserve time when present and normalize to Asia/Kolkata trading date. |

For a confirmed gross total of executed trades:

```text
unitPrice = grossExecutedValue / executedQuantity
grossExecutedValue = executedQuantity × unitPrice
```

Example: `Quantity = 10`, `Value = 12,500` means ₹1,250/share, not ₹12,500/share. With `Quantity = 3`, `Value = 100`, retain sufficient precision for ₹100 total; premature rounding to ₹33.33/share loses one paisa.

If both total value and unit price exist, reconcile their product using the report's documented rounding precision. Preserve authoritative total value and any rounding difference. If the source gives an amount after charges, do not divide it into a gross price or subtract charges again. Unknown amount basis requires review. Do not reverse-engineer fees from unexplained differences.

Order-level average prices are quantity-weighted: sum execution values divided by sum executed quantities. Aggregate only fills from the same identified order/security/side/date whose quantities and values are consistently defined. Repeated order rows may be updated cumulative totals rather than new fills; they cannot simply be summed.

Header-only recognition of this layout may suggest `Value/Quantity`; it cannot establish execution status or whether values include fees. Provide a preview of original quantity, value, derived price, and the assumed basis. Mapping `Value` directly to a field labeled unit price is prohibited.

## 3. Executed quantities and row validation

- Distinguish requested quantity, executed quantity, and outstanding quantity. Only executions change shares or create cycles.
- Prefer an explicit executed/traded/filled quantity over order quantity. A request for 10 shares with 4 executed creates 4 shares, and requires the value for those same 4 executions.
- Pending, open, rejected, failed, and unexecuted cancelled rows create no transaction. A cancelled or expired order with confirmed executed fills can still have real trades: retain the evidenced fills, exclude its unfilled balance, and do not rely solely on final order status.
- Partially filled rows require a positive executed quantity and compatible executed value/price. Missing executed amount basis is a blocker for that row.
- The supplied nine headers contain no status or dedicated executed-quantity column. Treat this as a format assumption requiring confirmation of report semantics, not proof that every order executed. An execution date by itself is insufficient evidence.
- Reject non-finite numbers, invalid dates, non-positive executed quantities/prices, incompatible sides, and conflicting identities. Keep per-row reasons. Do not partially parse malformed numbers or coerce blanks into financial facts.
- Skip metadata, footers, totals, and repeated headers as non-transactions. Retain report range/account/as-of metadata separately when explicitly present, with local provenance.
- Require a clear day-first mapping for Indian dates. A missing time remains unknown. Do not turn file creation time, row number, or arbitrary midnight into a claimed execution time.

## 4. Unknown charges must survive import and saving

Use at least three distinct states: `unknown`, `known-zero`, and `known-amount`; component-level partial coverage may require `partial`. The data contract must retain amount, coverage, and provenance separately. Missing column, blank cell, or omitted backup field means unknown, not known-zero. An explicitly verified zero remains a legitimate zero.

Gross results can be shown with missing fees. Results after only the fees available must say **after recorded costs; charges incomplete; before personal income tax**. Do not show an unqualified “net profit” or “all charges included.” Estimated rates belong in a separate optional estimate and must never replace recorded broker charges. [G4, G5, N1]

See the companion document for component categories, allocation, and tax boundaries. Older saved records with `charges: 0` and no provenance cannot automatically be upgraded to verified zero.

## 5. Ordering, identity, and duplicate handling

Execution chronology controls lot availability. Sort by trading date and reliable execution time/sequence when known. When same-day ordering is unknown, retain source order with an explicit assumption, and require review where a different order changes availability or lot attribution. Combining exports introduces an additional ordering problem: file-import order is not execution order.

Never sort all same-day buys before sells to make a ledger balance. A sale before a later buy may consume earlier holdings, but must not consume that later purchase. A sale with no available prior holdings is missing history or an unsupported short/intraday situation; reject or quarantine it rather than synthesizing a purchase.

Example: an earlier lot has 10 shares; at 09:30 sell 10, and at 14:00 buy 10. The diary sale can consume the earlier lot; it cannot be allocated to the 14:00 purchase. If there was no earlier lot, the long-only diary cannot accept the 09:30 sale.

Broker reconciliation has an additional boundary: Groww states that its holding average uses FIFO and excludes intraday trades, including same-day sales and repurchases. Therefore a chronologically valid diary that consumes old shares and records a rebuy may still differ from Groww's remaining average. Use the broker's delivery/intraday classification; the nine supplied headers do not establish it. A basic all-executions FIFO comparison must be labeled **diary FIFO comparison**, not verified broker or tax FIFO. [G6]

Duplicate handling must:

- Use reliable broker execution identifiers when available, scoped to account and venue/date as appropriate. Preserve order identifiers but allow multiple genuine fills per order.
- Identify identical exports/overlapping ranges without losing repeated identical genuine fills. Same symbol/date/side/quantity/price/charges alone is only a suspected duplicate.
- Show suspicious pairs for review when identity is insufficient; do not silently discard genuine identical fills or create an extra sale when a manual diary sale is later imported.
- Treat changed charges on the same execution as a correction needing reconciliation, not automatically as another execution.
- Preserve the local record identifier, source row/sheet, mapping/basis, and user resolution. Unknown fees must not collapse into zero for duplicate matching.

## 6. Chosen lots and independent FIFO

Maintain two independent consumption states for the same accepted long-equity execution stream: chosen purchase lots for the diary, and oldest available purchases for a FIFO comparison. User allocations must never change the FIFO state. Both consume the same sell quantity; neither may use a future lot, another security/account, or an exhausted balance.

Explicit allocations must be positive, unique per lot, and sum to the executed sale quantity. Validate all allocations and both accounting paths before changing either path. Invalid sales change neither ledger state.

For an allocation of quantity `q` from original buy quantity `Qb`, into a sell of quantity `Qs`:

```text
gross = q × (sellUnitPrice − buyUnitPrice)
recordedCosts = buyRecordedCosts × q/Qb + sellRecordedCosts × q/Qs
resultAfterRecordedCosts = gross − recordedCosts
```

Unknown fee coverage propagates to the cycle. Remaining buy costs stay with unsold shares. Every actual charge is included once across realized and remaining cost allocations. Allocation of aggregate contract-note charges is a disclosed diary convention, not necessarily the broker's fill allocation or tax treatment.

Synthetic attribution check: buy 10 at ₹1,300, later buy 10 at ₹1,250, then sell 10 at ₹1,270. Choosing the later lot gives ₹200 realized gross; FIFO gives −₹300 realized gross. At a common quote of ₹1,270 the remaining gross unrealized results are −₹300 and ₹200 respectively. Both total −₹100 before costs. Matching lots changes attribution, not economic wealth.

At a common valuation time with all remaining shares priced, complete history, and the same cost coverage:

```text
realized after recorded costs + unrealized after remaining buy costs
= sale proceeds + remaining market value − all buy values − recorded costs
```

Do not compare diary realized alone with FIFO realized and describe the difference as money saved, profit created, or income tax reduced. The comparison does not execute a broker order or select a tax lot. For demat FIFO background and the limits of treating this diary as a tax record, see [T1] and the companion document.

## 7. Current holdings reconciliation

The current holdings snapshot is an observation at a date, not transaction history. It must not create purchases, cash flows, realized profit, execution dates, or acquisition lots. Aggregate quantity and average price cannot reconstruct earlier buys and sells. Groww distinguishes holding statements from transaction statements. [G3]

Compare the same account/security and effective cut-off:

```text
expectedQuantity = evidenced opening quantity + executed buys − executed sells
                 + supported quantity adjustments
delta = snapshotQuantity − expectedQuantity
```

Use the union of securities in both snapshot and ledger: snapshot-only securities and diary-only securities must both appear. An absent security can mean zero only in a confirmed complete snapshot. For a partial snapshot, absence means unknown. Whole-share comparisons should be exact; any numerical tolerance for other supported quantities must be explicit and must not hide a missing share.

Required output per security: identity/account, snapshot date and scope, snapshot quantity, diary quantity at that date, difference, and unresolved cause. Likely causes include missed earlier buys/sales, duplicate fills, transfers, corporate actions, settlement cut-offs, pledged versus sellable quantity, or mixing MTF/intraday with delivery.

Separate **quantity matched**, **cost basis compared**, and **history complete**. Quantity matching does not prove complete history, correct fees, or correct acquisition dates. An import success message is not reconciliation success. Show stale/undated or incomplete coverage prominently.

A broker holding average and diary average may differ because of chosen lots, intraday exclusions, included buy charges, or corporate-action adjustments. Label each basis; do not replace the ledger's cost automatically with a snapshot average.

## 8. Missing history and corporate actions

Retrieve earlier periods and broker records first. If history is unavailable, an opening position is an explicitly documented starting balance, not an invented historical execution. Record effective opening date separately from original acquisition dates, with known/unknown cost and charges, source, and scope. If the app only supports ordinary BUY records, identify any supported opening-lot workaround in its note and mark historical results incomplete. Do not invent a historical price/date or fee zero merely to satisfy its validation.

A snapshot of today's remaining shares cannot supply the opening position before sales already present in the history. Do not add those current shares as a backdated buy to make imports pass. An aggregate opening position may allow quantity tracking; it does not establish historical FIFO or holding periods.

Splits, bonuses, rights issues, mergers/demergers, buybacks, symbol/ISIN changes, transfers, and IPO allotments require event-specific quantity/cost evidence. Unsupported events must remain unresolved; do not encode them as arbitrary buys/sells, force quantities to match, or infer a tax basis. Dividends require separate cash/income records and are outside current trade-only results. Without them, do not label the output total investment return.

## 9. Review findings and implementation acceptance checks

### Observed source gaps

| Source location | Observation at review | Financial consequence / required behavior |
| --- | --- | --- |
| `src/importer.js`, `aliases` / `fieldsFor` | Requires unit price; has no total `Value` mapping. Symbol alias order prefers stock/name forms before `Symbol`. | Supplied layout requires review; explicit symbol and total-to-unit derivation need support. |
| `src/importer.js`, `parseRows` | Absent/blank charges become `0`. | Unknown and verified zero are indistinguishable. |
| `src/importer.js`, status filter | Uses executed quantity for partial fills, but excludes all cancelled/expired status rows. | A final cancelled order with real fills needs explicit fill evidence rather than losing those executions. |
| `src/ledger.js`, `validateTransaction` / `analyse` | Defaults omitted charges to zero; does not retain ISIN, trade time, or broker IDs; sorts by date then array position. | Provenance and chronology cannot survive the present normalized record path. |
| `src/main.js`, `duplicateKey` | Matches symbol/date/side/quantity/price/charges only. | Genuine identical fills can be skipped; updated fees can duplicate a trade. |
| `src/main.js`, reconciliation; `src/storage.js`, snapshot normalization | Checks snapshot rows against current holdings; snapshots lack as-of/account/coverage metadata. | Diary-only positions and historic/stale snapshot cut-offs can be missed. |
| `src/ledger.js`, FIFO path | Independent FIFO consumption exists, but no broker intraday netting/classification model. | A useful diary comparison cannot be advertised as broker-verified FIFO. |
| `src/importer.js`, workbook selection | Selects one worksheet; row/file limits can truncate coverage. | Show selected sheet and exclusions; never silently claim full history. |

These are implementation requirements for the owning agent. This review changes documentation only.

### Acceptance cases (synthetic; no tests written by Rose)

1. The exact nine-column layout with executed quantity 10 and gross value ₹12,500 previews unit price ₹1,250 and explicit `Symbol`, preserving name/ISIN/exchange/order ID. Missing charges remain unknown through save, reload, and export.
2. An explicit verified zero charge remains known-zero; a blank charge or missing fee column does not. A partial component list cannot be labeled complete net.
3. Requested 10, executed 4, compatible executed value ₹4,000 imports 4 at ₹1,000. Pending 6 imports nothing. A cancelled order with 4 confirmed fills imports only those fills; unsupported value basis stops that row.
4. Quantity 3 and gross value ₹100 retains a ₹100 total after normalization. Conflicting value/price beyond documented rounding is reported, not silently corrected.
5. A sale at 09:30 cannot consume a same-day buy at 14:00. Unknown ordering or an unsupported short sale remains visible. Same-day repurchase classification is checked against broker records before a broker-FIFO match is asserted.
6. Two distinct genuine fills with identical numerical fields survive; importing the same evidenced execution twice does not add shares. Fee corrections do not create a second trade.
7. A holdings snapshot leaves transactions and P&L unchanged. Compare snapshot-only and diary-only securities at its cut-off; a partial or undated snapshot cannot produce an unqualified “all holdings match.”
8. Changing allocations changes chosen-lot realized/unrealized attribution but not FIFO consumption or combined economic result. Costs allocated to sold and remaining shares reconcile to recorded amounts once.
9. A missing opening buy or unsupported split produces an unresolved-history result. Quantity matching by itself cannot certify complete history or tax correctness.
10. Import review reports accepted, rejected, suspected-duplicate, pending, metadata, and excluded/truncated rows and sheets. Proposed accepted records are checked with existing history before committing; a failed reconciliation does not quietly persist an invalid trading history.

## Sources

Public primary webpages checked 28 September 2026. Navigation and rates may change; recheck before implementation. References describe broker features/general boundaries, not the user's private statement.

- **G1:** [Groww: Where can I get the transaction history?](https://groww.in/help/my-account/ma-others/where-can-i-get-the-transaction-history) — report request steps.
- **G2:** [Groww product update, 6 May 2025](https://groww.in/updates/updates-from-groww-tax-loss-harvesting-intraday-oco-bonds-and-lots-more) — Stock Holding Statement and Stocks Order History availability.
- **G3:** [Groww: What is a Demat Account Holding Statement?](https://groww.in/blog/demat-account-holding-statement) — holdings versus transaction statements and access routes. Used for these distinctions, not its broad tax-filing assertions.
- **G4:** [Groww: What is a Contract Note and How to Interpret It?](https://groww.in/blog/what-is-a-contract-note-how-to-interpret-it) — execution details, charges, and accompanying DP statement.
- **G5:** [Groww pricing](https://groww.in/pricing) — distinct brokerage, regulatory/statutory charges, and DP/service charges; no historical rate assumptions made here.
- **G6:** [Groww: What is the average price of my stock holding?](https://groww.in/help/stocks/order/what-is-average-price-of-an-order-1) — FIFO holding average and intraday exclusion.
- **N1:** [NSE: SEBI Turnover Fees, STT and Other levies](https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies) — separate transaction levies; webpage shows effective-date distinctions.
- **T1:** [Income Tax Department: Circular No. 768, 24 June 1998](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/768-circular-no.-768-dated-24-6-1998-1) — demat FIFO and account-specific background. Its historical section numbering is not a current tax implementation; see the companion document's date boundary.
