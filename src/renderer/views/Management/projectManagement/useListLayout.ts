import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useListLayout — 左欄可拖拉寬度（H2）+ source group 收合狀態（H1）。
 *
 * 由 useProjectManagement 抽出 collapsedGroups、listWidth 與 splitter 拖拉
 * （draggingRef/dragStartXRef/dragStartWidthRef/lastWidthRef + mousedown handler +
 * document mousemove/mouseup useEffect）。邏輯/數值常數（220/480/300）一字不改。
 */
export function useListLayout() {
  // ── source group 收合狀態（H1 可收合分組）──
  // key = group.key（platform_local_id / 'builtin:local' / '__remote_unknown__'）
  // 空 Set = 全展開；不需持久化。
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // ── 左欄可拖拉寬度（H2）──
  // 讀 localStorage；parse 失敗 / 超界 → 300。
  const [listWidth, setListWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('pmv-list-width')
      if (!raw) return 300
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 220 || v > 480) return 300
      return v
    } catch {
      return 300
    }
  })
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const lastWidthRef = useRef(listWidth) // 追蹤最後確定寬度，供 mouseup 寫 localStorage 用

  // splitter mousedown → 啟動拖拉（document mousemove/mouseup 清理在 useEffect 裡）
  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = listWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [listWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      const next = Math.min(480, Math.max(220, dragStartWidthRef.current + delta))
      lastWidthRef.current = next
      setListWidth(next)
    }
    const onMouseUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      // 結束時寫 localStorage（讀 lastWidthRef 取最後一次拖拉確定的寬度，
      // 避免在 setState updater 內做副作用，符合 React 純函式要求）
      try { localStorage.setItem('pmv-list-width', String(lastWidthRef.current)) } catch { /* storage 不可寫 */ }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      // cleanup：確保意外 unmount 時恢復 body style
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  return {
    collapsedGroups,
    setCollapsedGroups,
    listWidth,
    setListWidth,
    draggingRef,
    dragStartXRef,
    dragStartWidthRef,
    lastWidthRef,
    handleSplitterMouseDown,
  }
}
