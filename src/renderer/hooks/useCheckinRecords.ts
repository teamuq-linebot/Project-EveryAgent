import { useState, useEffect, useRef, useCallback } from 'react'
import type { PunchRow } from '../../shared/ipcContracts'

/**
 * 將 DB 原始列（status='open'/'done'，無 show_end）正規化為 PunchTable 期望的顯示形狀。
 * 語意鏡像 src/main/monitor/types.ts makePunchRow：
 *   - show_end: ended_at != null && status === 'done'（已完成才顯結束時間欄）
 *   - status 本地化：'open' → '執行中'，'done' → '已打卡'，其餘原值保留
 * ipcContracts.PunchRow 的其餘欄（type/description/subtask_id/error）DB 列已含，直接傳遞。
 */
function normalizeDbRow(raw: Record<string, unknown>): PunchRow {
  const ended = raw.ended_at as string | null | undefined
  const rawStatus = String(raw.status ?? '')
  const showEnd = ended != null && ended !== '' && rawStatus === 'done'
  // ok 欄為 NULL（進行中）時不視為失敗；僅 Number(ok) === 0 才映「錯誤」，
  // 對應 MonitorController.ts:779（ok===0→'錯誤'）與 punchLedger.ts:362,367（punchOut 失敗 status='done'+ok=0）。
  const okIsFailure = raw.ok !== null && raw.ok !== undefined && Number(raw.ok) === 0
  const status =
    rawStatus === 'done' && okIsFailure
      ? '錯誤'
      : rawStatus === 'stale'
        ? '已中斷'
        : rawStatus === 'open'
          ? '執行中'
          : rawStatus === 'done'
            ? '已打卡'
            : rawStatus

  return {
    name: String(raw.name ?? ''),
    started_at: raw.started_at,
    ended_at: raw.ended_at,
    hours: Number(raw.hours ?? 0),
    status,
    show_end: showEnd,
    type: String(raw.type ?? ''),
    cli: (raw.cli as string | null | undefined) ?? null,
    description: String(raw.description ?? ''),
    subtask_id: String(raw.subtask_id ?? ''),
    error: String(raw.error ?? ''),
    punch_uid: (raw.punch_uid as string | null | undefined) ?? null,
    session_id: (raw.session_id as string | null | undefined) ?? null,
    subtask_name: (raw.subtask_name as string | null | undefined) ?? null,
    subtask_description: (raw.subtask_description as string | null | undefined) ?? null,
    subtask_start_time: (raw.subtask_start_time as string | null | undefined) ?? null,
    subtask_end_time: (raw.subtask_end_time as string | null | undefined) ?? null,
    subtask_duration: raw.subtask_duration != null ? Number(raw.subtask_duration) : null,
    subtask_is_settled: raw.subtask_is_settled != null ? Number(raw.subtask_is_settled) : null,
  }
}

/**
 * useCheckinRecords — 從 DB 讀取打卡紀錄（punches:listForTask）。
 *
 * - mount 時呼叫一次 listForTask。
 * - monitorSignature 變動時（monitor 推播觸發）自動重新 fetch DB 列表。
 *   Signature = rows.map(r=>r.started_at+'|'+r.status+'|'+r.ended_at).join(',')，
 *   可捕捉「列內容變動（subtask 回填 / hours 累進 / 轉錯誤）」與「net-zero 變動」，
 *   而非僅 rows.length。
 * - 處理 IpcResult ok/error；unmount 後不 setState。
 * - 回傳 DB 列已正規化為 PunchTable 期望形狀（show_end / 本地化 status），
 *   語意對齊 makePunchRow（monitor/types.ts:29-37）。
 */
export function useCheckinRecords(
  taskId: string,
  /** 外部傳入 monitor 推播 rows 的內容指紋；變動時觸發重整（含內容變動與 net-zero 情境） */
  monitorSignature: string,
): {
  records: PunchRow[]
  loading: boolean
  error: string | null
  /** 手動重新讀取。 */
  reload: () => void
} {
  const [records, setRecords] = useState<PunchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  // 手動重整 nonce：bump 後觸發重新 fetch（與 monitorSignature 並列為 effect dep）。
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!taskId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    window.tuq.punches
      .listForTask(taskId)
      .then((result) => {
        if (cancelled || !mountedRef.current) return
        if (result.ok) {
          const raw = (result.data ?? []) as Record<string, unknown>[]
          setRecords(raw.map(normalizeDbRow))
        } else {
          setError(result.error)
          setRecords([])
        }
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return
        setError(String(err))
        setRecords([])
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // monitorSignature 變動（monitor 推播）或 reloadNonce bump 時重新 fetch
  }, [taskId, monitorSignature, reloadNonce])

  return { records, loading, error, reload }
}
