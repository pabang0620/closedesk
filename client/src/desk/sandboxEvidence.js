// What really ran against the PayPal sandbox and the model on 2026-11-12, copied from VERIFY.md.
// Only PASS results (or the passing part of a PARTIAL item) are listed as passed. Everything else is listed as not passed.
export const SANDBOX_PASSED = [
  { id: 'VERIFY 15, 16', what: 'Seeded period p261112xpk with PayPal-account orders, approved by a sandbox buyer (20/20), then 18 captures and 2 holds; the 1051 duplicate two minutes later', ids: ['duplicate capture 0GX78358AV019410Y', 'holds 9HG18992LK8351456, 1U584327LU028570K'] },
  { id: 'Sandbox close', what: 'One full close in this app on the sandbox (mode B, Transaction Search not indexed yet): 4 owner approvals, 2 bookkeeper approvals, signed at $0.00 with $58.00 carried forward', ids: [] },
  { id: 'VERIFY 6', what: 'Refund (promised refund, order #1042) and partial refund (coupon, order #1047) through the APIMatic SDK from owner links', ids: ['refund 0TB68373FK703634V on capture 03A07651KS447104M (REFUNDED)', 'refund 2T248348FD9414800 on capture 97M03786F8136220M (PARTIALLY_REFUNDED)', 'earlier: refund 75M999425T494132P'] },
  { id: 'VERIFY 14 (d)', what: 'Capture of a shipped order\'s hold, then the authorization reads CAPTURED', ids: ['capture 5P5249954H751362W of 9HG18992LK8351456', 'earlier: capture 7EF29184AT762933C'] },
  { id: 'VERIFY 14 (a)', what: 'Void of a cancelled order\'s hold; the authorization reads VOIDED', ids: ['authorization 1U584327LU028570K'] },
  { id: 'VERIFY 4', what: 'Invoicing: create and send, and record a bank payment on an open invoice', ids: ['invoice INV2-KVD5-PJMK-3TMB-GNLV (SENT)', 'payment EXTR-72W43837WD604723W on INV2-6JF3-XTAF-NQC4-T4YJ (MARKED_AS_PAID)'] },
  { id: 'VERIFY 2, 7, 14 (b)', what: 'Mode A on the same period once the sandbox index caught up (about 5 hours): badge "Source: PayPal Transaction Search", payments kept by their custom_field tag, refund lines point at their capture, and the duplicate check found order 1051 paid twice; the owner link refunded it', ids: ['refund 6VY43897TU6121035 on capture 0GX78358AV019410Y (REFUNDED)', 'refund line 0TB68373FK703634V -> 03A07651KS447104M'] },
  { id: 'VERIFY 1, 9, 13', what: 'Transaction Search and Balances scope granted; SDK reads answer', ids: ['searchTransactions 86 items', 'searchBalances 1 balance'] },
  { id: 'VERIFY 5', what: 'PayPal-account authorization; reauthorize on day 0 refused as PayPal documents', ids: ['authorization 1DY809243X095705T', '422 REAUTHORIZATION_TOO_SOON'] },
  { id: 'VERIFY 11, 17', what: 'Model, not sandbox: Close Agent in AG Studio on account-mode Claude Sonnet (not the API key path), including delegation to the built-in Page and Widget agents', ids: [] },
]

export const SANDBOX_NOT_PASSED = [
  { id: 'Mode A signed close', what: 'The mode A run used the period already closed in mode B, so it was not signed again; the searched line of refund 6VY43897TU6121035 was not indexed yet (node scripts/probe-index.js p261112xpk).' },
  { id: 'VERIFY 3, 8', what: 'Card orders refused (422 PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING).' },
  { id: 'VERIFY 10', what: 'Buyer activity screen: needs a person to look.' },
]
