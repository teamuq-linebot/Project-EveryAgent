import { useState, useCallback } from 'react'
import type { SessionInfo } from '../../shared/ipcContracts'

export interface OpenSession extends SessionInfo {
  taskId: string
  taskName: string
}

/**
 * openSession 額外開啟參數（plan §12 U6：管理 session 以固定 projectPath = ~/.teamuq 開啟）。
 * 監測任務頁不需傳（沿用 milestone / task_sessions 解析路徑）；管理 session 顯式傳 projectPath。
 */
export interface OpenSessionOpts {
  /** PTY 工作目錄；管理 session 傳 ~/.teamuq。省略時後端依 milestone / task_sessions 解析。 */
  projectPath?: string
  /** 工具提示（claude / codex …）。 */
  tool?: string
  /** 顯式自訂啟動指令。 */
  customCommand?: string | null
  /** 強制開全新 session（不沿用 active / 不 resume 同資料夾最新）；「開始團隊對話」用。 */
  forceNewSession?: boolean
}

export function useSession(): {
  sessions: OpenSession[]
  /** 開啟（或取既有）session，回其 sessionId 供呼叫端立即切 tab；失敗回 null。 */
  openSession: (
    taskId: string,
    taskName: string,
    milestoneId?: string | null,
    opts?: OpenSessionOpts,
  ) => Promise<string | null>
  closeSession: (sessionId: string) => void
  /**
   * App 啟動恢復：把 main 端「實際存在」的所有 session（含 headless recoverMonitoring
   * 恢復的）併入 renderer 的 sessions → 自動開對應 tab、進左邊監測列表。
   * 使「看板 card 閃 / 監測列表 / backend 監測集合」三者一致（每個監測中 session 都有 tab）。
   * 冪等：已在 sessions 內的 taskId 不重複加（SessionTab mount 的 start 由 backend 守門不重掃）。
   * resolveTaskName：以 taskId 取顯示名（join 看板 tasks）；查不到退回 taskId。
   */
  hydrateFromActive: (resolveTaskName: (taskId: string) => string | undefined) => Promise<void>
  /**
   * 回填保險：tasks 載入後呼叫，把 taskName 仍等於 taskId 的 session 補上正確名稱。
   * App.tsx 在 tasks 首次有值時觸發一次。
   */
  refillTaskNames: (resolveTaskName: (taskId: string) => string | undefined) => void
} {
  const [sessions, setSessions] = useState<OpenSession[]>([])

  const openSession = useCallback(
    async (
      taskId: string,
      taskName: string,
      milestoneId?: string | null,
      opts?: OpenSessionOpts,
    ): Promise<string | null> => {
      // 已有同 taskId 的 session → 不重開，回既有 id（呼叫端切過去）
      const existing = sessions.find((s) => s.taskId === taskId)
      if (existing) return existing.sessionId

      try {
        const result = await window.tuq.session.open({
          taskId,
          milestoneId: milestoneId ?? null,
          projectPath: opts?.projectPath,
          tool: opts?.tool,
          customCommand: opts?.customCommand ?? null,
          forceNewSession: opts?.forceNewSession,
        })
        if (result.ok && result.data) {
          const info = result.data
          // spread 整個 SessionInfo（含 tool / launchCommand / claudeSessionId）+ taskName
          setSessions((prev) => [...prev, { ...info, taskName }])
          return info.sessionId
        }
      } catch {
        // session open 失敗：靜默（不崩）
      }
      return null
    },
    [sessions],
  )

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId))
    window.tuq.session.close(sessionId).catch(() => {/* ignore */})
  }, [])

  const hydrateFromActive = useCallback(
    async (resolveTaskName: (taskId: string) => string | undefined): Promise<void> => {
      // dev 熱更時 preload 可能還是舊版，缺 API 就跳過（重啟 app 後恢復）。
      if (typeof window.tuq?.session?.listActive !== 'function') return
      try {
        const result = await window.tuq.session.listActive()
        if (!result.ok || !result.data || result.data.length === 0) return
        const active = result.data
        setSessions((prev) => {
          // 以 taskId 去重：已在 sessions 內者保留既有（不覆蓋 taskName / 既有 tab）。
          const haveTaskIds = new Set(prev.map((s) => s.taskId))
          const additions: OpenSession[] = []
          for (const info of active) {
            if (haveTaskIds.has(info.taskId)) continue
            haveTaskIds.add(info.taskId)
            // 優先使用 backend 帶來的 taskName（已在 repo 查好）；
            // 若看板 tasks 恰好已載入可進一步補更好的名稱；fallback 才是 taskId。
            const resolved = resolveTaskName(info.taskId)
            const name =
              resolved ||
              (info.taskName && info.taskName !== info.taskId ? info.taskName : null) ||
              info.taskId
            additions.push({ ...info, taskName: name })
          }
          return additions.length > 0 ? [...prev, ...additions] : prev
        })
      } catch {
        // hydrate 失敗：靜默（不崩）；backend 仍在 headless 監測，只是這次沒補開 tab。
      }
    },
    [],
  )

  /**
   * 回填保險：tasks 載入後，把 sessions 中 taskName 仍等於 taskId（數字/純 ID）的項目
   * 用最新 tasks 補上正確名稱。export 供 App.tsx 在 tasks 變化時觸發。
   */
  const refillTaskNames = useCallback(
    (resolveTaskName: (taskId: string) => string | undefined): void => {
      setSessions((prev) => {
        let changed = false
        const next = prev.map((s) => {
          if (s.taskName !== s.taskId) return s // 已有正確名稱
          const resolved = resolveTaskName(s.taskId)
          if (!resolved || resolved === s.taskId) return s
          changed = true
          return { ...s, taskName: resolved }
        })
        return changed ? next : prev
      })
    },
    [],
  )

  return { sessions, openSession, closeSession, hydrateFromActive, refillTaskNames }
}
