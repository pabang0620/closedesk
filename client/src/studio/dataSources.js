// Studio data sources built from the server tables. Field ids are tableId.fieldId.
const text = (id, name) => ({ id, name, format: 'textFormat' })
const money = (id, name) => ({ id, name, format: 'currencyFormat', formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) } })
const when = (id, name) => ({ id, name, format: 'dateTimeFormat' })

const asDate = (value) => (value ? new Date(value) : null)

export function buildSources(tables) {
  return {
    sources: [
      {
        id: 'exceptions', name: 'Exceptions', primaryKeyField: 'id',
        data: tables.exceptions,
        fields: [text('id', 'Exception'), text('order', 'Order'), text('title', 'Type'), text('direction', 'Direction'), money('amount', 'Amount'), text('status', 'Status'), text('approver', 'Approver'), text('action', 'Proposed action'), text('narrative', 'Why'), text('quote', 'Support quote')],
      },
      {
        id: 'ledger', name: 'PayPal ledger', primaryKeyField: 'id',
        data: tables.ledger.map((l) => ({ ...l, date: asDate(l.date), order: (l.cartRef || '').replace('C-', '') })),
        fields: [text('id', 'Transaction'), text('eventCode', 'Event code'), text('event', 'Event'), when('date', 'Date'), money('amount', 'Amount'), money('fee', 'Fee'), text('cartRef', 'Cart ref'), text('order', 'Order'), text('kind', 'Kind'), text('source', 'Source')],
      },
      {
        id: 'promises', name: 'Support promises', primaryKeyField: 'id',
        data: tables.promises.map((p) => ({ ...p, madeAt: asDate(p.madeAt) })),
        fields: [text('id', 'Promise'), text('order', 'Order'), text('type', 'Type'), { id: 'claimsDone', name: 'Said it was done', format: 'booleanFormat' }, when('madeAt', 'Made at'), { id: 'ageDays', name: 'Age (days)', format: 'decimalFormat' }, text('quote', 'Quote')],
      },
      {
        id: 'orders', name: 'Books orders', primaryKeyField: 'order',
        data: tables.orders,
        fields: [text('order', 'Order'), text('customer', 'Customer'), text('item', 'Item'), money('total', 'Books total'), text('status', 'Status'), text('channel', 'Channel'), text('exception', 'Exception')],
      },
      {
        id: 'clients', name: 'Clients', primaryKeyField: 'client',
        data: tables.clients,
        fields: [text('client', 'Client'), text('stage', 'Close stage'), money('unexplained', 'Unexplained')],
      },
    ],
    relationships: [
      { id: 'exceptionOrder', type: 'many-to-many', acceptFanout: true, source: 'exceptions.order', target: 'ledger.order' },
    ],
  }
}
