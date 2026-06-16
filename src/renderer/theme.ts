/**
 * tuq.tw design tokens
 * All colours and typography defined here — no hex values elsewhere in UI code.
 * CSS variables are declared in global.css; this module mirrors them as TS constants
 * for use in xterm.js (which cannot consume CSS vars).
 */

// Brand
export const ACCENT = '#51aee5'
export const ACCENT_HOVER = '#3a9fd9'
export const ACCENT_TINT = '#eaf6fc'

// Text
export const TEXT_PRIMARY = '#171717'
export const TEXT_SECONDARY = '#737373'
export const TEXT_MUTED = '#a0a0a0'

// Borders
export const BORDER = '#e5e5e5'
export const BORDER_STRONG = '#d4d4d4'

// Surfaces
export const SURFACE = '#ffffff'
export const SURFACE_SUNKEN = '#f8fafc'
export const SURFACE_MUTED = '#f1f5f9'

// Semantic
export const SUCCESS = '#06c755'
export const ERROR = '#fb2c36'
export const WARNING = '#fbbf24'

// Typography
export const FONT_UI = 'system-ui, -apple-system, "Segoe UI", sans-serif'
export const FONT_MONO = '"Cascadia Code", "Consolas", monospace'

// ---------------------------------------------------------------------------
// xterm.js theme object (uses design tokens; xterm 無法吃 CSS 變數，故給具體值)
// ---------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark'

const XTERM_LIGHT = {
  background: SURFACE,
  foreground: TEXT_PRIMARY,
  cursor: ACCENT,
  cursorAccent: SURFACE,
  selectionBackground: ACCENT_TINT,
  selectionForeground: TEXT_PRIMARY,
  black: '#000000',
  red: ERROR,
  green: SUCCESS,
  yellow: WARNING,
  blue: ACCENT,
  magenta: '#8b5cf6',
  cyan: '#06b6d4',
  white: '#e5e5e5',
  brightBlack: TEXT_SECONDARY,
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#f59e0b',
  brightBlue: ACCENT_HOVER,
  brightMagenta: '#a78bfa',
  brightCyan: '#22d3ee',
  brightWhite: TEXT_PRIMARY,
}

const XTERM_DARK = {
  background: '#151619', // --surface-sunken (dark)：終端用更沉的底
  foreground: '#e7e8ea',
  cursor: ACCENT,
  cursorAccent: '#151619',
  selectionBackground: '#2a4a5a',
  selectionForeground: '#e7e8ea',
  black: '#2c2f34',
  red: '#ff5a63',
  green: '#22c55e',
  yellow: WARNING,
  blue: ACCENT,
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#c7c9cc',
  brightBlack: '#6b7280',
  brightRed: '#ff7b82',
  brightGreen: '#4ade80',
  brightYellow: '#fcd34d',
  brightBlue: '#6cc0ec',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#f4f5f6',
}

/** 依模式回傳對應 xterm 主題物件（給 term.options.theme 用）。 */
export function getXtermTheme(mode: ThemeMode): typeof XTERM_LIGHT {
  return mode === 'dark' ? XTERM_DARK : XTERM_LIGHT
}

/** 預設（light）；保留具名匯出供既有引用相容。 */
export const XTERM_THEME = XTERM_LIGHT
