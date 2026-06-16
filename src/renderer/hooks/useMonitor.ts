import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  MonitorRenderPayload,
  MonitorStatusPayload,
  PunchRow,
  BindSessionItem,
} from '../../shared/ipcContracts'

export interface MonitorState {
  rows: PunchRow[]
  canPunch: boolean
  statusText: string
  active: boolean
}

/**
 * useMonitor — 訂閱 onMonitorRender / onMonitorStatus + 封裝 start/stop。
 *
 * 只訂閱屬於本 sessionId 的推播（payload.sessionId 比對過濾）。
 * start/stop 僅供外部觸發；本 hook 不自動啟動。
 */
export function useMonitor(sessionId: string): {
  state: MonitorState
  start: (taskId: string, projectPath: string, milestoneId?: string | null) => Promise<void>
  stop: () => Promise<void>
  listSessions: () => Promise<BindSessionItem[]>
  rebind: (
    claudeSessionId: string | null,
  ) => Promise<{ claudeSessionId: string | null; launchCommand: string | null } | null>
  rename: (customTitle: string) => Promise<boolean>
} {
  const [state, setState] = useState<MonitorState>({
    rows: [],
    canPunch: false,
    statusText: '',
    active: false,
  })

  // 防止 unmounted 後 setState
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 訂閱 monitor:render
  useEffect(() => {
    const unsub = window.tuq.onMonitorRender((payload: MonitorRenderPayload) => {
      if (payload.sessionId !== sessionId) return
      if (!mountedRef.current) return
      setState((prev) => ({
        ...prev,
        rows: payload.rows,
        canPunch: payload.canPunch,
      }))
    })
    return unsub
  }, [sessionId])

  // 訂閱 monitor:status
  useEffect(() => {
    const unsub = window.tuq.onMonitorStatus((payload: MonitorStatusPayload) => {
      if (payload.sessionId !== sessionId) return
      if (!mountedRef.current) return
      setState((prev) => ({ ...prev, statusText: payload.text }))
    })
    return unsub
  }, [sessionId])

  const start = useCallback(
    async (taskId: string, projectPath: string, milestoneId?: string | null) => {
      try {
        await window.tuq.monitor.start({ sessionId, taskId, projectPath, milestoneId })
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, active: true }))
        }
      } catch {
        // 靜默失敗，statusText 由 onMonitorStatus 更新
      }
    },
    [sessionId],
  )

  const stop = useCallback(async () => {
    try {
      await window.tuq.monitor.stop(sessionId)
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, active: false }))
      }
    } catch {
      // 靜默
    }
  }, [sessionId])

  // 列出此專案所有 claude session（綁定下拉用）。
  const listSessions = useCallback(async (): Promise<BindSessionItem[]> => {
    try {
      const r = await window.tuq.session.listSessions(sessionId)
      return r.ok && r.data ? r.data : []
    } catch {
      return []
    }
  }, [sessionId])

  // 換綁監測對象（null = 新開 session）。成功後 render 會經 onMonitorRender 推回。
  // 回新的 claudeSessionId + launchCommand（供終端用正確指令啟動，而非 stale 舊指令）。
  const rebind = useCallback(
    async (
      claudeSessionId: string | null,
    ): Promise<{ claudeSessionId: string | null; launchCommand: string | null } | null> => {
      try {
        const r = await window.tuq.monitor.rebind(sessionId, claudeSessionId)
        return r.ok && r.data && r.data.ok
          ? { claudeSessionId: r.data.claudeSessionId, launchCommand: r.data.launchCommand }
          : null
      } catch {
        return null
      }
    },
    [sessionId],
  )

  // session 改名（寫 custom-title 到 claude JSONL）。回成功與否。
  const rename = useCallback(
    async (customTitle: string): Promise<boolean> => {
      try {
        const r = await window.tuq.session.rename(sessionId, customTitle)
        return r.ok && r.data ? r.data.ok : false
      } catch {
        return false
      }
    },
    [sessionId],
  )

  return { state, start, stop, listSessions, rebind, rename }
}
