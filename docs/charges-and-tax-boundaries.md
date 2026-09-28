# Recorded costs, diary results, and income-tax boundaries

Author: Rose, independent research and financial correctness review for Jasmine. Public sources checked 28 September 2026. Scope: explain and specify accounting boundaries for the local equity diary; no personal tax estimate or tax engine.

## First-use questions

Resolve the report's quantity/value basis, account/date coverage, execution ordering, and snapshot scope early using [the import specification](report-spec.md). For costs, ask whether contract notes and DP/ledger records are available, which components a reported total includes, and whether zero is explicitly verified.

Before any separately requested income-tax analysis, establish the relevant financial/tax year, acquisition and sale dates, evidenced holding periods, delivery/intraday/business classification, security/account identity, complete broker history including transfers/corporate actions, and the taxpayer context needed for the requested analysis. None of those facts can be inferred from a diary's `core`/`trading` label or a screenshot capture date. No personal files were opened for this review.

## 1. Correct the “losses only brokerage” assumption

The user's statement that losses are only brokerage cannot be treated as a rule. A share price decline can produce a gross trading loss before any charges. Conversely, a small gross gain can become a loss after actual costs. Brokerage is one cost component; other transaction charges or levies can apply even to a loss-making trade.

Groww's pricing page separately lists brokerage, exchange/SEBI/IPFT charges, STT, stamp duty, DP charges, and GST on specified services. NSE independently describes transaction levies including STT, stamp duty, GST, and SEBI turnover fees. These establish the distinction between brokerage and other transaction costs; neither establishes the fees charged on this user's historical trades. [G1, N1]

An economic loss after recorded costs also does not prove zero income tax across the user's year. Tax treatment depends on the relevant records, income category, period, and applicable rules. An individual losing diary cycle is insufficient to determine total liability.

## 2. Separate three layers of results

| Layer | What it measures | Appropriate product label |
| --- | --- | --- |
| Gross trading result | Sale value less acquisition value allocated to the sold shares, before transaction costs | `Gross result before transaction costs and personal income tax` |
| Result after recorded costs | Gross result less evidenced costs allocated once to that cycle | `Result after recorded costs, before personal income tax`; add `charges incomplete` where appropriate |
| Taxable income / personal income tax | Legal computation for the relevant category and period, with applicable adjustments and taxpayer facts | `Not calculated by Lotbook`; use broker reports and applicable tax records |

STT, GST, and stamp duty are taxes/levies associated with transactions or services. They can be recorded economic transaction costs. They are distinct from personal income tax on capital gains or other taxable income. Do not call every broker charge “brokerage,” or suggest that paying STT settles personal income tax. [N1, T1]

The diary's net result is not necessarily taxable capital gain. The Income Tax Department's capital-gains material distinguishes consideration, acquisition cost, and qualifying transfer expenditure, and identifies STT as not deductible in computing capital gains. Thus an economic calculation that subtracts recorded STT is not a tax computation. Do not extend that capital-gains distinction to business-income deductions without a separate applicable-law analysis. [T2]

## 3. Record actual amounts and their coverage

The preferred evidence is the contract note and its accompanying statements, reconciled with the broker ledger. Groww's explanation includes executed quantities/prices and charges, and says DP charges appear in a separate statement within the same PDF. Its STT explanation distinguishes estimates shown during order placement from actual charges in the contract note. [G2, G3]

Recommended local cost record:

```text
amount: recorded INR amount, or null if unknown
knowledge: unknown | known-zero | known-amount | partial
components: amounts and individual known/unknown states when available
coverage: included components and any omissions
source: local contract-note/statement reference and source date
scope: fill | order | security-day | contract-note-day | account-period
allocation: direct broker amount or disclosed diary allocation method
```

`known-zero` requires an explicit recorded/verified zero for the stated coverage. A verified zero brokerage component does not mean zero total costs. Absent columns, blanks, unavailable statements, and legacy zero values without provenance remain unknown. Amounts recorded for some components give partial coverage, not “all charges included.”

Preserve component names for future reconciliation:

- Brokerage: broker's charge for the execution/order under the applicable arrangement.
- Exchange transaction, SEBI turnover, and IPFT charges: individually recorded market/regulatory items.
- STT, stamp duty, and GST: separately recorded transaction/service levies, with the broker's actual amounts.
- DP/depository charges: recorded demat debit/service charges from the relevant statement.
- Other actual charges/refunds: separate named records with scope and evidence; unsupported margin interest, penalties, or account-wide charges must not be guessed into ordinary equity fills.

No rate table or brokerage estimate is embedded in this specification. Date, product, exchange, order structure, fee caps/minima, and applicable arrangements can affect charges. Current public pricing is a reference, not evidence of a fee on an older execution. Recheck the date-effective source if estimation is separately requested. [G1, N1]

## 4. Allocation and double-counting controls

1. Preserve the gross execution value separately from charges. If a source instead gives a cash debit/credit after charges, identify that basis before calculation. Never subtract the same charge again from an already net amount.
2. Use actual fill-level costs when supplied. If the broker provides only a day/order/security total, keep that original total and source scope. Any allocation across fills is a disclosed diary convention, not a claim that the broker billed that amount per fill.
3. Allocate buy costs proportionally to shares sold and retain the rest in the remaining acquisition cost. Allocate a sale's costs across its matched quantities once. Do not treat the original entire buy charge as a cost of every partial sale.
4. A fixed DP/day/order charge must not be replicated on each row. Follow evidenced scope; if uncertain, retain it unallocated and flag that cycle costs are incomplete.
5. Preserve a rounding residual so allocated amounts sum to the recorded total to the paisa. Perform calculations with sufficient precision and round at a clearly defined reporting boundary.
6. Keep aggregate `total charges` and component detail related as total versus breakdown, not two additive expenses. Fee corrections/refunds require provenance; never re-import the same execution as a new trade merely because its charge amount changed.
7. Where a component's relation to a trade is unknown, report it as an unallocated recorded cost. Do not claim complete per-cycle net even when an account-level amount is known.

For original buy quantity `Qb`, sold quantity `q`, and a sale of `Qs` shares:

```text
cycleRecordedCosts = buyRecordedCosts × q/Qb + sellRecordedCosts × q/Qs
remainingBuyCosts = buyRecordedCosts × remainingQuantity/Qb
cycleResultAfterRecordedCosts = cycleGross − cycleRecordedCosts
```

Synthetic example: buy 10 at ₹100 with ₹10 verified total buy costs; sell 4 at ₹110 with ₹6 verified total sell costs. Gross result is ₹40. Allocated buy costs are ₹4; sale costs are ₹6; result after recorded costs is ₹30. The remaining 6 shares retain ₹6 buy costs. If ₹6 is brokerage only and other charges are unknown, ₹30 is a result after that recorded subset, not a complete net or taxable-gain figure.

The ledger's all-transaction charges total and monthly realized-cycle charges measure different things. Unsold shares retain acquisition costs, so the sum of monthly realized charges need not equal all recorded charges. Explain that difference; do not subtract both totals from realized profit.

## 5. Broker FIFO and diary allocations

Choosing a purchase lot in this diary changes attribution of realized and unrealized results. It does not change the broker execution, Groww's holdings average, or the applicable tax records. Groww documents FIFO for holding averages and excludes intraday trades, including same-day sale/repurchase activity. Compare against broker classification before asserting a match. [G4]

The Income Tax Department's demat FIFO circular explains account-wise FIFO and the relevance of contract notes; it also distinguishes an entry into a demat account from the original acquisition facts for securities dematerialized later. A diary that keeps purchase date alone cannot reconstruct every such case. This is background supporting separation of diary allocations and tax records; it does not provide an implemented tax specification. [T3]

The current source does maintain independent chosen-lot and FIFO consumption, which is useful. However, it lacks broker intraday reconciliation, account-specific transfer history, corporate-action basis, and tax adjustments. Its FIFO figure must remain a diary comparison until those evidence gaps are resolved. A favorable chosen-lot gain cannot be advertised as tax saved or additional wealth.

## 6. Date and legal boundaries

The review date must not be substituted for the transaction's tax period. The Income Tax Department states that the Income-tax Act, 2025 applies from 1 April 2026, while earlier tax years and related proceedings continue under the applicable provisions of the 1961 Act. It also says earlier circulars continue only where consistent with the new Act. A multi-year export therefore needs date-specific legal references rather than one timeless set of section numbers. [T4]

This document intentionally supplies no capital-gains rate, tax threshold, tax bill, loss set-off estimate, holding-period classification, or recommended return form. Insufficient scope and taxpayer evidence have been supplied for those outputs. The cited older demat circular and ITR-2 guidance are evidence for their stated general principles/record needs, not a recommendation that every current user file ITR-2 or apply historic section numbering.

Broker records are reconciliation inputs, not a guarantee that the user's final tax liability is complete. Obtain the relevant broker Stocks P&L/capital-gains records, contract notes, DP records, and applicable tax records; resolve discrepancies before any tax calculation. Groww gives the P&L route as Profile → Reports → Profit & Loss → Stocks P&L → relevant year/date range → View. The Income Tax Department identifies yearly capital-gain transaction summaries/P&L as supporting records for share capital-gain computation. [G5, T5]

Exclude dividend taxation, corporate-action tax basis, derivatives, short selling, and margin/business-income rules from this MVP. If a report contains those events, surface the scope limitation instead of forcing them into the equity lot calculation.

## 7. User-facing wording and acceptance boundaries

Suggested plain-language copy:

> A loss can come from a price decline as well as transaction costs. Brokerage is only one of those costs. Lotbook shows gross results and results after the costs you have recorded, before personal income tax. Missing charges stay marked unknown. Your chosen lots are diary allocations; reconcile them with Groww's reports and use the applicable broker and tax records for tax work.

Do not use: “losses are only brokerage,” “all taxes included,” “tax-free because this cycle lost money,” “choose cheaper lots to reduce tax,” or “verified broker FIFO” without the necessary evidence and implemented reconciliation.

Documentation acceptance boundaries:

- The supplied `Value` is never treated as a unit price without total-value conversion and verified basis.
- Actual recorded costs, unknown costs, explicit zero, and estimates remain distinguishable through saving/exporting.
- Gross, results after recorded costs, and personal income-tax computation have separate labels.
- Fee allocation is traceable and cannot duplicate an order/day/DP charge across fills.
- Chosen-lot attribution cannot alter the independent FIFO state or claim a broker/tax benefit.
- Monthly realized results remain limited to the accepted transaction history and its cost coverage; missing history/dividends/corporate actions are disclosed.
- No personal screenshot, financial report, PAN, password, or account record is used in a web query or uploaded to a research/AI API.

## Sources and their limits

Official public webpages accessed 28 September 2026; no user records submitted. Their explanatory material establishes distinctions, not a date-specific personal computation.

- **G1:** [Groww: Brokerage Charges & Pricing](https://groww.in/pricing) — current categories; not a historical fee receipt.
- **G2:** [Groww: What is a Contract Note and How to Interpret It?](https://groww.in/blog/what-is-a-contract-note-how-to-interpret-it) — execution/charge details and separate DP statement.
- **G3:** [Groww: Securities Transaction Tax](https://groww.in/blog/what-is-stt) — estimated order-screen amounts versus actual contract-note STT. No tax rates taken from this blog.
- **G4:** [Groww: What is the average price of my stock holding?](https://groww.in/help/stocks/order/what-is-average-price-of-an-order-1) — FIFO and intraday exclusions.
- **G5:** [Groww: How can I access my stocks P&L report?](https://groww.in/help/stocks%2C-f%26o%2C-ipo-%26-mtf/discoverable/how-can-i-access-my-stocks-p%26l-report) — official report-viewing route.
- **N1:** [NSE: SEBI Turnover Fees, STT and Other levies](https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies) — transaction levies and effective-date distinctions; page marked updated 17 April 2026 when reviewed.
- **T1:** [Income Tax Department: ITR-2 FAQ, capital gains and required records](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr-2-faq) — capital-gain income is a separate computation. This page contains 1961 Act references; no rate/return-form advice is inferred.
- **T2:** [Income Tax Department: Capital Gain](https://www.incometaxindia.gov.in/w/capital-gain) — computation principles and STT deduction boundary. Used only for the economic-versus-tax distinction; rate tables are outside this task and require period-specific verification.
- **T3:** [Income Tax Department: Circular No. 768, 24 June 1998](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/768-circular-no.-768-dated-24-6-1998-1) — demat/account FIFO background and acquisition versus demat-entry evidence.
- **T4:** [Income Tax Department: Objective and scope of the New Act](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/objective-and-scope-new-act) — commencement, earlier-year continuity, and qualified continuation of earlier circulars.
- **T5:** [Income Tax Department: ITR-2 FAQ, supporting documents](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr-2-faq) — need for share capital-gain summary/P&L records; not a claim that the diary is a tax statement.
