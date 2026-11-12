# paypal-plan.md: CloseDesk on the APIMatic PayPal TypeScript SDK

Written before any project file was edited. Facts come from `node_modules/paypal/sdk-map.md`, `map/operations/*.md` and the model files named there. Nothing is from memory.

## 0. Survey and toolchain

| Item | Value |
| --- | --- |
| SDK | package `paypal` 2.29.0 (API spec 2.29), client `PaypalClient`, installed with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`, built by the install (`dist/esm`, `dist/commonjs` present) |
| Module format | app is ESM JavaScript (`"type": "module"`), no TypeScript, no `tsconfig`. `import { PaypalClient } from 'paypal'` resolves (checked). `instanceof` on SDK errors is reliable because the app loads only the ESM dialect |
| Runtime | Node >= 20.3 (SDK floor), Express 5 |
| Test runner | `node --test test/*.test.js` (`npm test`). Build: `vite build` (`npm run build`) |
| Type check | none exists in this JavaScript project. Not run (stated in BUILD_REPORT). The Fields tables below stand in for the compile-time backstop and the SDK adapter tests assert the wire request |
| Baseline on untouched tree | `npm test`: 74 pass, 0 fail |
| Exemplar for layering | `server/paypal/live.js` (adapter with the same method names as `server/paypal/mock.js`) |

Adapter interface (unchanged): `createOrder getOrder getAuthorization captureAuthorization reauthorizeAuthorization voidAuthorization getCapture refundCapture searchTransactions getBalances createInvoice sendInvoice getInvoice searchInvoices recordInvoicePayment fromAmount`. Results keep the wire (snake_case) shape the mock returns, produced by `<model>Schema.encode(value)` on the decoded SDK model, so callers do not change.

## 1. Host decision (explicit)

- The SDK declares one environment and no `ServerEnvironment`. The host is `serverOptions: { baseUrl }`.
- This deployment talks to the PayPal **sandbox** only: `PAYPAL_API_BASE` (default `https://api-m.sandbox.paypal.com`). `server/paypal/sdkClient.js` refuses to build the client for any other host except a `localhost` or `127.0.0.1` URL (local fake server). The live host `api-m.paypal.com` fails startup of the SDK path. Binding of (host, credential): sandbox credentials only, live credentials are never supported by this app.
- Token endpoint follows the same base URL (SDK behaviour).
- One client is built once and held (`getSdkClient()`), because the OAuth token cache lives on it. It is rebuilt only by `resetSdkClient()`, which `terminateToken()` calls so a terminated token is not reused (VERIFY item 1).

## 2. Operation scope

| App operation | SDK operation | Status |
| --- | --- | --- |
| `createOrder` | `client.orders.createOrder`, then `authorizeOrder` or `captureOrder` if the order is not COMPLETED | SDK |
| `getOrder` | `client.orders.getOrder` | SDK |
| `getAuthorization` | `client.payments.getAuthorizedPayment` | SDK |
| `captureAuthorization` | `client.payments.captureAuthorizedPayment` | SDK |
| `reauthorizeAuthorization` | `client.payments.reauthorizePayment` | SDK |
| `voidAuthorization` | `client.payments.voidPayment` | SDK |
| `getCapture` | `client.payments.getCapturedPayment` | SDK |
| `refundCapture` | `client.payments.refundCapturedPayment` | SDK |
| `searchTransactions` | `client.transactionSearch.searchTransactions` (it IS in the SDK) | SDK |
| `getBalances` | `client.transactionSearch.searchBalances` | SDK |
| `createInvoice`, `sendInvoice`, `getInvoice`, `searchInvoices`, `recordInvoicePayment` | none (no Invoicing resource: the SDK has orders, payments, vault, transactionSearch, subscriptions) | **not in SDK, kept on REST** (`server/paypal/live.js`) |
| `tokenScopes`, `terminateToken` (OAuth scope probe and token terminate, VERIFY item 1) | none (SDK hides the token response and has no terminate) | **not in SDK, kept on REST** |
| Agent Toolkit read tools (`server/paypal/toolkit.js`, used by Claude) | not touched. The toolkit is a separate package with its own client and reads only | kept as is |

## 3. Contract sheet (lookups, one pass)

Common: call shape `op(request, options?)`, request flat and channel-blind, returns `ApiPromise<T, E>`, awaited (throwing mode). `.asApiResult()` is not used: no operation here resolves to `undefined`, and a uniform `try/catch` ladder in one translator keeps every call handled the same way. Pagination: none in the SDK, the app's own loop in `server/paypal/reporting.js` pages (bounded by `total_pages` from the response and the 31-day window splitter). `Error` from the package is a model type: the adapter never imports it (uses `PaypalError`, `ApiError`).

| Operation | Request type | Wire | Fields the app sets (channel, wire name) | Returns | Error arms (status) |
| --- | --- | --- | --- | --- | --- |
| `orders.createOrder` | `Orders.CreateOrderRequest` | `POST /v2/checkout/orders` | `body` (`OrderRequest`: `intent`, `purchaseUnits[{amount{currencyCode,value}, customId, invoiceId}]`, `paymentSource.card{number,expiry,name,billingAddress}`) required; `payPalRequestId` header `PayPal-Request-Id`; `prefer` header `Prefer` | `Order` | error 400, error2 401, error3 422, error4 default (all `Error`), undeclared |
| `orders.authorizeOrder` | `Orders.AuthorizeOrderRequest` | `POST /v2/checkout/orders/{id}/authorize` | `id` path; `payPalRequestId`; `prefer` | `OrderAuthorizeResponse` | error 400, error2 401, error3 403, error4 404, error5 422, error6 500, error7 default, undeclared |
| `orders.captureOrder` | `Orders.CaptureOrderRequest` | `POST /v2/checkout/orders/{id}/capture` | `id` path; `payPalRequestId`; `prefer` | `Order` | same arms as authorize |
| `orders.getOrder` | `Orders.GetOrderRequest` | `GET /v2/checkout/orders/{id}` | `id` path | `Order` | error 401, error2 404, error3 default, undeclared |
| `payments.getAuthorizedPayment` | `Payments.GetAuthorizedPaymentRequest` | `GET /v2/payments/authorizations/{authorization_id}` | `authorizationId` path | `PaymentAuthorization` | error 401, error2 403, error3 404, error500 500 (no body), error4 default, undeclared |
| `payments.captureAuthorizedPayment` | `Payments.CaptureAuthorizedPaymentRequest` | `POST .../authorizations/{authorization_id}/capture` | `authorizationId` path; `payPalRequestId` header; `body` (`CaptureRequest`: `amount`, `finalCapture`) | `CapturedPayment` | error 400, error2 401, error3 403, error4 404, error5 409, error6 422, error500 500 (no body), error7 default, undeclared |
| `payments.reauthorizePayment` | `Payments.ReauthorizePaymentRequest` | `POST .../authorizations/{authorization_id}/reauthorize` | `authorizationId` path; `payPalRequestId`; `body` (`ReauthorizeRequest`: `amount`) | `PaymentAuthorization` | error 400, error2 401, error3 403, error4 404, error5 422, error500 500 (no body), error6 default, undeclared |
| `payments.voidPayment` | `Payments.VoidPaymentRequest` | `POST .../authorizations/{authorization_id}/void` | `authorizationId` path; `payPalRequestId` | `PaymentAuthorization` | error 401, error2 403, error3 404, error4 409, error5 422, error500 500 (no body), error6 default, undeclared |
| `payments.getCapturedPayment` | `Payments.GetCapturedPaymentRequest` | `GET /v2/payments/captures/{capture_id}` | `captureId` path | `CapturedPayment` | error 401, error2 403, error3 404, error500 500 (no body), error4 default, undeclared |
| `payments.refundCapturedPayment` | `Payments.RefundCapturedPaymentRequest` | `POST .../captures/{capture_id}/refund` | `captureId` path; `payPalRequestId`; `body` (`RefundRequest`: `amount`, `noteToPayer`) | `Refund` | error 400, error2 401, error3 403, error4 404, error5 409, error6 422, error500 500 (no body), error7 default, undeclared |
| `transactionSearch.searchTransactions` | `TransactionSearch.SearchTransactionsRequest` | `GET /v1/reporting/transactions` | `startDate`, `endDate` (required, query `start_date`, `end_date`), `transactionStatus`, `transactionId`, `fields`, `pageSize`, `page` | `SearchResponse` | `searchError` default (any status), undeclared |
| `transactionSearch.searchBalances` | `TransactionSearch.SearchBalancesRequest` | `GET /v1/reporting/balances` | `asOfTime`, `currencyCode` | `BalancesResponse` | defaultError 400, defaultError2 403, defaultError3 500, defaultError4 default, undeclared |

Model facts used: every response member the app reads is optional on the SDK type (`id?`, `status?`, ...), so a thin 2xx decodes without error. Guard: after each write the adapter asserts `id` is present and treats a missing `id` as an unknown outcome. Dates in these models are plain strings (not `Date`). Money is `{ currencyCode, value: string }`, kept as strings, built by `toValue(cents)` from integer cents (no float). Enums are open, status compared as strings. `CaptureRequest.finalCapture` is a defaulted field (`false` is sent when omitted), so the adapter always sets it from the caller (`finalCapture`, true for CAPTURE_AUTH).

Defaults the SDK sends when omitted (Default column): `prefer = "return=minimal"` on all POSTs, `fields = "transaction_info"`, `balanceAffectingRecordsOnly = "Y"`, `pageSize = 100`, `page = 1` on `searchTransactions`. The app always passes `fields`, `pageSize` and `page` explicitly (as `reporting.js` does today). `balanceAffectingRecordsOnly` is left to the SDK default `"Y"`, which is also what the REST code got.

Enum members used: none from the SDK constants (intent `CAPTURE` or `AUTHORIZE` is the app's own value from the books, passed as the open string).

## 4. DURABLE WRITES

### DUPLICATE CLAIMS

Store: `server/paypal/claims.js`, an in-process `Map` owned by the app (the app has no database; all state in this repo is in memory). A claim is its own entry, inserted before the SDK call by `claim(key)`, which refuses when the key exists (`Map.has` then `set` in one synchronous step, so no interleaving). Key = operation + the target PayPal id + the caller-computed `requestId`. `requestId` is `stableHash(close.id, exception.id, action)` in `actions.js`, the same for every caller doing the same action. Not minted per attempt. Limit: in memory means a process restart forgets claims; the deterministic `PayPal-Request-Id` header sent beside the claim is the provider-side backstop.

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| refund capture | claim store key `refund:{captureId}:{requestId}` | `claims.claim()` throws `DuplicateClaimError` if the key exists | `runWrite` in `server/paypal/sdkWrites.js` catches it by class; a settled prior returns the winner's result, a pending or unknown prior throws 409 / reread | `sdkWrites.js` `runWrite` claim step, called by `sdk.js` `refundCapture` |
| capture authorization | key `capture:{authId}:{requestId}` | same | same | `sdk.js` `captureAuthorization` |
| reauthorize authorization | key `reauth:{authId}:{requestId}` | same | same | `sdk.js` `reauthorizeAuthorization` |
| void authorization | key `void:{authId}:{requestId or none}` | same | same | `sdk.js` `voidAuthorization` |
| create order | key `create-order:{invoiceId}` (`{periodId}-{orderNo}`, same for every seeder of that order) | same | same | `sdk.js` `createOrder` |
| authorize order, capture order (card follow-up) | keys `authorize-order:{orderId}`, `capture-order:{orderId}` | same | same | `sdk.js` `finishOrder` |

The claim is released when the provider refuses the call (an `api` error), and when the request never left (`encode`, `auth`). It is kept as `unknown` after a connection, timeout or unreadable 2xx. The in-process lock `withLock` in `actions.js` stays as the first line; it is not the claim.

### UNKNOWN OUTCOMES

A `connection` or `timeout` error, a `decode` error on a 2xx status, or a 2xx body without an `id` is an unknown outcome. It is settled in that write's own `catch` (`runWrite`) by the re-read below. Found: the claim becomes `done` with what PayPal holds. Not found or the re-read fails: stays `unknown`, the app answers "outcome unknown", never "failed". `encode` and `auth` errors never left the app and skip the re-read.

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| refund capture | `transactionSearch.searchTransactions` (fields all) over the window from claim time minus 5 min to now | line with `paypal_reference_id` = capture id, event code `T1107`, absolute amount = refund amount | `sdkWrites.js` reread closure built in `sdk.js` `refundCapture` | `refund: a lost connection re-reads Transaction Search and settles from the refund line`; `refund: a request that never left (credential refused) makes no re-read and releases the claim` |
| capture authorization | `payments.getAuthorizedPayment` | authorization id; found when status is `CAPTURED` (final capture) | `sdk.js` `captureAuthorization` | `capture: a timeout re-reads the authorization and settles when it is CAPTURED`; `capture: a value the SDK refuses to encode sends nothing, re-reads nothing and releases the claim` |
| reauthorize authorization | `payments.getAuthorizedPayment` | authorization id; found when `update_time` is at or after the claim time | `sdk.js` `reauthorizeAuthorization` | `reauthorize: a lost answer re-reads the authorization; AuthError makes no re-read` |
| void authorization | `payments.getAuthorizedPayment` | authorization id; found when status is `VOIDED` | `sdk.js` `voidAuthorization` | `void: PayPal answering 204 with no body is settled by re-reading VOIDED`; `void: a lost connection with the authorization still CREATED stays unknown; AuthError makes no re-read` |
| create order | none (see Blockers) | none | `sdk.js` `createOrder` | `create order: a lost answer cannot be looked up, so it stays unknown and a repeat never calls PayPal again` |
| authorize order, capture order | `orders.getOrder` | order id; found when status is `COMPLETED` | `sdk.js` `finishOrder` | `create order: card source, representation back, follow-up capture when not completed, claims per step` |

### CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| Refund amount must be within what is refundable on the capture | PayPal capture amount (`getCapture`) minus what this app already refunded (`close.refundIndex`) | `actions.js` `runAction` (REFUND_*) before the claim and the SDK call | `a refund above the captured balance is refused by PayPal and by the app` (existing); `SDK: a refund above what is refundable never reaches refundCapturedPayment` |
| Capture amount must not exceed the authorized amount | `getAuthorization` | `actions.js` `captureAuthorization` | existing E4 tests |
| Authorization, capture and order ids that reach a write | server-derived from the close's own exceptions (`ex.authId`, `ex.captureId`), never from an HTTP body | `actions.js` `findException` | `an approval request cannot set the amount: the card amount comes from PayPal data and the books` (existing) |
| Money amounts | integer cents computed by the server, formatted with `toValue` | `server/util/money.js`, adapter `toMoney` | `create order: card source, ...` asserts `"46.67"`; `refund: the claim exists when the request leaves...` asserts `"4.67"` |

### OPTIONAL FIELDS (writes)

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` (all writes) | DUPLICATE CLAIMS rows (the key goes beside the claim) | set |
| `prefer` on `createOrder`, `authorizeOrder`, `captureOrder` | seed reads `purchase_units[0].payments.captures/authorizations` from the answer (existing `seed.js`), so `return=representation` | set to `return=representation` |
| `prefer` on refund, capture, reauthorize, void | the app reads only `id`, which the minimal answer carries | leave out |
| `payPalMockResponse`, `payPalAuthAssertion`, `payPalClientMetadataId`, `payPalPartnerAttributionId` | nothing | leave out |
| `body.amount` (capture, reauthorize, refund) | the server-computed card amount (task words: refund exactly the captured amount, capture the order total) | set from integer cents |
| `body.finalCapture` (capture) | CAPTURE_AUTH closes the authorization (existing behaviour) | set `true` |
| `body.noteToPayer` (refund) | the existing refund note per exception code | set |
| `body.invoiceId`, `body.customId`, `softDescriptor`, `paymentInstruction` | nothing (`invoiceId` is passed by the caller only when it has one: never today) | leave out |
| `OrderRequest.processingInstruction`, `payer`, `applicationContext` | nothing | leave out |
| `purchaseUnits[].referenceId`, `description`, `payee`, `items`, `shipping`, breakdown | nothing | leave out |
| `purchaseUnits[].customId`, `invoiceId` | the period tag and order reference the seed uses to find its own payments later (existing behaviour, `periodTag.js`) | set |
| `paymentSource.card.number, expiry, name, billingAddress` | sandbox card seeding without a buyer screen (existing behaviour, VERIFY item 3) | set (sandbox test card data from `live.js`) |
| `paymentSource.card.securityCode, attributes, storedCredential, ...` | nothing | leave out |
| `searchTransactions`: `transactionStatus`, `fields`, `pageSize`, `page`, `startDate`, `endDate`, `transactionId` | existing `reporting.js` behaviour | set when the caller gives them |
| `searchTransactions`: all other filters, `balanceAffectingRecordsOnly` | nothing | leave out (SDK default `Y` applies) |
| `searchBalances`: `asOfTime`, `currencyCode` | existing behaviour (now, USD) | set |

Test that proves it: the SDK adapter tests assert the captured request for each write carries only the header and body keys listed as "set" here (plus what the SDK adds itself: authorization, content type, `Idempotency-Key`).

### WHEN THE API SAYS NO

One translator (`server/paypal/sdkErrors.js`) maps every SDK failure the same way for every operation. `PayPalError.status` keeps the provider status (reporting code reads `403`), and `appStatus` is what the app answers.

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` (`appStatus`) | the API's reason from `err.payload` (name, message, `details[].issue`) in the HTTP body via `executeCard` | `refund: PayPal refusing the call releases the claim, the reason reaches the caller, ...` and `SDK: PayPal refusing a refund shows its reason to the approver and keeps its 4xx status` |
| 401 / 403 | 502 | fixed: "PayPal rejected this app's credentials or scope." | `reads: every failure kind maps the same way for every operation` (401, 403, 429, 5xx, 404 with reason, unreadable 2xx, no response); `Transaction Search: ... a missing scope is detected` keeps 403 for the scope probe |
| 429 | 503 | fixed: "PayPal is rate limiting this app. Try again later." | fake a 429; assert 503 |
| 5xx | 502 | fixed: "PayPal had an error." | fake a 500; assert 502 |
| `decode` on an error status | the same class as above by status, no reason text | fixed or "PayPal rejected the request." | fake a 422 with a non-JSON body |
| `decode` on a 2xx | write: unknown outcome. read: 502 | write: "outcome unknown"; read: fixed "PayPal answered with something unreadable." | fake a 200 with `{"id": 42}` |
| no response, on a write | per UNKNOWN OUTCOMES | "Outcome unknown. Check PayPal before trying again." (code `OUTCOME_UNKNOWN`) | connection and timeout tests |
| no response, on a read | 502 | fixed: "PayPal could not be reached." | fake a thrown fetch |
| `encode`, `auth` | 502 for auth, 500 for encode | fixed text, no re-read | EncodeError and AuthError tests |

Logging: the translator logs `method uri status`, the `paypal-debug-id` response header and the payload `debug_id` through an injectable logger (default `console.error`), so the correlation id reaches the app's logs. The SDK's own logging stays off (section 6).

## 5. Retry, timeouts, fetch seam

- Retry: SDK defaults retry GET, HEAD, PUT, OPTIONS (not POST). Reads keep the defaults with a per-attempt `timeout` of 20 000 ms. Every write passes `{ retry: { maxRetries: 0 } }` on the call (sent once, no resend), because our claim plus re-read is the policy, not blind retry. No write method is added to `httpMethodsToRetry`.
- Whole-call bound: the app does not add a deadline above the SDK (worst case for a read is 4 x 20 s plus waits). Accepted for a demo that runs on a mock by default.
- `ClientOptions.fetch`: not replaced in production (global `fetch`). Tests inject a fake `fetch`. No hooks or middleware exist in the SDK; none is built. No rate limiter, no circuit breaker (stated: deliberately omitted).
- Pagination and streaming: none in the SDK; the app's `listAllTransactions` loop pages by `total_pages`.

## 6. Logging and sensitive data

- `logging: { level: 'off' }` set explicitly in `sdkClient.js`, so `PAYPAL_CLIENT_LOG` cannot switch it on from outside. `logRequestBody` stays off: `createOrder` carries a card number and expiry in the request body (sandbox test card), and a JSON body would be logged verbatim. No call passes a per-call logging level.
- Correlation ids reach the app's own logs through the translator (section 4).

## 7. Assumptions & Blockers

- **Blocker (accepted, scoped to the seeder):** `createOrder` has no lookup by reference. If the answer is lost, an orphan sandbox order may exist. The claim stays `unknown`, a repeat of the same seed order is refused without calling PayPal, and the period manager discards that period. Only sandbox test orders are at risk, not the seller's money.
- Assumption: Transaction Search shows a refund line with `paypal_reference_id` = capture id and event code `T1107` (VERIFY item 7 already checks this). Indexing lag (about 3 hours) means a re-read right after a lost answer is usually "not found", which stays "unknown", never "failed".
- Assumption: a reauthorization keeps the authorization id and moves `update_time` (VERIFY item 5 checks it). If PayPal returns a new id, the re-read cannot find it and the outcome stays unknown.
- Assumption: the capture status after a final capture is `CAPTURED` on the authorization (enum member present in `AuthorizationStatus`).
- Assumption: PayPal may answer a void with 204 and no body. The SDK declares a `PaymentAuthorization` body and reports an empty body as an unreadable 2xx. That is an unknown outcome by design and the re-read (authorization is `VOIDED`) settles it (VERIFY item 14).
- The in-memory claim store does not survive a restart (stated above). Minor.
- No TypeScript type check exists in this project (stated in section 0). Minor.

## 8. REQUIRED READING

- MUST load `typescript-error-handling`: done. Family ladder, rethrow of the outside four (abort reason, ConfigurationError, SchemaError, TypeError), decode on 2xx vs error status, `err.message` never put on the wire.
- MUST load `typescript-client-initialization`: done. One long-lived client, no per-request rebuild.
- MUST load `typescript-authentication`: done. `oauth2: { clientId, clientSecret }`, token lazy and cached on the client, `AuthError` carries the token endpoint error on `cause`.
- MUST load `typescript-calling-endpoints`: done. Flat request, defaults are sent, `.asApiResult()` not used.
- MUST load `typescript-models`: done. Optional members, open enums, money as strings, `Schema.encode` to hand out the wire shape.
- MUST load `typescript-configuration-resilience`: done. Writes sent once, `Idempotency-Key` is per call, our key beside the claim, logging explicit off.
- MUST load `typescript-testing`: done. Faked `fetch`, token request is the first request, `retry.maxRetries: 0` in test clients, wire-shaped stub bodies, assert the captured request, cover connection, timeout, decode, encode, auth.
