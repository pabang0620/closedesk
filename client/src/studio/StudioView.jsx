import { useEffect, useMemo, useRef } from 'react'
import { AgStudio, AgStudioProvider } from 'ag-studio-react'
import { AgStudioModuleRegistry, AgStudioAiModule, enableStudioDevValidations } from 'ag-studio'
import { useClose } from '../lib/closeStore.js'
import { buildSources } from './dataSources.js'
import { widgetsConfig } from './widgets.js'
import { closeDeskTheme } from './theme.js'
import { initialState } from './layouts.js'
import { createCloseHarness } from './closeAgent.js'
import { withOrderFilter } from './crossFilter.js'

// The AG Studio trial key comes from the hackathon link. Without it Studio runs with its trial notice.
const LICENSE_KEY = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY

const PANELS = { view: { right: [] }, edit: { left: ['ai'], right: ['filters', 'edit', 'data'] } }

AgStudioModuleRegistry.registerModules([AgStudioAiModule])
if (import.meta.env.DEV) enableStudioDevValidations()

// AG Studio is the central screen: data engine, custom widgets, theme, three layouts, and the
// Close Agent chat. `layout` is the id of the selected page, `mode` is view or edit.
export default function StudioView({ layout, mode, onApi }) {
  const { tables, version, view, selectedException } = useClose()
  const apiRef = useRef(null)
  const filteredRef = useRef(false)
  const data = useMemo(() => (tables ? buildSources(tables) : null), [tables, version])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const state = api.getState()
    if (state.selectedPageId !== layout) api.setState({ ...state, selectedPageId: layout })
  }, [layout])

  // A selected queue card filters the ledger and promise grids to its order. Selecting it again clears them.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const orderNo = view?.exceptions.find((e) => e.id === selectedException)?.orderNo || null
    if (!orderNo && !filteredRef.current) return
    filteredRef.current = !!orderNo
    api.setState(withOrderFilter(api.getState(), orderNo))
  }, [selectedException, version, view])

  if (!data) return <div className="cd-empty">Preparing the daily check</div>
  const studio = (
    <AgStudio
      style={{ height: '100%', width: '100%' }}
      data={data}
      mode={mode}
      theme={closeDeskTheme}
      widgets={widgetsConfig}
      initialState={initialState}
      panels={PANELS}
      ai={({ api }) => createCloseHarness(api)}
      onApiReady={({ api }) => { apiRef.current = api; onApi?.(api) }}
    />
  )
  return LICENSE_KEY ? <AgStudioProvider licenseKey={LICENSE_KEY}>{studio}</AgStudioProvider> : studio
}
