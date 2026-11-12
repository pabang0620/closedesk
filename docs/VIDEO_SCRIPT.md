# CloseDesk video script (2:45)

Start the app in the exact recording state with one command:

```bash
npm install
npm run demo:video     # builds, then serves http://localhost:3003 on mock PayPal with the recorded Claude Sonnet runs
```

`demo:video` ignores every key in `.env` (`FORCE_MOCK=1`), so the numbers below are always the same: 15/20 matched, 7 exceptions, Unexplained $306.17. The AI scenes replay real Claude Sonnet runs recorded on 2026-11-12 (labelled "Recorded run: Claude Sonnet, 2026-11-12" on screen), and the PayPal reads in them run live against the mock. Record at 1440x900, light theme first. Step names match the README "Judge walkthrough".

Keep the live walkthrough in mock mode. For the final evidence shot, show the saved sandbox results in the evidence tab. The sandbox period was signed in mode B with six exceptions. Once indexed, the same period reopened in mode A with 19 payments and the duplicate refund was confirmed on the capture. It was not signed a second time. Leave out card processing and the buyer activity screen (VERIFY 3 and 10).

| Time | Step | On screen | Narration / caption (English) | Criterion |
|---|---|---|---|---|
| 0:00-0:15 | Hook | Zoom on E1: the underlined support reply "I've refunded your order, you'll see it in a few days." next to the PayPal capture with no refund | "Support told a customer her refund was done. In PayPal it never happened. CloseDesk caught it in this morning's check." | Problem, audience |
| 0:15-0:22 | Caption | One caption line over the desk | "Sync tools copy PayPal into the books. Checking PayPal against what the shop promised is still manual." | Innovation |
| 0:22-0:40 | Step 1 Open the close | Badge line ("Source: PayPal Transaction Search · 18 transactions · (period dates) · mock PayPal · AI: Recorded run: Claude Sonnet, 2026-11-12 ..."), then the Agent trace tab: `record_promise` with the recorded-run label, `list_transactions` lines | "Every morning it reads the books, the support inbox and PayPal. Claude reads the support replies and quotes each promise. This is a recorded run of Claude Sonnet; the PayPal side here is a mock that follows PayPal's published schemas." | Technical, AI use, honesty |
| 0:40-0:50 | Step 2 Read the Close Meter | Close Meter 15/20, 7 exceptions, Unexplained $306.17 | "Fifteen of twenty orders match. Seven gaps, $306.17 unexplained. Amounts come from code, never from the model." | Technical |
| 0:50-1:15 | Step 3 Approve E1 | Propose on E1, approval card ("$306.17 -> $217.17"), Send owner link, the waiting note, owner tab, Approve, refund id on the card | "Only the owner moves money, from a one-time link. The amount comes from the capture." | Money safety, UX |
| 1:15-1:40 | Step 4 Filter and ask why | Click the E2 title: the ledger grid keeps only the C-1051 lines. Press "Ask the Close Agent why" on E2: label "Recorded run: Claude Sonnet, 2026-11-12", the answer, the `agent-toolkit` calls (`get_order`, `list_transactions`) | "Click a gap and the ledger filters to it. Ask why, and Claude investigates with PayPal Agent Toolkit reads, in the order it chose." | AG Grid, Agent Toolkit, AI depth |
| 1:40-2:00 | Step 5 Close Agent in AG Studio | Edit layout and Close Agent, "Refund promises older than 1 day": a filtered grid widget appears. "Chart money at stake": a bar chart appears. Merchant view, Dark for one second | "A custom Close Agent on Claude, plugged into AG Studio's agent framework, builds widgets from a question." | AG Grid (Agent Framework, layouts, theme) |
| 2:00-2:22 | Step 6 Resolve E2 to E7 | E2 refund, E3 partial refund $4.67, E4 capture, E5 "bridge unchanged, releases $65.00 held", E6 invoice (Carried forward $58.00), E7 record payment | "A duplicate, a coupon that was not applied, a hold to capture and one to release. The bookkeeper can bill and record, not refund." | Completeness |
| 2:22-2:37 | Step 7 Sign close | Unexplained $0.00, Sign close, Close package (PayPal ids executed, journal lines "Customer overpayments") | "Every gap is fixed in PayPal or carried forward with a reason, and the books get journal lines." | Accounting value |
| 2:37-2:45 | Sandbox evidence | On the "Sandbox evidence" tab zoom to VERIFY 2, 7, 14 (b): order 1051, capture 0GX78358AV019410Y and refund 6VY43897TU6121035. Caption: "Mode B: signed close. Mode A: later duplicate refund." | "After the sandbox close, Transaction Search found this duplicate. The owner approved its refund." | PayPal integration |

Recording notes:
- Keep payment scenes in one take, zoom to the card. Stay under 2:50.
- Both Studio prompts have recordings. If an answer ends with "(Stand-in, no model)" instead of the recorded-run label, the prompt text differs from the recording: use the starter buttons.
- No music with a copyright claim.
