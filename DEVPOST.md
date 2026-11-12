# CloseDesk: Devpost draft

CloseDesk checks PayPal against what a seller promised customers (orders, coupons, support replies), every day, and turns each gap, like the refund support promised but never sent, into one owner-approved PayPal action, so the month-end close is signed with $0.00 unexplained.

## Inspiration

Sync tools copy PayPal into the books. Checking PayPal against what the shop promised customers (a refund support said was done, a coupon, a held payment) is still manual. PayPal says the same about its own sync: "Accounting Sync replaces manual data entry, not your accountant's judgement." ([PayPal developer blog](https://developer.paypal.com/community/blog/setting-up-paypal-accounting-platform-sync))

## Who it is for

The first user is an outside bookkeeper who closes the month for a small online shop that takes PayPal, and who has to explain every dollar PayPal and the books disagree on before the owner signs.

## The problem, with numbers

- In a survey of accounting firms, "the individual team member handling ecommerce clients spends an average of 38 hours per month on manual labor", "around a fourth of their monthly time", and "more than a third of firms" said they "needed to adjust data manually to associate product or SKU order details with the correct payments or dates". (Survey by Paradoxes, Inc. for Bookkeep, reported by [The Woodard Report, 2022](https://report.woodard.com/articles/is-ecommerce-bookkeeping-straining-your-practice-bkecwr))
- In the same research, of nearly 700 US businesses, "45% of organizations must manually adjust ecommerce payment data" every month. ([The Woodard Report, 2022](https://report.woodard.com/articles/businesses-strained-by-ecommerce-accounting-bkecwr))
- Small sellers already pay for PayPal reconciliation alone: A2X for PayPal starts at US$29 a month for up to 200 transactions (Mini plan, [A2X pricing](https://a2xaccounting.com/paypal/pricing), read 2026-11-12).
- Newer, from the bookkeepers themselves: in a February 2026 survey of 261 US and Canadian bookkeeping and accounting firm professionals, "More than half of bookkeeping firms still rely on spreadsheets, document checklists, or email threads" to run the month-end close, "Only 1 in 7 firms rarely or never have to manually copy information from one tool into another", and 35% named "Too much time spent moving data between systems" as their biggest operational challenge. (Financial Cents, a practice management vendor, [2026 Bookkeeping Firm Tech Stack Report](https://financial-cents.com/resources/guides/2026-bookkeeping-firm-tech-stack-report/), read 2026-11-12.) None of these surveys counts promise-versus-PayPal gaps directly.

## What it does

A daily check reads the books, the support replies and PayPal, and finds seven kinds of gap. Each becomes one approval card. Only the owner, from a one-time link, moves money. Sign close opens at $0.00 unexplained.

| # | Gap | PayPal action | Approver |
|---|---|---|---|
| E1 | Promised refund never sent | Full refund | Owner |
| E2 | Paid twice | Refund the duplicate | Owner |
| E3 | Coupon not applied | Partial refund ($4.67) | Owner |
| E4 | Shipped, hold never captured | Capture | Owner |
| E5 | Cancelled, hold still open | Void (releases $65.00 held, bridge unchanged) | Owner |
| E6 | Shipped, never billed | Send invoice, carried forward ($58.00) | Bookkeeper |
| E7 | Paid by bank, invoice open | Record payment | Bookkeeper |

The demo shop, Brightloom Candles, is made up. In the demo period: 15/20 orders matched, 7 exceptions, Unexplained $306.17 at the start.

## Why this is good for PayPal

- **Merchant volume**: E4 finds holds that were never captured. PayPal's own docs say an authorization is "valid for 29 days" and should be captured "within the 3-day honor period" ([PayPal authorization docs](https://developer.paypal.com/docs/checkout/standard/customize/authorization/)). Captured on time, that is sales volume that settles on PayPal instead of expiring.
- **Risk**: E1 and E2 catch a refund a customer was promised and a double charge before the customer has to chase them, and refunds stay blocked on payments that are in a dispute. CloseDesk only finds and proposes; the owner decides. Disputes are the costly alternative: "In 2025, $34 billion in debit and credit card transactions was disputed by cardholders and charged back to merchants", "Almost 90% of disputes are resolved in favor of consumers", and only 25% of consumers contact the merchant first (Javelin Strategy & Research for Mastercard, "The Case for Coordination", January 2026, [PDF](https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2026/2026-javelin-chargebacks-white/2026%20Chargebacks%20Javelin%20White%20Paper.pdf)). These are card network figures, not PayPal's; a promised refund that is actually sent is one the customer does not have to dispute.
- **A product PayPal could ship**: a "promise check" next to Accounting Sync. Accounting Sync copies the data; this checks it against what the shop told customers, using Transaction Search, Orders, Payments and Invoicing, with an approval step that keeps money moves with the account owner.

## What the demo proves today, and what needs PayPal or partners

- **Proven in this repository (mock PayPal that follows the published schemas, `npm test`)**: all seven gap types, server-computed amounts, owner-only money moves through one-time links, per-order locks with `PayPal-Request-Id`, dispute blocks, mode A (Transaction Search) and mode B (order lookups), the close package and journal lines.
- **Proven on the PayPal sandbox on 2026-11-12 (VERIFY.md)**: a seeded period (20 PayPal-account orders approved by a sandbox buyer, 18 captures, 2 holds, a duplicate two minutes later) closed end to end in this app: refund `0TB68373FK703634V`, partial refund `2T248348FD9414800`, capture `5P5249954H751362W`, void of hold `1U584327LU028570K`, invoice `INV2-KVD5-PJMK-3TMB-GNLV` sent, payment `EXTR-72W43837WD604723W` recorded, signed at $0.00 with $58.00 carried forward; every status read back from PayPal. Transaction Search and Balances scope is granted, and once the sandbox index caught up the same period ran in mode A: the duplicate check found order 1051 paid twice and the owner link refunded it (refund `6VY43897TU6121035`, capture `0GX78358AV019410Y` now REFUNDED); refund lines carry `paypal_reference_id` back to the capture.
- **Proven on a real model**: Claude Sonnet ran the promise reading, "Ask the Close Agent why" (E1, E2) and four AG Studio starter prompts through a local Claude Code account (not the API key path), including one where the Close Agent delegates to Studio's built-in Page agent and then its Widget agent to build a pie it has no tool for. The demo replays these runs, labelled "Recorded run: Claude Sonnet, 2026-11-12".
- **Needs PayPal**: sandbox Transaction Search indexing ran about 5 hours behind (PayPal documents up to 3), so the first sandbox close used mode B and mode A ran later on the same period; card processing on the sandbox business account (422 today); and partner onboarding (third-party permissions) so each seller grants access and PayPal itself limits the bookkeeper's role.
- **Needs partners**: real connectors for the books (QuickBooks, Xero) and the support inbox. The demo seeds both.

## How we built it

AG Studio is the central screen: four custom widgets, a ledger theme, three layouts, a Close Agent on Claude through a custom adapter, and queue clicks that filter the ledger. PayPal Orders, Payments and Transaction Search go through the APIMatic generated SDK; Invoicing stays on REST; the PayPal Agent Toolkit gives the Close Agent read tools (`get_order`, `list_transactions`, `get_invoice`, `search_invoicing`). Amounts are computed by server code and never by the model.

## Challenges

Transaction Search answered 403 until the scope was granted; once granted, newly seeded payments still took longer than PayPal's documented three hours to appear, so the app falls back to mode B (order lookups) and says so on screen. The sandbox answers an invoice create with the whole invoice rather than a link, and an empty search page without `transaction_details`; both were found on the sandbox and fixed. Card orders answered 422 `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` on the sandbox business account, so seeding has a PayPal-account path approved by a sandbox buyer. Reauthorization on day 0 answered `REAUTHORIZATION_TOO_SOON`. The authorize and capture order calls answered 415 without a body; sending `{}` fixed it.

## What's next

Partner (third-party permission) onboarding so each seller grants access and PayPal limits the bookkeeper's role, then books and helpdesk connectors.

## Testing instructions

**Try it:** https://closedesk.35-216-2-121.sslip.io (hosted demo: mock PayPal, recorded Claude Sonnet runs; no login).

```bash
cp .env.example .env
npm install && npm run build && npm start   # http://localhost:3003, no keys: mock PayPal, recorded Claude Sonnet runs
```

Then follow the README "Judge walkthrough": 1 Open the close, 2 Read the Close Meter, 3 Approve E1, 4 Filter and ask why, 5 Close Agent in AG Studio, 6 Resolve E2 to E7, 7 Sign close. The "Sandbox evidence" tab lists the real sandbox ids.
