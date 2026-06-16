import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  CardRunStatePayload,
  IpcResult,
  TaskDto,
  TasksFindAllResult,
} from '../../shared/ipcContracts'

export interface Task {
  id: string
  name: string
  status: string
  /**
   * 結構化欄位（Phase 5 router+useTasks：改讀本地 repo 投影的 LocalTask 欄位）。
   * 本地建立任務 milestone 顯示欄為 null。
   */
  start_date: string | null
  end_date: string | null
  milestone_id: string | null
  milestone_public_id: string | null
  milestone_name: string | null
  /** 整筆原始任務 JSON（打卡 / 補欄位用，勿用回應覆蓋）。 */
  raw: Record<string, unknown>
}

export type RunStateMap = Record<string, 'none' | 'idle' | 'running' | 'waiting' | 'error' | 'completed'>

// 「完成已讀」集合的持久化 key：跨 reload / 重啟記住使用者已看過的完成任務。
const ACK_STORAGE_KEY = 'tuq.ack.completed'

function loadAck(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr)) return new Set(arr.map(String))
    }
  } catch {
    /* localStorage 不可用 / 壞資料 → 回空集合 */
  }
  return new Set()
}

function saveAck(ack: Set<string>): void {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...ack]))
  } catch {
    /* 靜默：持久化失敗不影響當下 session 行為 */
  }
}

/** 5 active 看板欄（順序對應 Python ACTIVE_COLUMNS）*/
export const ACTIVE_COLUMNS: { label: string; status: string }[] = [
  { label: '準備中', status: 'PREPARATION' },
  { label: '待執行', status: 'WAITING' },
  { label: '進行中', status: 'IN_PROGRESS' },
  { label: '暫停', status: 'PENDING' },
  { label: '完成', status: 'COMPLETED' },
]

export const ACTIVE_STATUSES = ACTIVE_COLUMNS.map((c) => c.status)

/** 依 status 分欄；欄序固定（空欄也回）。*/
export function groupTasksByColumn(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const col of ACTIVE_COLUMNS) {
    map.set(col.status, [])
  }
  for (const t of tasks) {
    const bucket = map.get(t.status)
    if (bucket) bucket.push(t)
  }
  return map
}

/**
 * 看板任務 hook（B6 純本地：去 loggedIn / mineOnly / platformTemplates，直讀本地 SQLite）。
 */
export function useTasks(): {
  tasks: Task[]
  runStates: RunStateMap
  loading: boolean
  error: string | null
  reload: (force?: boolean) => Promise<void>
  updateStatus: (taskId: string, newStatus: string) => Promise<void>
  /**
   * 標記某任務的「完成」已讀（使用者已點進去看過）。
   * 已讀後 completed 綠點降級為中性（idle）色，直到下一輪重新完成才再亮綠。
   */
  acknowledge: (taskId: string) => void
} {
  const [tasks, setTasks] = useState<Task[]>([])
  const [runStatesRaw, setRunStatesRaw] = useState<RunStateMap>({})
  // 已讀完成集合：completed 且在此集合內 → 顯示中性色（使用者已看過）。
  // 持久化到 localStorage：reload / 重啟後仍記得「已看過」，不會又亮回綠（除非有新一輪完成）。
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => loadAck())
  // 偵測「新一輪完成」用的上一輪狀態快照（ref 不觸發 render）。
  const prevRunStatesRef = useRef<RunStateMap>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // throttle: 上次 reload 完成時間
  const lastReloadRef = useRef<number>(0)
  // 是否已成功載入過一次：背景輪詢刷新時不再閃 loading（避免 UI 一閃）。
  const loadedOnceRef = useRef<boolean>(false)

  const reload = useCallback(async (force = false) => {
    const now = Date.now()
    // 8秒節流（對應 Python 看板自動刷新規則）；force=true 繞過（F5 / 週期刷新到點）
    if (!force && now - lastReloadRef.current < 8000) return
    // loading 只給首載 / 手動 force（F5）：背景輪詢 / focus 靜默刷新不閃 loading（避免 UI 一閃）。
    if (!loadedOnceRef.current || force) setLoading(true)
    setError(null)
    try {
      const result = (await window.tuq.tasks.findAll({
        statuses: ACTIVE_STATUSES,
      })) as IpcResult<TasksFindAllResult>
      if (result.ok) {
        const rows: TaskDto[] = Array.isArray(result.data) ? result.data : []
        const mapped: Task[] = rows.map((t) => ({
          id: String(t.id ?? ''),
          name: String(t.name ?? '(未命名)'),
          status: String(t.status ?? ''),
          // Phase 5：直接讀 TaskService 投影的結構化欄位（LocalTask），不再從 raw 二次解析。
          start_date: t.start_date ?? null,
          end_date: t.end_date ?? null,
          milestone_id: t.milestone_id ?? null,
          milestone_public_id: t.milestone_public_id ?? null,
          milestone_name: t.milestone_name ?? null,
          raw: t.raw ?? {},
        }))
        setTasks(mapped)
        loadedOnceRef.current = true
        lastReloadRef.current = Date.now()
      } else {
        setError(result.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 掛載即載入。
  useEffect(() => {
    lastReloadRef.current = 0
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 訂閱 card run state push 事件
  useEffect(() => {
    const cleanup = window.tuq.onCardRunState((payload: CardRunStatePayload) => {
      setRunStatesRaw((prev) => ({ ...prev, [payload.taskId]: payload.state }))
    })
    return cleanup
  }, [])

  // 偵測「新一輪工作開始」：任務由 completed → 非 completed（running / waiting…）時，
  // 從已讀集合移除，讓下一次完成能重新亮綠。
  //
  // 為何用「離開 completed」而非「進入 completed」來清已讀？
  //   reload / 重啟後 prevRunStatesRef 從空白起步，後端會重推狀態（常見 idle→completed 或
  //   running→completed）。若用「進入 completed」判斷,重推的最後一步會被誤判成新完成、
  //   把持久化的已讀清掉 → 綠點又亮回來（使用者回報的 bug）。
  //   「離開 completed」只在真的有新一輪 live 工作（completed→running）時才成立，重推序列
  //   不會出現此轉換（重推時 prev 為 undefined，不是 'completed'），故 reload 不會誤清。
  useEffect(() => {
    const prev = prevRunStatesRef.current
    setAcknowledged((ack) => {
      let next = ack
      for (const [taskId, state] of Object.entries(runStatesRaw)) {
        const leftCompleted = prev[taskId] === 'completed' && state !== 'completed'
        if (leftCompleted && next.has(taskId)) {
          if (next === ack) next = new Set(ack)
          next.delete(taskId)
        }
      }
      return next
    })
    prevRunStatesRef.current = runStatesRaw
  }, [runStatesRaw])

  // 已讀集合變動即持久化（reload / 重啟後沿用，符合「不會再變回綠，除非新完成」）。
  useEffect(() => {
    saveAck(acknowledged)
  }, [acknowledged])

  // 對外 runStates：completed 且已讀 → 降級為中性（idle）色；其餘原樣透出。
  const runStates = useMemo<RunStateMap>(() => {
    const out: RunStateMap = {}
    for (const [taskId, state] of Object.entries(runStatesRaw)) {
      out[taskId] = state === 'completed' && acknowledged.has(taskId) ? 'idle' : state
    }
    return out
  }, [runStatesRaw, acknowledged])

  // 標記某任務完成已讀（使用者點進去看過）。
  const acknowledge = useCallback((taskId: string) => {
    setAcknowledged((ack) => {
      if (ack.has(taskId)) return ack
      const next = new Set(ack)
      next.add(taskId)
      return next
    })
  }, [])

  const updateStatus = useCallback(
    async (taskId: string, newStatus: string) => {
      // 樂觀更新
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      )
      try {
        const result = await window.tuq.tasks.update({ taskId, status: newStatus })
        if (!result.ok) {
          // 失敗回滾：重新載入（重置節流）
          lastReloadRef.current = 0
          await reload()
        }
      } catch {
        lastReloadRef.current = 0
        await reload()
      }
    },
    [reload]
  )

  return { tasks, runStates, loading, error, reload, updateStatus, acknowledge }
}
