# APIMatic Context Plugin: what was done and what it found

One page for reviewers. Contract sheet: [`paypal-plan.md`](paypal-plan.md).

## Install and skills

The generated PayPal TypeScript SDK is installed from the Context Plugin repository (not on npm):

```bash
npm install github:context-plugins/paypal-typescript-sdk#main   # package "paypal", client PaypalClient
```

Skills followed: `typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, `typescript-client-initialization`, `typescript-authentication`, `typescript-calling-endpoints`, `typescript-models`, `typescript-configuration-resilience`, `typescript-testing`.

## What goes through the SDK and what stays on REST

| Area | Path | File |
|---|---|---|
| Orders (create, authorize, capture, get) | SDK | `server/paypal/sdk.js` |
| Payments (authorization get, capture, reauthorize, void; capture get; refund) | SDK | `server/paypal/sdk.js` |
| Transaction Search and Balances | SDK | `server/paypal/sdk.js` |
| Invoicing (create, send, get, search, record payment) | REST, the SDK has no such resource | `server/paypal/live.js` |
| OAuth scope probe, token terminate | REST | `server/paypal/live.js` |
| Agent Toolkit read tools for Claude | Toolkit | `server/paypal/toolkit.js` |

## Real sandbox results (VERIFY.md, 2026-11-12)

- Read smoke: `searchBalances` and `searchTransactions` answered 403 (debug ids `ca5918dd04c18`, `ca5918dd1c864`). The token request works, the reporting scopes are missing, so the app runs in mode B and says so.
- Finding: `authorizeOrder` and `captureOrder` sent without a body answered 415. `finishOrder` now sends body `{}`; both then answered 200.
- Writes through the SDK: refund `75M999425T494132P`, final capture `7EF29184AT762933C`, a PayPal-account authorization `1DY809243X095705T` (reauthorize on day 0 answered `REAUTHORIZATION_TOO_SOON`).
- Card order create answered 422 `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`. The SDK order request now has a second branch, `payment_source.paypal` with `experience_context` (see `test/sdk-orders.test.js`).

## Write confirmation design (claim and read-back)

Every money write is claimed before the call (`server/paypal/claims.js`), sent once with no SDK retry, and recorded. If the answer is lost (dropped connection, timeout, unreadable 2xx, missing id), the same function re-reads PayPal (`server/paypal/sdkWrites.js`): a refund shows as a `T1107` line, a capture as the authorization state CAPTURED, a void as VOIDED. Not found means "outcome unknown", never "failed", and a repeat of the same write re-reads instead of sending again. Tests run against a faked `fetch` (`test/sdk-adapter.test.js`, `test/sdk-actions.test.js`, `test/sdk-orders.test.js`).
