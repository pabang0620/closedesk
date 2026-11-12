import { createWidgets } from 'ag-studio-react'
import ExceptionQueue from './ExceptionQueue.jsx'
import BridgeWidget from './BridgeWidget.jsx'
import CloseMeter from './CloseMeter.jsx'
import OwnerApprovals from './OwnerApprovals.jsx'

const AI_NOTE = 'Draws live state from CloseDesk. It needs no field mapping.'

// The four CloseDesk widgets. They are real Studio widgets: they sit in the widget menu, can be
// dragged, resized and removed in edit mode, and carry the metadata the AI agents read.
export const exceptionQueueWidget = {
  id: 'exceptionQueue',
  label: 'Exception Queue',
  dataMapping: { items: { type: 'fieldset', supportedRoles: ['category', 'numeric', 'temporal'], required: false, aiDescription: 'Exception fields. The queue shows the exceptions that pass the current filters.' } },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: 'items', label: 'Fields' }] }),
  comp: ExceptionQueue,
  defaultSize: { width: 12, height: 26 },
  minSize: { width: 8, height: 12 },
  ai: { label: 'Exception Queue', description: 'Cards for every gap between PayPal and what the seller promised, with evidence and the approval step.', usage: 'Use for the list of open exceptions. Filter it with exceptions.status or exceptions.order.', configuration: AI_NOTE },
}

export const bridgeWidget = {
  id: 'booksBridge',
  label: 'Books vs PayPal Bridge',
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  comp: BridgeWidget,
  defaultSize: { width: 12, height: 15 },
  minSize: { width: 8, height: 10 },
  ai: { label: 'Books vs PayPal Bridge', description: 'PayPal over books and under books, unexplained, carried forward and held amounts.', usage: 'Use to read the unexplained difference.', configuration: AI_NOTE },
}

export const closeMeterWidget = {
  id: 'closeMeter',
  label: 'Close Meter',
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  comp: CloseMeter,
  defaultSize: { width: 24, height: 5 },
  minSize: { width: 12, height: 4 },
  ai: { label: 'Close Meter', description: 'Orders matched, open exceptions, unexplained amount and the Sign close button.', usage: 'Use as the headline of a close.', configuration: AI_NOTE },
}

export const ownerApprovalsWidget = {
  id: 'ownerApprovals',
  label: 'Owner Approvals',
  form: (params) => params.createDefaults({ dataMappingItems: [] }),
  comp: OwnerApprovals,
  defaultSize: { width: 12, height: 14 },
  minSize: { width: 8, height: 8 },
  ai: { label: 'Owner Approvals', description: 'Money actions waiting for the shop owner, and what is already done in PayPal.', usage: 'Use on the merchant view.', configuration: AI_NOTE },
}

export const CUSTOM_WIDGET_IDS = ['exceptionQueue', 'booksBridge', 'closeMeter', 'ownerApprovals']

export const widgetsConfig = (defaults) => createWidgets({
  additionalTypes: [exceptionQueueWidget, bridgeWidget, closeMeterWidget, ownerApprovalsWidget],
  menu: [...defaults.menu, { label: 'CloseDesk', widgetIds: CUSTOM_WIDGET_IDS }],
})
