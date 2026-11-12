// Queue card click -> Studio filters. A selected exception puts an "order equals" filter on every grid that shows
// PayPal ledger lines or support promises, so the ledger shows just that order's payments (E2: both C-1051 lines).
// The queue widget itself is left alone, so the other cards stay visible. Selecting the same card again, or an
// exception without an order, takes the filter off. Pure: state in, new state out.
const ORDER_FIELDS = ['ledger.order', 'promises.order']
const isOrderFilter = (f) => ORDER_FIELDS.includes(f?.field?.id)
const tablesOf = (widget) => (widget?.dataMapping?.cols || []).map((c) => c?.id?.split('.')[0])

export function withOrderFilter(state, orderNo) {
  return {
    ...state,
    pages: state.pages.map((page) => {
      const widgetFilters = { ...(page.filter?.widget || {}) }
      for (const [key, widget] of Object.entries(page.widgets || {})) {
        if (widget.type !== 'grid') continue
        const tables = tablesOf(widget)
        const field = ORDER_FIELDS.find((id) => tables.includes(id.split('.')[0]))
        if (!field) continue
        const rest = (widgetFilters[key] || []).filter((f) => !isOrderFilter(f))
        widgetFilters[key] = orderNo ? [...rest, { field: { id: field }, model: { operator: 'equals', value: orderNo } }] : rest
      }
      return { ...page, filter: { ...(page.filter || {}), widget: widgetFilters } }
    }),
  }
}
