# CloseDesk: Devpost draft

## Inspiration
Small sellers close the month by comparing PayPal with their books. Sync tools copy PayPal into the books. Checking PayPal against what the shop promised customers (a refund support said was done, a coupon, a held payment) is still manual. The gaps are the ones support and orders already know about.

## What it does
A daily check reads the books, the support replies and PayPal, and finds seven kinds of gap. Each becomes one approval card. Only the owner, from a one-time link, moves money. Sign close opens at $0.00 unexplained.

| # | Gap | PayPal action | Approver |
|---|---|---|---|
| E1 | Promised refund never sent | Full refund | Owner |
| E2 | Paid twice | Refund the duplicate | Owner |
| E3 | Coupon not applied | Partial refund ($4.67) | Owner |
| E4 | Shipped, hold never captured | Capture | Owner |
| E5 | Cancelled, hold still open | Void | Owner |
| E6 | Shipped, never billed | Send invoice, carried forward | Bookkeeper |
| E7 | Paid by bank, invoice open | Record payment | Bookkeeper |

The demo shop, Brightloom Candles, is made up.

## How we built it
AG Studio is the central screen: four custom widgets, a ledger theme, three layouts, a Close Agent on Claude through a custom adapter, and queue clicks that filter the ledger. PayPal Orders, Payments and Transaction Search go through the APIMatic generated SDK; Invoicing stays on REST; the PayPal Agent Toolkit gives the Close Agent read tools. Amounts are computed by server code and never by the model.

## Challenges
Transaction Search scope is not active on the sandbox app (403), so the hosted demo runs in mode B and says so. Card orders answered 422 on the sandbox business account, so seeding uses PayPal-account orders approved by a sandbox buyer. Authorizations can be reauthorized only from day 4.

## What's next
Partner (third-party permission) onboarding so each seller grants access and PayPal limits the bookkeeper's role.

## Testing instructions
```bash
npm install && npm run build && npm start   # http://localhost:3003, no keys, mock PayPal and a stand-in model
```
Follow the "Judge walkthrough" in README.md. Hosted URL: to be added.
