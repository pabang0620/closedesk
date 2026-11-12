import { useSyncExternalStore } from 'react'
import { api } from './api.js'

// One small external store. Studio's `context` property is read only once, so the custom widgets
// subscribe to this store instead of receiving props.
const listeners = new Set()
let state = { view: null, tables: null, version: 0, busy: false, error: null, notice: null, ownerUrl: null, package: null, selectedException: null, explanations: {} }

const emit = () => listeners.forEach((l) => l())
const set = (patch) => { state = { ...state, ...patch }; emit() }

export const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
export const getState = () => state
export const useClose = () => useSyncExternalStore(subscribe, getState)

async function load(view) {
  const tables = await api('/close/studio-data')
  set({ view, tables, version: state.version + 1, error: null, notice: view.notice || null })
}

async function guard(fn) {
  set({ busy: true, error: null })
  try {
    return await fn()
  } catch (err) {
    set({ error: err.message })
    return null
  } finally {
    set({ busy: false })
  }
}

export const closeActions = {
  start: () => guard(async () => {
    const view = await api('/close/start', { method: 'POST' })
    if (view.closeId !== state.view?.closeId) set({ selectedException: null, explanations: {}, package: null })
    await load(view)
  }),
  recheck: () => guard(async () => load(await api('/close/check', { method: 'POST' }))),
  async refresh() { try { await load(await api('/close')) } catch (err) { set({ error: err.message }) } },
  propose: (exceptionId, body = {}) => guard(async () => {
    const data = await api(`/exceptions/${exceptionId}/propose`, { method: 'POST', body })
    await load(data.view)
    return data.card
  }),
  ownerLink: (actionId) => guard(async () => {
    const data = await api(`/actions/${actionId}/owner-link`, { method: 'POST' })
    await load(data.view)
    set({ ownerUrl: { actionId, url: data.url } })
    return data.url
  }),
  bookkeeperApprove: (actionId) => guard(async () => load(await api(`/actions/${actionId}/approve`, { method: 'POST' }))),
  sign: () => guard(async () => {
    const data = await api('/close/sign', { method: 'POST' })
    await load(data.view)
    set({ package: data.package })
  }),
  loadPackage: () => guard(async () => set({ package: await api('/close/package') })),
  clearOwnerUrl: () => set({ ownerUrl: null }),
  // Selecting a queue card filters the ledger and promise grids to that order. Selecting it again clears the filter.
  select: (exceptionId) => set({ selectedException: state.selectedException === exceptionId ? null : exceptionId }),
  // "Ask the Close Agent why": the server reads PayPal with the Agent Toolkit tools and traces the calls.
  askWhy: (exceptionId) => guard(async () => {
    const data = await api('/agent/ask', { method: 'POST', body: { question: 'Why is this an exception? Check PayPal.', exceptionId } })
    set({ explanations: { ...state.explanations, [exceptionId]: data } })
    await closeActions.refresh()
  }),
}
