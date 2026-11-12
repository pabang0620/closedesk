import { studioTheme } from 'ag-studio'

// A ledger-paper theme: tabular figures, green ink on warm paper, with a dark mode.
// AG Charts palette in the ledger colours: green ink first, then brass, brick, slate, plum. Used by every chart widget.
const palette = (colors) => Object.fromEntries(colors.flatMap((color, i) => [[`chartPaletteFills${i + 1}Color`, color], [`chartPaletteStrokes${i + 1}Color`, color]]))
const LIGHT_INK = ['#1f5f4a', '#b98a2e', '#a8472f', '#4a6572', '#7b4a6b', '#5d8a3a', '#c9a96a', '#2f7f8f']
const DARK_INK = ['#6fcaa5', '#e0b85c', '#e0836a', '#8fb2c4', '#c58bb4', '#9ccc7a', '#e6cd96', '#6fc0cf']

const shared = {
  fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  fontSize: 13,
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 6,
  studioWidgetTitleFontSize: 16,
  studioWidgetTitleFontWeight: 600,
  gridRowHeight: 34,
}

export const closeDeskTheme = studioTheme
  .withParams({
    ...shared,
    backgroundColor: '#fffdf8',
    textColor: '#1d2a24',
    borderColor: '#1d2a2433',
    studioCanvasBackgroundColor: '#f4efe4',
    studioWidgetBackgroundColor: '#fffdf8',
    studioWidgetTitleTextColor: '#1f5f4a',
    studioToggleButtonActiveBackgroundColor: '#1f5f4a',
    studioToggleButtonActiveBorderColor: '#1f5f4a',
    studioToggleButtonActiveColor: '#ffffff',
    ...palette(LIGHT_INK),
  }, 'light')
  .withParams({
    ...shared,
    backgroundColor: '#16201c',
    textColor: '#e7efe9',
    borderColor: '#e7efe930',
    studioCanvasBackgroundColor: '#0f1714',
    studioWidgetBackgroundColor: '#1b2823',
    studioWidgetTitleTextColor: '#8fd3b6',
    studioToggleButtonActiveBackgroundColor: '#3a9a76',
    studioToggleButtonActiveBorderColor: '#3a9a76',
    studioToggleButtonActiveColor: '#ffffff',
    ...palette(DARK_INK),
  }, 'dark')
