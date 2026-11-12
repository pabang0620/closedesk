import { studioTheme } from 'ag-studio'

// Calm Fintech: white cards on a cool canvas, one blue accent, Manrope titles. Same values as styles.css.
// AG Charts palette: accent blue, then over (coral), under (indigo), ok, held, pending, failed, muted.
const palette = (colors) => Object.fromEntries(colors.flatMap((color, i) => [[`chartPaletteFills${i + 1}Color`, color], [`chartPaletteStrokes${i + 1}Color`, color]]))
const LIGHT_INK = ['#1d4ed8', '#e0533d', '#6366f1', '#0f9d6b', '#b45309', '#6d4fd1', '#c2361f', '#5f6b85']
const DARK_INK = ['#6c8cff', '#f08a74', '#9a9cf8', '#4fd1a0', '#f5b766', '#b9a6ff', '#ff9a85', '#97a2bf']

const shared = {
  fontFamily: '"Inter", system-ui, sans-serif',
  fontSize: 13,
  studioWidgetTitleFontFamily: '"Manrope", "Inter", sans-serif',
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 14,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 700,
  studioCanvasPadding: 14,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 18,
  gridRowHeight: 32,
  headerFontWeight: 600,
}

export const closeDeskTheme = studioTheme
  .withParams({
    ...shared,
    backgroundColor: '#ffffff',
    textColor: '#121a33',
    borderColor: '#121a3314',
    headerBackgroundColor: '#ffffff',
    headerTextColor: '#5f6b85',
    rowHoverColor: '#f2f6ff',
    accentColor: '#1d4ed8',
    studioCanvasBackgroundColor: '#eef1f7',
    studioWidgetBackgroundColor: '#ffffff',
    studioWidgetBorder: [1, '#121a330d'],
    studioWidgetShadow: '0 1px 2px #0f1e4a0d, 0 4px 14px #0f1e4a0a',
    studioWidgetTitleTextColor: '#121a33',
    studioToggleButtonActiveBackgroundColor: '#1d4ed8',
    studioToggleButtonActiveBorderColor: '#1d4ed8',
    studioToggleButtonActiveColor: '#ffffff',
    ...palette(LIGHT_INK),
  }, 'light')
  .withParams({
    ...shared,
    backgroundColor: '#151c31',
    textColor: '#e8ecf7',
    borderColor: '#e8ecf714',
    headerBackgroundColor: '#151c31',
    headerTextColor: '#97a2bf',
    rowHoverColor: '#1a2442',
    accentColor: '#6c8cff',
    studioCanvasBackgroundColor: '#0a0e1b',
    studioWidgetBackgroundColor: '#151c31',
    studioWidgetBorder: [1, '#e8ecf70f'],
    studioWidgetShadow: '0 1px 2px #00000040, 0 4px 14px #00000030',
    studioWidgetTitleTextColor: '#e8ecf7',
    studioToggleButtonActiveBackgroundColor: '#6c8cff',
    studioToggleButtonActiveBorderColor: '#6c8cff',
    studioToggleButtonActiveColor: '#0a0e1b',
    ...palette(DARK_INK),
  }, 'dark')
