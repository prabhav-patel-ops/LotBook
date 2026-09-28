# Kitty independent review — 28 September 2026

## Current follow-up status

Jasmine's fixes independently resolve all six previously active behavior
regressions: **23/23 Kitty tests passed** on the first follow-up run. The old
empty-summary test is updated and passed. Concurrent expanded full suite:
**99/100 passed**, with only Lily's optional-clock test failing. Its expected
rejection no longer matches the parser's documented and actual new policy:
retain valid trade dates/economics, mark invalid/conflicting optional clocks
unknown, warn, and do not invent same-day ordering. Kitty added an integration
test for this policy, without editing Lily's test.

Continue-review additions are recorded below; they do not reopen the six fixed
defects. Earlier sections and counts are historical evidence from the first run.

Latest independently executed follow-up: **25/29 Kitty tests passed; 4 failed**.
The full suite passed **104/108**, with the same four failures, zero skips or
TODOs. The agreed legacy migration now passes, and Lily corrected the optional-
clock contract test. Reproduction commands
remain `node --test --test-reporter=spec tests/regressions.test.js` and
`node --test --test-reporter=spec tests/*.test.js`. The declaration lines for
the four failing tests are 424, 443, 459 and 471. The passing migration check is
at 486. These four are active failures and must not be reported as an all-green suite.

### P1 — Groww's exchange order ID is dropped between importer and storage

`src/importer.js` produces `exchangeOrderId` from the screenshot-format column
`Exchange Order Id`, distinct from broker `orderId`. `validateTransaction` and
workflow's metadata list omit `exchangeOrderId`. Test `Kitty regression: Groww
exchange order identity survives parser, import plan and backup` follows an
inline synthetic screenshot-format row through the actual exported APIs and
expects the text identifier (including leading zeros) to survive. It also
expects a later economically equal execution under a different exchange order
to be added, while same-order multiple fills remain legitimate.

### P1 — Missing exchange can prevent same-ID enrichment/consolidation

Same `tradeId=fill`, date and economics, one row with absent exchange and another
with NSE. Their `tradeRef` strings differ, so first-file consolidation treats
them as two buys. A repeat against a saved NSE fill can also add the missing-
exchange row instead of enriching/reusing the one identified execution. Test:
`Kitty regression: repeated identified fill can enrich a missing exchange
without duplicating quantity`, both input orders. Expected: one compatible
identified execution with NSE. If multiple known exchange namespaces make
matching ambiguous, block for review instead of guessing.

### P2 — Malformed restored snapshot numbers silently become zero

Storage normalizes snapshot quantity with `Number()`, accepting null, empty
string, false, true and empty array. A complete snapshot then asserts wrong
holdings (null/empty become zero). Test: `Kitty regression: restore cannot
reinterpret malformed snapshot numbers as zero holdings`. Expected: reject
non-number/non-numeric-string values and preserve stored bytes. This is a
restore validation issue, not a supplied user-file claim.

### P2 — Restored duplicate source trade IDs inflate holdings

Distinct local transaction IDs with the same `(exchange,date,tradeId)` pass
backup validation and count twice, contrary to import's unique-source execution
policy. Test: `Kitty regression: restore rejects duplicated source executions
even when local diary IDs differ`. Expected: reject same-source duplicates,
preserve storage; allow equal trade IDs under distinct known exchanges.

### Agreed legacy migration — independently verified passing

Test `Kitty regression: legacy zero-fee backups migrate to unknown while
explicit known zero is preserved` checks zero or omitted legacy charges,
explicit `chargesKnown:true`, read-time non-overwrite and save/reload. All those
assertions pass against Jasmine's storage migration. Unknown flags stay unknown
after the first save; original recovery bytes remain untouched on read.

### UI integration checkpoint — undo can remove a different displayed trade

Read-only observation while Jasmine's UI work is still underway: diary now sorts
by descending date/time but attaches the undo button to its first displayed row;
`confirmundo` still removes `state.transactions.slice(0,-1)`. Reproduce with two
independent buys inserted `[newer-date buy, older-date buy]`. The button appears
beside the newer buy, but confirmation deletes the older buy and storage accepts
the remaining valid history. Expected: clearly identify and remove the chosen
transaction, or put insertion-order undo beside the actual target. Dependency
validation must remain atomic. No DOM or browser execution was used to claim
this checkpoint, and the owner may still be replacing that handler.

Other UI checkpoint: the main import and reconciliation now call the pure
workflow APIs, and persistent dialog blockers are present. Restore still needs
its completed binding/guard changes; the interim callback referenced removed
`save` while the import changed to `saveIfUnchanged`. Treat these as integration
checks for Jasmine, not as completed browser verification.

## Scope and evidence

Owned files: `tests/regressions.test.js` and this report. Source, existing tests,
Git and browser state are read-only for this assignment. Reviewed every initial
`src` file and all four initial test files, plus service worker, build-cache
script, manifest, guide and release verification. All test data is synthetic.

Baseline, independently executed with Node v22.16.0: `npm test` passed **54/54**,
zero failures, skips or todos. This is not deployment, browser or physical phone
verification. Changes by Jasmine and Lily are concurrent; findings below refer
to the initial implementation unless marked reverified.

## Prioritized initial findings — historical source review

### P1 — Separate identical fills are collapsed during confirmation

Location: initial `src/main.js`, `duplicateKey` and `confirmImport` (lines 345–389).
Reproduce: first upload includes two BUY ABC, 2026-01-01, quantity 10, price 100,
charges 0 rows representing distinct executions. The `seen` Set accepts one and
skips the second. Add a SELL quantity 20 to the report: confirmation rejects the
entire otherwise valid history as insufficient quantity. Without that sale it
silently undercounts holdings by 10.

Expected: preserve first-upload multiplicity; repeat upload is idempotent;
unique execution IDs distinguish equal economic values; conflicting content
for the same source execution ID blocks import. An order ID alone can represent
multiple fills and must not collapse those fills. Jasmine owns replacement
`planTransactions`; independent export tests will follow when available.

### P1 — Broker identity and execution time disappear in persisted history

Location: initial `src/ledger.js:46`, `validateTransaction`, called by import
confirmation and `src/storage.js:27` backup normalization.
Reproduce: normalize an otherwise valid buy containing `isin`, `tradeTime`,
`tradeId`, `orderId`, `exchange` and an unknown-fee flag. Only fixed base fields
survive. In the initial importer ISIN and execution time already exist, so this
loss is observable before new importer aliases are implemented.

Expected: explicitly validated identity, time and known/unknown-fee metadata
survive import, edits, JSON save/load and restore. Actual `charges` itself is
preserved by the initial validator; do not confuse loss of fee provenance with
loss of the numeric fee. Legacy backups require honest unknown-fee migration.

### P1 — Complete reconciliation can falsely report matching holdings

Location: initial `src/main.js:147`, `reconciliation`.
Reproduce: diary holds ABC 10 and XYZ 5; complete uploaded snapshot contains only
ABC 10. The map inspects snapshot symbols only and renders “Quantities match”.
XYZ 5 should appear as snapshot 0 versus diary 5. Empty complete snapshot must
likewise identify all outstanding diary positions. A partial snapshot must not
assume missing stocks are zero. The fixed API must distinguish these cases.

### P2 — Undo by insertion order can target a prerequisite historical purchase

Location: initial `src/main.js:174` diary reversal and `:531` confirmundo.
Reproduce: valid array `[SELL ABC Jan 3, BUY ABC Jan 1]`. Date-sorted accounting
accepts it. “Undo last” removes the BUY and then fails storage history validation.
Expected: never erase the saved diary; explain the dependent sale and offer a
usable correction flow. `Kitty: undoing an appended historical buy...` tests the
existing storage safety, not a repaired UI. Initial history display is reverse
insertion order, which can misrepresent transaction chronology after imports.

### P2 — Cross-tab changes can leave demo or pending forms in the wrong context

Location: initial `src/main.js:717`, storage listener, plus demo cases `:455`.
Source-derived reproduction for Jasmine's browser testing: tab A explores demo;
tab B saves a private diary under `KEY`. A's storage handler loads the private
diary but retains `demo=true`, so real records receive the synthetic demo banner
and saves remain blocked. An open import, sale or restore modal survives the
storage handler because render changes only `#app`, leaving pending/form state.
A failed load only toasts an error and leaves old state writable. An origin-wide
storage clear generates `key=null` and is ignored by the initial handler.

Expected: preserve a coherent demo/private context; close or invalidate stale
forms; refuse overwriting data changed since it was read; enter recovery mode
for invalid external state. Jasmine's `saveIfUnchanged` will be independently
tested. No DOM or browser check has been performed by Kitty.

### P2 — The update toast overstates whether the running page is updated

Location: initial `src/main.js:733` controllerchange callback.
Reproduce conceptually: page loads the old JS, new worker takes control, callback
shows “App updated” without replacing the already-loaded page code. Expected:
clear reload/update action that preserves the diary and warns about unsaved work.
The build script does hash and precache production assets; initial template
`lotbook-shell-v1` alone is not proof production uses a fixed cache version.
Do not claim a physical phone or installed-app update test from worker tests.

### P2 — Past corrections and fully closed purchase history are difficult

Location: initial `src/main.js:174` diary and `:224` stockDetail;
`src/ledger.js` only returns currently held symbols in `holdings`.
Reproduce: fully close a stock, then try to change its purchase purpose, fees or
historical sale allocation. The holdings list no longer opens its lot detail;
the diary offers only undo for the last inserted transaction. Expected: an
explicit validated correction route and access to historical purchase identity,
without silently changing broker FIFO or applying unsupported corporate actions.
This is a source review finding, not a completed UI test.

## Privacy and restore checks

Initial runtime code processes statements locally, escapes displayed private
text, neutralizes CSV formulas, uses a single namespaced storage key, and only
caches public app assets. No source evidence of financial-record upload was
found. Same-origin apps can read localStorage regardless of path; namespacing
prevents accidental collisions but does not create an authentication or privacy
boundary. This limitation must remain visible in product guidance.

Restore validates before confirmation, then writes before assigning in-memory
state. Invalid history and quota failure preserve the old stored JSON. Recovery
load does not overwrite corrupt bytes. Tests use independent in-memory storage
and an unrelated app key; they do not touch a user's actual browser diary.

## First pure-export findings — six subsequently fixed and passing

The seven initial Kitty tests passed **7/7** independently. After Jasmine exposed
the workflow/storage APIs, six additional **active expected-behavior regressions**
were added for concrete defects below. They are not approval or deployment tests;
their failing/passing status is updated in the next execution record.

### P1 — Same-file identified duplicate discards later known charges

`src/import-workflow.js`, `seenRefs` branch: import `[unknownFeeRow, knownFeeRow]`
with identical `tradeId`, exchange/date/economic values. It skips the second row
before enrichment and keeps charges 0/unknown instead of actual 12/known. Reverse
order keeps 12. Test: `Kitty regression: repeated trade ID within one file
enriches unknown charges`. Expected: a single execution enriched identically in
either order, with conflicts blocking disagreement between two known fees.

### P1 — A saved fill is consumed twice when a later incoming row has its ID

`src/import-workflow.js`, `byRef` match does not check `used`. Existing one fill
`tradeId=fill`; incoming `[anonymous otherwise equal row, identified fill]`.
The anonymous row consumes saved index 0, then byRef consumes it again. Adds 0,
holds 10; expected add 1, hold 20. Reverse incoming order does add 1. Test:
`Kitty regression: matching anonymous row cannot consume the same saved fill
again by ID`. Reserve identified matches before anonymous multiset matching.

### P1 — Exchange namespace is lost by fallback duplicate matching

Existing NSE execution `tradeId=fill`; import an otherwise equal BSE execution
`tradeId=fill`. `tradeRef` distinguishes them, but `canMatch` ignores exchange
and fallback skips the BSE execution. Test: `Kitty regression: exchange
namespaces distinguish economically identical source trade IDs`. Expected:
both distinct executions survive.

### P1 — Identified source-metadata conflicts silently pass

Keep the same `tradeId=fill` and exchange/date/economic values, but change a
nonempty ISIN, order ID or execution time. The byRef branch tests only economics
and known fees; the same-file seenRefs branch does likewise. Both silently skip
the conflicting row. Test: `Kitty regression: same identified fill with
contradictory source metadata must block` checks existing and same-file conflicts.
Expected: an actionable conflict; preserve original records for review.

### P1 — Conflicting symbol and ISIN can make a wrong holding appear reconciled

Diary has ABC/ISIN-A and XYZ/ISIN-X. Snapshot says symbol ABC but ISIN-X,
quantity 10. `normalizeSnapshots` honors existing ABC without detecting its
conflicting ISIN and can report ABC matched. Test: `Kitty regression:
contradictory ISIN and known symbol cannot silently reconcile`. Expected:
explicit identifier-conflict error; no invented identifier correspondence.

### P2 — Restore bypasses duplicate-snapshot protection

Live snapshot normalization rejects duplicate symbols, but `validateBackup`
accepts them. Restoring `[ABC quantity 99, ABC quantity 10]` lets reconciliation's
Map select only the last row; the contradictory data disappears. Test:
`Kitty regression: restore rejects duplicate snapshot symbols rather than using
the last row`. Expected: reject and preserve saved bytes, matching live import.

## First-run verification — historical evidence

Latest execution against the exposed APIs:

| Command | Passed | Failed | Skipped / TODO |
| --- | ---: | ---: | ---: |
| Initial `npm test` | 54 | 0 | 0 |
| `node --test --test-reporter=spec tests/regressions.test.js` | 17 | 6 | 0 |
| `node --test --test-reporter=spec tests/*.test.js` | 78 | 7 | 0 |

The six failures in Kitty's file are **confirmed behavior defects**, active at
test declaration lines 336, 348, 361, 371, 388 and 395 respectively. Exact source
locations at execution: workflow `seenRefs` branch `:16`, byRef consumption
`:23`/`:25`, fallback matching `:5`, snapshot resolution `:43`/`:47`; duplicate
snapshot restore protection is missing from storage snapshot mapping `:56`.

The seventh full-suite failure is the existing `tests/ledger.test.js:165`
empty-summary assertion: source now returns the intentional new field
`totals.unknownCharges: 0`, absent from that test's expected object. Jasmine
must reconcile that test with her API change; Kitty did not edit her file.

Source SHA-256 at this execution (short prefixes): workflow `38211e7f99514041`,
ledger `79e3378dea2261fe`, storage `faecb612e1cdb3e0`. Main/importer edits were
still underway and are not covered by a browser success claim.

Passing Kitty checks independently verify source-identity/fee/allocations
roundtrip, basic multiset growth and repeat upload, known/unknown-fee preservation,
complete/partial/empty reconciliation, all-known versus absent-time chronology,
stable time ties, stale-write rejection, invalid restore and quota atomicity,
corrupt-data recovery, sibling-app storage and tiny-lot allocation.

At this first run the six defects blocked approval. They subsequently passed,
as recorded in the current follow-up status. Four newly reproduced issues now
remain; the source owners can rerun the exact commands above after fixes.

The regression file now also covers multiplicity growth and repeat imports,
same-order separate fills, metadata/known-fee enrichment roundtrip, non-erasure
of existing fees/annotations, economic/source-ID conflicts, all-known versus
partly absent times and stable ties, unknown-fee flags excluding rejected
sales, complete/partial/empty snapshots and stale write rejection. The six
expectations above are intentionally active, not skipped or marked TODO.

## Remaining checks owned by Jasmine / user

- Fix the four current reproducible export/restore defects at the top of this
  report. The previous six, empty-summary test and legacy fee migration now pass.
- Complete main integration and check the undo-target mismatch and restore binding
  noted above. Passing exported-API tests do not establish a successful user flow.
- Browser import preview/confirmation/error persistence, corrections, demo/restore,
  cross-tab changes and update flow.
- Actual redacted Groww export and current holdings reconciliation; the original
  format has not been independently tested against a supplied user file.
- Build, deployment, hosted page and physical installed-phone checks.

Handoff: exact reproductions and active regressions are ready for Jasmine's
source fixes. Rerun both documented test commands after changes, then perform
the browser checks above. Kitty changed only the two assigned files and did
not operate a browser, write source, alter Git or verify deployment.
