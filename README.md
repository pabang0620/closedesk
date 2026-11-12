<img src="client/public/logo-512.png" width="128" alt="logo" />

# CloseDesk

**Demo video:** https://youtu.be/mST0-y1Vm6g | **Hosted demo:** https://closedesk.35-216-2-121.sslip.io | **Devpost:** https://devpost.com/software/closedesk

**Try it:** https://closedesk.35-216-2-121.sslip.io (hosted demo: mock PayPal, live Claude Sonnet (`claude-sonnet-5-5`) with per-IP-hour and per-day caps; when the API fails or a cap is hit it falls back to a labelled recorded run or a rule-based stand-in; no login).

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
| E4 | Shipped, hold never captured | `get_order` shows an open authorization | Capture (sandbox capture `5P5249954H751362W`, VERIFY 14 d); a reauthorize on day 0 answered REAUTHORIZATION_TOO_SOON, as PayPal documents (VERIFY 5) | Owner |
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
- Studio Agent Framework, with a custom Close Agent (`client/src/studio/closeAgent.js`):
  - Domain instructions and three own tools: `get_close_status`, `show_promise_list`, `add_money_chart`.
  - `delegateTo(['data', 'page', 'widget'])` hands work to Studio's built-in agents.
  - All four starter prompts ran on a real Claude Sonnet (VERIFY 11, account mode).
  - "Pie of money by direction" asks for a widget the Close Agent has no tool for, so it delegates twice: the built-in Page agent places a new pie (`add_widget`), then the built-in Widget agent maps `exceptions.amount` by `exceptions.direction` (`configure_widget`). Each ends with `complete_task`. The AI panel shows "Delegated to Page agent" and "Delegated to Widget agent".
  - The `ag-studio` 3.1.0 package has no Claude adapter. `client/src/studio/claudeAdapter.js` posts the provider-neutral turn to `POST /api/studio/turn`, and the server translates it to the Anthropic Messages API and back (`server/agent/studioTurn.js`, covered by tests).
  - The key never reaches the browser.

## Run it

```bash
npm install
npm run build
npm start          # http://localhost:3003
```

With no keys, everything runs on a built-in mock PayPal, and the AI scenes replay recorded Claude Sonnet runs (see "Recorded model runs"). `npm run demo:video` starts the exact state used in `docs/VIDEO_SCRIPT.md`. For development: `npm run dev:server` and `npm run dev:client`.

```bash
npm test           # node --test, mock PayPal and mock model only
```

## Judge walkthrough (about three minutes, no account needed)

Start from a fresh copy: `cp .env.example .env` (every key empty, so mock PayPal), then `npm install && npm run build && npm start` and open http://localhost:3003. Nothing in this path waits on a timer: the only wait is the owner tab, and the desk says what it waits for and until when.

1. **Open the close.** A prepared period is assigned to your session and the daily check has already run. The badge line reads "Source: PayPal Transaction Search · 18 transactions · (period dates) · mock PayPal · AI: Recorded run: Claude Sonnet, 2026-11-12 (replayed where recorded, stand-in elsewhere)". Open the "Agent trace" tab: `record_promise` is labelled with the recorded run, and the `list_transactions` lines show the Transaction Search calls.
2. **Read the Close Meter.** 15/20 orders matched, 7 exceptions, Unexplained $306.17. In E1 the support reply "I've refunded your order, you'll see it in a few days." is underlined and PayPal shows no refund.
3. **Approve E1.** Press "Propose" on E1. The approval card shows the amount, where it comes from, and the bridge change: Unexplained $306.17 -> $217.17. Press "Send owner link" (the card now says it waits for the owner and until when), then "Open owner page". In the owner tab press Approve. The desk shows the refund id PayPal returned (a mock id locally; real sandbox ids are in the "Sandbox evidence" tab).
4. **Filter and ask why.** Click the E2 title: the ledger grid filters to that order's lines (C-1051); click again to clear. Press "Ask the Close Agent why" on E2. The answer is labelled "Recorded run: Claude Sonnet, 2026-11-12": the model's own tool calls (`get_books`, `get_order`, `list_transactions` and others, in the order it chose) run again live against this session's PayPal data, and the Agent trace shows them as `agent-toolkit` reads. The card shows the first three lines of the answer; "Show more" opens the rest and the tool calls. Recorded runs exist for E1 and E2; other cards use a fixed Toolkit read sequence and say so.
5. **Close Agent in AG Studio.** Click "Edit layout and Close Agent", press "Refund promises older than 1 day". The Close Agent calls its own `show_promise_list` tool, which adds a filtered grid widget. Press the "New" button at the top of the AI Assistant panel (inside the panel, not the "New chat" item in the menu) to get the starters back, then "Pie of money by direction": the Close Agent delegates to Studio's built-in Page agent and then its Widget agent, and a pie of exception amounts by direction appears under the queue. "Chart money at stake" calls `add_money_chart` and adds a bar chart. Typing a starter's words in a running chat replays the same recording. Drag widgets, or switch to the Merchant view and the Client board.
6. **Resolve E2 to E7.** E2, E3 and E4 go through the owner like E1. For E5 the card says the bridge stays unchanged and releases $65.00 held from the customer. E6 (send invoice) and E7 (record payment) are approved by the bookkeeper with one button.
7. **Sign close.** When Unexplained is $0.00 (Carried forward $58.00 with an invoice number), press Sign close and read the Close package tab (PayPal ids executed, books vs PayPal table, approvals, journal CSV).

"Sandbox evidence" tab: the calls that really ran on the PayPal sandbox, with their ids (see below).

## Mock PayPal and what is verified

`server/paypal/mock.js` reproduces PayPal's published response schemas (Transaction Search v1 with `transaction_details`, `transaction_info`, `payer_info`, paging fields, the 31-day range limit, page size 500, status filter, the three-hour indexing delay, `custom_id` surfacing as `custom_field`, negative refund amounts; Orders v2, Payments v2 and Invoicing v2 bodies). Orders, Payments and Transaction Search go through `server/paypal/sdk.js` (APIMatic SDK); Invoicing stays on REST in `server/paypal/live.js`. `VERIFY.md` lists 17 checks with results and fallbacks.

### Verified in the sandbox (2026-11-12)

The same list is in the app's "Sandbox evidence" tab. PASS items only, with the VERIFY.md item:

- VERIFY 15, 16 (seed): `scripts/seed-period.js create` made period `p261112xpk` (20 PayPal-account orders, PAYER_ACTION_REQUIRED, and invoice `INV2-6JF3-XTAF-NQC4-T4YJ` sent); `scripts/approve-buyer.py` approved 20/20 as a sandbox buyer; `finish` captured 18 and authorized 2, with the 1051 duplicate `0GX78358AV019410Y` two minutes after the first.
- One full close of that period in this app, in sandbox mode, through the browser: 15/20, 6 exceptions (mode B, see below), Unexplained $271.67, signed at $0.00 with $58.00 carried forward. Every id below came back from PayPal and was read back:
  - VERIFY 6: refund `0TB68373FK703634V` (order #1042, $89.00, capture `03A07651KS447104M` now REFUNDED) and partial refund `2T248348FD9414800` (order #1047, $4.67, capture `97M03786F8136220M` now PARTIALLY_REFUNDED), each approved from an owner link.
  - VERIFY 14 (d): capture `5P5249954H751362W` of hold `9HG18992LK8351456` ($120.00), which then reads CAPTURED.
  - VERIFY 14 (a): void of hold `1U584327LU028570K` ($65.00 released), which then reads VOIDED.
  - VERIFY 4: invoice `INV2-KVD5-PJMK-3TMB-GNLV` (number `p261112xpk-INV-0012`, SENT) for the phone order, and payment `EXTR-72W43837WD604723W` recorded on `INV2-6JF3-XTAF-NQC4-T4YJ` (MARKED_AS_PAID, 150.00).
- VERIFY 1, 9, 13: Transaction Search and Balances scope is granted on the sandbox app (searchTransactions 86 items, searchBalances 1 balance).
- VERIFY 2, 7, 14 (b), mode A: once the sandbox index caught up (about 5 hours after seeding), the same period opened with the badge "Source: PayPal Transaction Search · 19 transactions". Payments were kept by their `custom_field` tag, the earlier refunds showed as T1107 lines whose `paypal_reference_id` is the capture, and the duplicate check found order 1051 paid twice (`0GX78358AV019410Y`, same cart, same amount, 2 minutes apart). The owner link refunded it: refund `6VY43897TU6121035`, capture now REFUNDED; the same link again answered "already used".
- Earlier the same day: refund `75M999425T494132P`, final capture `7EF29184AT762933C`, PayPal-account authorization `1DY809243X095705T` with reauthorize on day 0 answered `REAUTHORIZATION_TOO_SOON` (VERIFY 5), and the 415 fix on authorize and capture (VERIFY 13).
- VERIFY 11 and 17 (model, not sandbox): the four AG Studio starter prompts (including delegation to the built-in Page and Widget agents), the promise reading and "Ask the Close Agent why" on E1 and E2 ran on Claude Sonnet through a local Claude Code account (not the API key path).

Not passed yet: the first sandbox close ran in mode B (the index was more than 5 hours behind, beyond PayPal's documented 3), said so on its badge and skipped the duplicate check; in mode B the exception ids shift by one (E2 is the coupon). The mode A run above was on the same, already closed period, so it was not signed a second time, and the searched line of refund `6VY43897TU6121035` was not indexed yet when we stopped (`node scripts/probe-index.js p261112xpk` shows it). Card orders answered 422 `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` (VERIFY 3, 8). Not run: the buyer activity screen (10).

Sandbox demo mode: put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `APPROVAL_SECRET` in `.env`, prepare a period with the three seed commands above (the buyer step reads `SANDBOX_BUYER_EMAIL` and `SANDBOX_BUYER_PASSWORD` from the environment), then `npm start`. The header says "PayPal sandbox" and the badge says which ledger source is live.

### Recorded model runs

`builtin/recorded-runs/` holds real Claude Sonnet runs recorded on 2026-11-12 with `LLM_BACKEND=account` and `RECORD_RUNS=1` (VERIFY 17): the daily check's promise reading, "Ask the Close Agent why" on E1 and E2, and the four AG Studio starter prompts, including the delegated sub-runs of the built-in Page and Widget agents. Each file has the tool calls in order, the model text and the time each model turn took. With no model configured the app replays them and labels them "Recorded run: Claude Sonnet, 2026-11-12": the recorded tool calls run again against this session's PayPal data (ids remapped), so results on screen are live and only the model text is from the recording. Scenes without a recording use a stand-in labelled "Stand-in (no model)" or "Fixed Agent Toolkit read sequence (no model)". With a model configured the app calls the model and never reads the recordings. `REPLAY_RECORDED_RUNS=0` turns replay off.

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
| `RECORD_RUNS`, `RECORDED_RUNS_DIR`, `REPLAY_RECORDED_RUNS` | Save real model runs (developer use with a model), where they live, replay them without a model | 0, `builtin/recorded-runs`, on |
| `FORCE_MOCK` | Ignore every key | 0 |
| `PORT`, `PUBLIC_URL`, `APP_URL` | Server address and link base | 3003 |

## Layout

```
server/paypal     mock.js, live.js, reporting.js (paging, 31-day split), toolkit.js (Agent Toolkit reads)
server/close      seed, ledger (mode A/B), periodTag, match (detection), bridge, actions, capturePlan, approvals, periods, package
server/agent      Claude tool loop, promise extractor, AG Studio turn translation, server tools (no PayPal writes)
client/src/studio widgets, theme, layouts, data sources, Close Agent, Claude adapter
client/src/desk   desk page, panels and the Sandbox evidence tab;  client/src/owner  the owner tab
builtin/recorded-runs  recorded Claude Sonnet runs replayed without a model;  docs/VIDEO_SCRIPT.md  the video plan
test              node --test: money, tag filters, Transaction Search schema, detection, actions, branches, periods, HTTP
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

PayPal Transaction Search (built against the published schema, sandbox scope granted, mode A run on the sandbox; the sandbox index ran about 5 hours behind), Payments, Orders and Invoicing (APIMatic PayPal SDK) and the PayPal Agent Toolkit; AG Studio (AG Grid); Claude; React 19, Vite, Express, zod.

License: MIT.
