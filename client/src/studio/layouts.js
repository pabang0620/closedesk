// Three layouts, each one a Studio page: bookkeeper, merchant, client board.
// The Close Meter is a left rail (Unexplained first, Sign close at its foot) on both close pages.
const f = (id, aggregation) => ({ id, ...(aggregation ? { aggregation } : {}) })

export const PAGES = [
  {
    id: 'bookkeeper',
    widgets: {
      meter: { type: 'closeMeter', dataMapping: {} },
      queue: { type: 'exceptionQueue', dataMapping: { items: [f('exceptions.id'), f('exceptions.status')] }, format: { title: { enabled: true, text: 'Exception queue' } } },
      bridge: { type: 'booksBridge', dataMapping: {}, format: { title: { enabled: true, text: 'Books vs PayPal' } } },
      ledger: {
        type: 'grid',
        dataMapping: { cols: [f('ledger.event'), f('ledger.amount'), f('ledger.fee'), f('ledger.cartRef')] },
        format: { title: { enabled: true, text: 'PayPal ledger (Transaction Search)' } },
      },
    },
    widgetLayout: {
      meter: { xTrack: 0, yTrack: 0, xSpan: 5, ySpan: 42 },
      queue: { xTrack: 5, yTrack: 0, xSpan: 10, ySpan: 42 },
      bridge: { xTrack: 15, yTrack: 0, xSpan: 9, ySpan: 22 },
      ledger: { xTrack: 15, yTrack: 22, xSpan: 9, ySpan: 20 },
    },
  },
  {
    id: 'merchant',
    widgets: {
      meter: { type: 'closeMeter', dataMapping: {} },
      approvals: { type: 'ownerApprovals', dataMapping: {}, format: { title: { enabled: true, text: 'Waiting for you' } } },
      bridge: { type: 'booksBridge', dataMapping: {}, format: { title: { enabled: true, text: 'Books vs PayPal' } } },
      byStatus: {
        type: 'column-chart-stacked',
        dataMapping: { categoryKey: [f('exceptions.title')], valueKey: [f('exceptions.amount', 'sum')], legendKey: [f('exceptions.status')] },
        format: { title: { enabled: true, text: 'Money at stake by type' } },
      },
    },
    widgetLayout: {
      meter: { xTrack: 0, yTrack: 0, xSpan: 5, ySpan: 42 },
      approvals: { xTrack: 5, yTrack: 0, xSpan: 10, ySpan: 22 },
      bridge: { xTrack: 15, yTrack: 0, xSpan: 9, ySpan: 22 },
      byStatus: { xTrack: 5, yTrack: 22, xSpan: 19, ySpan: 20 },
    },
  },
  {
    id: 'clients',
    widgets: {
      board: {
        type: 'grid',
        dataMapping: { cols: [f('clients.client'), f('clients.stage'), f('clients.unexplained')] },
        format: { title: { enabled: true, text: 'Month-end close board' } },
      },
      promises: {
        type: 'grid',
        dataMapping: { cols: [f('promises.order'), f('promises.type'), f('promises.ageDays'), f('promises.quote')] },
        format: { title: { enabled: true, text: 'Promises the shop made' } },
      },
    },
    widgetLayout: {
      board: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 16 },
      promises: { xTrack: 0, yTrack: 16, xSpan: 24, ySpan: 18 },
    },
  },
]

export const LAYOUTS = [
  { id: 'bookkeeper', label: 'Bookkeeper view' },
  { id: 'merchant', label: 'Merchant view' },
  { id: 'clients', label: 'Client board' },
]

export const initialState = { pages: PAGES, selectedPageId: 'bookkeeper' }
