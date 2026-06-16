import { useState, useEffect, useCallback } from 'react'
import type { ThemeMode } from '../theme'

const STORAGE_KEY = 'tuq.theme'

/** 初始模式：localStorage 已存 → 用之；否則跟隨系統 prefers-color-scheme；再退回 light。 */
function initialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* localStorage 不可用 → 忽略 */
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch {
    /* matchMedia 不可用 → 忽略 */
  }
  return 'light'
}

/**
 * useTheme — light/dark 模式狀態。
 * 把模式寫到 <html data-theme>（global.css 依此覆寫 CSS 變數）並持久化到 localStorage。
 * Terminal(xterm) 不吃 CSS 變數，改由各自監看 data-theme 屬性（見 TerminalPanel）。
 */
export function useTheme(): {
  theme: ThemeMode
  toggle: () => void
  setTheme: (m: ThemeMode) => void
} {
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* 忽略寫入失敗 */
    }
  }, [theme])

  const setTheme = useCallback((m: ThemeMode) => setThemeState(m), [])
  const toggle = useCallback(
    () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  )

  return { theme, toggle, setTheme }
}
