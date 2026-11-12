# CloseDesk

CloseDesk checks PayPal against what a seller promised customers (orders, coupons, support replies), every day, and turns each gap, like the refund support promised but never sent, into one owner-approved PayPal action, so the month-end close is signed with $0.00 unexplained.

Sync tools check PayPal against your books. CloseDesk checks PayPal against your promises.

The demo shop is "Brightloom Candles", a made-up company. All people, e-mails and orders are fictional.

## What it does

A bookkeeper opens a close. The daily check reads the seller's books (20 orders, one bank-paid invoice), the support replies, and PayPal, and finds every gap:

| # | Gap | How it is found | PayPal action | Approver |
|---|---|---|---|---|
| E1 | Promised refund never sent | A model reads support replies and quotes the promise, code checks PayPal for a refund | Full refund | Owner |
| E2 | Paid twice | Transaction Search payments that no order points at, paired by same cart reference + same amount + within 10 minutes | Refund the unlinked payment | Owner |
| E3 | Coupon not applied | Coupon rule from the books against the captured amount | Partial refund ($4.67) | Owner |
| E4 | Shipped, hold never captured | `get_order` shows an open authorization | Capture, branches implemented and tested; the sandbox answered REAUTHORIZATION_TOO_SOON on day 0, as PayPal documents | Owner |
| E5 | Cancelled, hold still open | `get_order` | Void (releases the customer's money, bridge unchanged) | Owner |
| E6 | Shipped, never billed | No PayPal order id and no payment with that cart reference | Create and send an invoice, carried forward | Bookkeeper |
| E7 | Paid by bank, invoice still open | Invoice search by the period's invoice number | Record the payment on the invoice | Bookkeeper |

Rules that never bend:

- Money is integer cents and is computed by server code. The model never supplies an amount. A promise is a quoted sentence, and a quote that is not literally in the message is dropped.
- Only the owner can move money (refund, capture, void). The owner approves from a signed one-time link (30 minutes) that opens in a separate tab. The bookkeeper can send invoices and record payments.
- Every action runs under a per-order lock with a `PayPal-Request-Id`, so two clicks produce one refund and one 409.
- Refunds are blocked on payments that sit in a dispute. Once the close is signed, every action is locked.
- Sign close opens only when Unexplained is $0.00 and nothing is left open. Unexplained adds "PayPal over books" and "PayPal under books" separately as absolute values, so one cannot hide the other.

## AG Studio is the central screen

The whole desk is one `AgStudio` component (`ag-studio` and `ag-studio-react` 3.1.0 from public npm):

- Four custom widgets built with `createWidgets` and `AgWidgetDefinition`: Exception Queue (cards, quoted evidence, approval step), Books vs PayPal Bridge, Close Meter (with the Sign close button) and Owner Approvals. They sit in the widget menu and can be dragged, resized and removed in edit mode.
- A ledger-paper theme with tabular figures, light and dark (`client/src/studio/theme.js`).
- Three layouts as Studio pages: bookkeeper view, merchant view, client board. Switch with the header buttons, or edit them with "Edit layout and Close Agent".
- Studio data engine over five tables (exceptions, PayPal ledger with event codes, support promises, books orders, clients), a relationship between exceptions and ledger for cross filtering, built-in grid and chart widgets.
- Studio Agent Framework: a custom Close Agent (`client/src/studio/closeAgent.js`) with domain instructions and two own tools, wired to delegate data and widget work to Studio's built-in agents with `delegateTo` (verified with the stand-in model; the live Claude run is VERIFY 11, partly done through a local Claude account). AG Studio ships an OpenAI adapter only, so `client/src/studio/claudeAdapter.js` is a Claude adapter that posts the provider-neutral turn to `POST /api/studio/turn`. The server translates it to the Anthropic Messages API and back (`server/agent/studioTurn.js`, covered by tests). The key never reaches the browser.

## Run it

```bash
npm install
npm run build
npm start          # http://localhost:3003
```

With no keys, everything runs on a built-in mock PayPal and a stand-in model. For development: `npm run dev:server` and `npm run dev:client`.

```bash
npm test           # 124 tests, node --test
```

## Judge walkthrough (about three minutes, no account needed)

1. Open the app. A prepared period is assigned to your session and the daily check has already run. On the local mock the badge says "Source: PayPal Transaction Search - 18 transactions". On the hosted sandbox demo it says "Source: order lookups (Transaction Search not yet active)" and the duplicate check is marked skipped. Open the "Agent trace" tab to see the tool calls and the `GET /v1/reporting/transactions` calls.
2. Read the Close Meter: 15/20 orders matched, 7 exceptions, Unexplained $306.17. Read E1: the support reply "I've refunded your order" is underlined and PayPal shows no refund.
3. Press "Propose" on E1. The approval card shows the amount and where it comes from, and what the bridge will do: Unexplained $306.17 -> $217.17. Press "Send owner link", then "Open owner page". In the owner tab press Approve. The desk shows the real refund id.
4. Do the same for E2, E3, E4. For E5 the card says the bridge stays unchanged and releases $65.00 held from the customer. E6 and E7 are approved by the bookkeeper with one button.
5. When Unexplained is $0.00 (Carried forward $58.00 with an invoice number), press Sign close, then read the Close package tab (PayPal ids executed, books vs PayPal table, approvals, journal CSV).
6. Click a queue card title (for example E2): the ledger grid filters to that order's lines; click it again to clear. Press "Ask the Close Agent why" on a card to see the PayPal Agent Toolkit reads (`get_order`, `list_transactions`) in the answer and in the Agent trace.
7. Click "Edit layout and Close Agent", press "Refund promises older than 1 day". The Close Agent calls its own `show_promise_list` tool, which adds a filtered grid widget. "Chart money at stake" adds a bar chart the same way; widget work beyond that is delegated to Studio's built-in agents. Drag widgets, or switch to the Merchant view and the Client board.

## Mock PayPal and what is verified

`server/paypal/mock.js` reproduces PayPal's published response schemas (Transaction Search v1 with `transaction_details`, `transaction_info`, `payer_info`, paging fields, the 31-day range limit, page size 500, status filter, the three-hour indexing delay, `custom_id` surfacing as `custom_field`, negative refund amounts; Orders v2, Payments v2 and Invoicing v2 bodies). Orders, Payments and Transaction Search go through `server/paypal/sdk.js` (APIMatic SDK); Invoicing stays on REST in `server/paypal/live.js`. `VERIFY.md` lists 16 checks with results and fallbacks.

### Verified in the sandbox (2026-11-12)

- Refund `75M999425T494132P` on capture `19G729103H314023L`: accepted with the capture id read from the order.
- Final capture `7EF29184AT762933C`: the authorization then reads CAPTURED.
- A PayPal-account authorization `1DY809243X095705T` was created; reauthorization on day 0 answered `REAUTHORIZATION_TOO_SOON`.
- Card order create answered 422 `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`, so the seed has a PayPal-account path (`scripts/seed-period.js`, `scripts/approve-buyer.py`).
- Transaction Search and Balances answered 403 (scope not active), so the hosted demo runs in mode B and says so on screen.
- Not run: invoices, the hosted-API Claude path, the buyer activity screen.

Sandbox periods: the server never fails to start when seeding is impossible. It reads prepared files from `data/periods/` and shows "No prepared sandbox period. Seed one with scripts/seed-period.js" on the desk and in `/api/health` otherwise. A local Claude Code account can stand in for the model with `LLM_BACKEND=account` (labelled "Claude Sonnet (local account)"); it never uses an API key. If Transaction Search is not open on the sandbox app, the close runs in mode B (order lookups) and says so on screen, skipping the duplicate check.

## Per-period tags

All judges share one sandbox merchant account, so every seeded order carries `custom_id = cd:{period_id}:{cart_ref}` and every invoice number starts with the period id. Search results are filtered by that tag, and refund lines by the payment they point at, so another judge's payments or refunds can never appear as a fake duplicate. Prepared periods are seeded ahead (Transaction Search shows new payments up to three hours later), and an unassigned period older than 3 days is discarded and its holds voided.

## Environment

| Variable | Purpose | Default |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app. Unset means mock PayPal | unset |
| `APPROVAL_SECRET` | Signs owner links. Required with PayPal credentials | random per process |
| `PAYPAL_API_BASE` | Host for the SDK path. Sandbox only: the app refuses any host except the PayPal sandbox or a local test server | `https://api-m.sandbox.paypal.com` |
| `SEED_WITH_CARD` | Seed sandbox periods with card payments | 0 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude for promise extraction and the Studio agent. Unset means stand-in | unset, `claude-sonnet-5-5` |
| `VITE_AG_STUDIO_LICENSE_KEY` | AG Studio trial key, read at build time | unset |
| `READY_PERIOD_TARGET`, `PERIOD_MAX_AGE_DAYS`, `ASSIGN_PER_DAY` | Prepared periods and demo cap | 5, 3, 200 |
| `CHAT_PER_IP_HOUR`, `CHAT_PER_DAY` | Model call caps for the hosted demo | 40, 200 |
| `LLM_BACKEND` | `account` runs the model through the local Claude Code login (never the API key) | unset |
| `PERIODS_DIR` | Prepared sandbox period files | `data/periods` |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | Read by `scripts/approve-buyer.py` only | unset |
| `FORCE_MOCK` | Ignore every key | 0 |
| `PORT`, `PUBLIC_URL`, `APP_URL` | Server address and link base | 3003 |

## Layout

```
server/paypal     mock.js, live.js, reporting.js (paging, 31-day split), toolkit.js (Agent Toolkit reads)
server/close      seed, ledger (mode A/B), periodTag, match (detection), bridge, actions, capturePlan, approvals, periods, package
server/agent      Claude tool loop, promise extractor, AG Studio turn translation, server tools (no PayPal writes)
client/src/studio widgets, theme, layouts, data sources, Close Agent, Claude adapter
client/src/desk   desk page and panels;  client/src/owner  the owner tab
test              124 tests: money, tag filters, Transaction Search schema, detection, actions, branches, periods, HTTP
```

## Next step beyond the hackathon

This demo uses the seller's own sandbox REST credentials. A real product needs PayPal's partner (third-party permissions) onboarding so each seller can grant access and the bookkeeper's role is limited by PayPal itself.

## Built with the APIMatic Context Plugin

The live PayPal calls use the APIMatic-generated PayPal TypeScript SDK (package `paypal`, client `PaypalClient`, installed from `github:context-plugins/paypal-typescript-sdk#main`, not on npm). I followed the plugin skills `typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, `typescript-client-initialization`, `typescript-authentication`, `typescript-calling-endpoints`, `typescript-models`, `typescript-configuration-resilience` and `typescript-testing`.

- Through the SDK (`server/paypal/sdk.js`): Orders (create, authorize, capture, get), Payments (get and capture and reauthorize and void an authorization, get a capture, refund a capture), and Transaction Search (transactions and balances).
- Kept on REST (`server/paypal/live.js`), because the SDK has no such resource: Invoicing (create, send, get, search, record payment), and the OAuth scope probe and token terminate call used by VERIFY item 1. The Agent Toolkit read tools for Claude are unchanged.
- Every money write is claimed before the SDK call, sent once, and a lost answer is settled by re-reading PayPal. It is reported as "outcome unknown", never as failed. The mock adapter and all tests still run without keys; the SDK adapter is tested against a faked `fetch`.
- The contract sheet is in [`paypal-plan.md`](paypal-plan.md). Sandbox results are in `VERIFY.md` and the section above. Details for APIMatic reviewers: [`APIMATIC.md`](APIMATIC.md).

## Built with

PayPal Transaction Search (built and tested against the published schema, sandbox scope pending), Payments, Orders and Invoicing (APIMatic PayPal SDK) and the PayPal Agent Toolkit; AG Studio (AG Grid); Claude; React 19, Vite, Express, zod.

License: MIT.
