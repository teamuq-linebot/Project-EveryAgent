import { useEffect, useState } from 'react'

/** 狀態列訊息型別（成功/錯誤；persist=true 永久顯示，不自動消失）。 */
export type StatusMessage = { text: string; ok: boolean; persist?: boolean }

/**
 * useManagementStatus — 集中管理頁底部狀態訊息 + syncBusy 旗標。
 *
 * 由 useProjectManagement 原本散落的 status/statusFading/syncBusy state 與
 * §5.4 status auto-dismiss useEffect 抽出；邏輯/數值常數一字不改。
 */
export function useManagementStatus() {
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [statusFading, setStatusFading] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)

  // §5.4 status auto-dismiss：成功訊息 4 秒後消失（3.6s 加 fading class, 4s 清 null）；
  // persist=true（AI 草稿套用提示）及錯誤訊息永久顯示。
  useEffect(() => {
    setStatusFading(false)
    if (!status?.ok || status.persist) return
    const fadeTimer = setTimeout(() => setStatusFading(true), 3600)
    const clearTimer = setTimeout(() => setStatus(null), 4000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(clearTimer)
    }
  }, [status])

  return {
    status,
    setStatus,
    statusFading,
    setStatusFading,
    syncBusy,
    setSyncBusy,
  }
}
