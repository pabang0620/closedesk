// Three layouts, each one a Studio page: bookkeeper, merchant, client board.
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
        dataMapping: { cols: [f('ledger.eventCode'), f('ledger.event'), f('ledger.date'), f('ledger.amount'), f('ledger.fee'), f('ledger.cartRef')] },
        format: { title: { enabled: true, text: 'PayPal ledger (Transaction Search)' } },
      },
    },
    widgetLayout: {
      meter: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 5 },
      queue: { xTrack: 0, yTrack: 5, xSpan: 12, ySpan: 37 },
      bridge: { xTrack: 12, yTrack: 5, xSpan: 12, ySpan: 21 },
      ledger: { xTrack: 12, yTrack: 26, xSpan: 12, ySpan: 16 },
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
      meter: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 5 },
      approvals: { xTrack: 0, yTrack: 5, xSpan: 12, ySpan: 21 },
      bridge: { xTrack: 12, yTrack: 5, xSpan: 12, ySpan: 21 },
      byStatus: { xTrack: 0, yTrack: 26, xSpan: 24, ySpan: 16 },
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
