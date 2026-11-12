import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SANDBOX_PASSED, SANDBOX_NOT_PASSED } from '../client/src/desk/sandboxEvidence.js'

// The docs repeat what VERIFY.md records. Status lines were written by hand and went stale (REVIEW_4 E4:
// "not deployed yet" after hosting passed, "scope pending" after the scope was granted, an E4 row that
// kept the failure but not the sandbox capture). These tests read VERIFY.md and fail when a doc says otherwise.

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const DOCS = ['README.md', 'DEVPOST.md', 'APIMATIC.md', 'docs/VIDEO_SCRIPT.md']
const verify = read('VERIFY.md')

// VERIFY rows: "| <n> | question | how | result |". The last status word in a row is its current result.
const STATUS = /\b(PASS|FAIL|PARTIAL|SKIPPED|NOT YET)\b/g
function verifyRows() {
  const rows = new Map()
  for (const line of verify.split('\n')) {
    const m = line.match(/^\| (\d+) \|/)
    if (m) rows.set(Number(m[1]), line)
  }
  return rows
}
const latest = (text) => [...text.matchAll(STATUS)].at(-1)?.[1]
const hostingSection = () => verify.split('## Hosting')[1] || ''

test('verify_rows_each_have_a_current_result', () => {
  const rows = verifyRows()
  assert.ok(rows.size > 0)
  for (const [n, line] of rows) assert.ok(latest(line), `VERIFY ${n} has no result word`)
})

test('docs_state_the_verify_check_count', () => {
  const count = verifyRows().size
  for (const file of DOCS) {
    for (const m of read(file).matchAll(/VERIFY(?:\.md`?)? lists (\d+) checks/g)) assert.equal(Number(m[1]), count, `${file}: "${m[0]}"`)
  }
})

test('hosting_status_in_the_docs_matches_verify', () => {
  const section = hostingSection()
  const url = section.match(/https:\/\/[^\s)]+/)?.[0]
  const passed = latest(section) === 'PASS'
  for (const file of ['README.md', 'DEVPOST.md']) {
    const text = read(file)
    if (passed) {
      assert.doesNotMatch(text, /not deployed|no hosted|hosted url: (?:none|tbd|pending)/i, `${file} says the demo is not hosted, VERIFY Hosting is PASS`)
      assert.ok(text.includes(url), `${file} does not give the hosted URL ${url}`)
    } else {
      assert.ok(!url || !text.includes(url), `${file} links a host VERIFY has not passed`)
    }
  }
})

test('transaction_search_scope_status_matches_verify_item_1', () => {
  const granted = latest(verifyRows().get(1)) === 'PASS'
  for (const file of DOCS) {
    const text = read(file)
    if (granted) assert.doesNotMatch(text, /scope (?:is )?(?:still )?(?:pending|missing|not granted)|reporting scopes are missing/i, `${file} says the scope is missing, VERIFY 1 is PASS`)
    else assert.doesNotMatch(text, /scope (?:is )?granted/i, `${file} says the scope is granted, VERIFY 1 is not PASS`)
  }
})

test('mode_a_and_duplicate_status_matches_verify_items_2_and_14', () => {
  const modeA = latest(verifyRows().get(2)) === 'PASS'
  const stale = /duplicate(?: check| refund)?[^.]*(?:not verified|unverified|stayed unverified|was not checked)|ran in mode B[^.]*\bonly\b/i
  for (const file of [...DOCS, 'client/src/desk/sandboxEvidence.js']) {
    if (modeA) assert.doesNotMatch(read(file), stale, `${file} says the duplicate check never ran on the sandbox, VERIFY 2 is PASS`)
  }
})

test('every_sandbox_id_in_the_docs_and_the_evidence_tab_is_recorded_in_verify', () => {
  // PayPal capture, refund and authorization ids (17 characters), invoice ids and recorded payment ids.
  const id = /\b(?:INV2(?:-[A-Z0-9]{4}){4}|EXTR-[A-Z0-9]{12,}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{17})\b/g
  const sources = [...DOCS.map((f) => [f, read(f)]), ['SandboxEvidence.jsx', JSON.stringify([SANDBOX_PASSED, SANDBOX_NOT_PASSED])]]
  let seen = 0
  for (const [file, text] of sources) {
    for (const [hit] of text.matchAll(id)) {
      seen += 1
      assert.ok(verify.includes(hit), `${file} cites ${hit}, which VERIFY.md does not record`)
    }
  }
  assert.ok(seen > 10, 'the docs cite the sandbox ids')
})

test('the_readme_gap_table_cites_the_sandbox_result_of_each_action_verify_passed', () => {
  const row = (code) => read('README.md').split('\n').find((l) => l.startsWith(`| ${code} |`)) || ''
  const capture = verifyRows().get(14).match(/capture (\w{17}) of authorization/)?.[1]
  assert.ok(capture, 'VERIFY 14 records the E4 sandbox capture')
  assert.ok(row('E4').includes(capture), `README E4 row should cite sandbox capture ${capture}`)
})

test('evidence_tab_lists_no_verify_item_as_not_passed_once_verify_says_pass', () => {
  const rows = verifyRows()
  for (const x of SANDBOX_NOT_PASSED) {
    for (const [n] of x.id.matchAll(/\d+/g)) {
      if (!x.id.startsWith('VERIFY')) continue
      assert.notEqual(latest(rows.get(Number(n)) || ''), 'PASS', `evidence tab lists VERIFY ${n} as not passed`)
    }
  }
})

test('docs_do_not_hard_code_a_test_count', () => {
  const count = /\b\d+\s+(?:automated\s+|new\s+|unit\s+)?tests?\b|\btests?\s*[:=]\s*\d+\b|\b\d+\s*\/\s*\d+\s+pass/
  for (const file of DOCS) {
    const hit = read(file).split('\n').find((line) => count.test(line))
    assert.equal(hit, undefined, `${file} hard-codes a test count: ${hit}`)
  }
})
