import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  ConversationMessage,
  ConversationWindowResult,
  IpcResult,
  SegmentInfo,
  SegmentListResult,
} from '../../shared/ipcContracts'

/** 內容簽名：長度 + 最後一則的區塊數 + 最後區塊文字長。夠便宜也夠靈敏（append-only）。 */
function sigOf(data: ConversationMessage[]): string {
  const last = data[data.length - 1]
  const lastBlock = last?.blocks[last.blocks.length - 1]
  return `${data.length}:${last?.blocks.length ?? 0}:${lastBlock?.text.length ?? 0}`
}

/** 段列表簽名：段數 + 最後一段的 msg_count + end_seq（append-only，僅尾段會長）。 */
function segSigOf(segs: SegmentInfo[]): string {
  const last = segs[segs.length - 1]
  return `${segs.length}:${last?.msg_count ?? 0}:${last?.end_seq ?? 0}`
}

/** 某段的載入/快取狀態（給 UI 顯示載入中／重試）。 */
export type SegmentLoadState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'loaded' }

/** useConversation 對外介面（新資料層）。 */
export interface ConversationData {
  /** 換綁後資料重置中（switching=true 時 UI 顯示「重新整理中…」）。 */
  switching: boolean
  /** 段落骨架（索引，不含訊息本體）；append-only。 */
  segments: SegmentInfo[]
  /** 目前訊息總筆數（next_seq）。 */
  totalCount: number
  /**
   * 取記憶體中 [startSeq,endSeq]（含端點）已載入的訊息。
   * 回傳是否「整段齊全」(complete) 以及已有的訊息陣列。
   * complete=false 表示窗口未涵蓋整段 → UI 應呼叫 fetchSegment 補。
   */
  getMessagesFor: (startSeq: number, endSeq: number) => { complete: boolean; messages: ConversationMessage[] }
  /** 展開某段時撈整段（DB 直查）並併入 bySeq；回傳該段載入狀態。 */
  fetchSegment: (startSeq: number, endSeq: number) => void
  /** 取某段目前的載入狀態（key = startSeq）。 */
  segmentStateOf: (startSeq: number) => SegmentLoadState
  loading: boolean
  refresh: () => Promise<void>
  /** stale-preload 退回舊路徑時用：尾端 300 則的舊式平鋪訊息（新路徑下為空陣列）。 */
  legacyMessages: ConversationMessage[]
  /** 是否走舊路徑（新 API 未掛載 → true，UI 應用 buildSegments 平鋪 legacyMessages）。 */
  legacy: boolean
  /**
   * 向後相容：依 seq 排序的平鋪訊息（新路徑= bySeq 池；舊路徑= legacyMessages）。
   * 供仍以 props 傳 messages 的呼叫端（SessionTab）相容用；新 UI 路徑不依賴此欄。
   */
  messages: ConversationMessage[]
}

export interface ConversationDataApi {
  getWindow?: () => Promise<IpcResult<ConversationWindowResult>>
  getSegments?: () => Promise<IpcResult<SegmentListResult>>
  getSegmentMessages?: (
    startSeq: number,
    endSeq: number,
  ) => Promise<IpcResult<{ ok: boolean; messages: ConversationMessage[] }>>
  getLegacy?: () => Promise<IpcResult<ConversationMessage[]>>
}

/**
 * useConversation — 段落索引 UI 的資料層。
 *
 * 設計：
 *  - **段骨架常駐**：輪詢 getSegments 拿全段索引（不含訊息本體）。
 *  - **只增不減合併**：維護 bySeq Map<seq, msg>。輪詢 getConversationWindow 回來的
 *    [startSeq,...] 逐筆 set；展開段 fetchSegment 抓回的整段也 set 進同一個 map。
 *    **絕不整批覆蓋** —— 水位（ui_read_seq）推進後，後續輪詢窗口會縮回尾端 300，
 *    直接覆蓋會弄丟先前載入的更早訊息。append-only 且不可變，依 seq 合併安全。
 *  - **重渲染控制**：沿用簽名比對精神（totalCount + map size + 尾段內容變了才 setState），
 *    避免 3 秒輪詢打斷捲動與展開狀態。
 *
 * stale-preload 退回：新 API（getConversationWindow/getSegments）`typeof !== 'function'`
 * → 整體退回舊路徑（getConversation 拿尾端 300，UI 用 buildSegments 前端推段）。
 */
export function useConversationData(
  sourceKey: string,
  api: ConversationDataApi,
  epoch = 0,
): ConversationData {
  // ── 新路徑 state ──────────────────────────────────────────
  // bySeq：只增不減合併的訊息池（key = 全域 seq）。
  const bySeqRef = useRef<Map<number, ConversationMessage>>(new Map())
  // 已載入的最早 seq（追蹤；目前供除錯/未來窗口判斷用）。
  const minLoadedSeqRef = useRef<number>(Number.POSITIVE_INFINITY)
  const [segments, setSegments] = useState<SegmentInfo[]>([])
  const [totalCount, setTotalCount] = useState(0)
  // bySeq 內容版本號：併入新訊息後 +1，觸發消費端重渲染（map 物件身分不變）。
  const [poolVersion, setPoolVersion] = useState(0)
  // 每段載入狀態（key = startSeq）。用 ref 存實值 + state 版本號觸發渲染。
  const segStatesRef = useRef<Map<number, SegmentLoadState>>(new Map())
  const [segStateVersion, setSegStateVersion] = useState(0)

  // ── 舊路徑 state（stale-preload 退回）──────────────────────
  const [legacyMessages, setLegacyMessages] = useState<ConversationMessage[]>([])
  const legacySigRef = useRef('')

  const [loading, setLoading] = useState(false)
  // 換綁轉場中（true = 已重置，首批回包前顯示「重新整理中…」）
  const [switching, setSwitching] = useState(false)
  // epoch ref：每次換綁遞增，async 回包比對以丟棄過期結果
  const epochRef = useRef(epoch)

  // 簽名 ref（避免無謂 setState）
  const winSigRef = useRef('')
  const segSigRef = useRef('')

  // 新 API 是否可用（stale-preload 防護）；用 ref 讓 refresh 不需依賴重建。
  const legacyRef = useRef(
    typeof api.getWindow !== 'function' ||
      typeof api.getSegments !== 'function',
  )
  const [legacy] = useState(legacyRef.current)

  // 防止 unmounted 後 setState
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 換綁全量重置：sourceKey 或 epoch 變動時清空所有池與簽名，進入 switching 狀態。
  useEffect(() => {
    epochRef.current = epoch
    bySeqRef.current = new Map()
    minLoadedSeqRef.current = Number.POSITIVE_INFINITY
    segStatesRef.current = new Map()
    winSigRef.current = ''
    segSigRef.current = ''
    legacySigRef.current = ''
    if (mountedRef.current) {
      setSegments([])
      setTotalCount(0)
      setPoolVersion(0)
      setSegStateVersion(0)
      setLegacyMessages([])
      setSwitching(true)
    }
    // switching 會在首批回包後由 refreshNew/refreshLegacy 關閉（見下方兩個 refresh）
  }, [sourceKey, epoch])

  /**
   * 把一批「從 baseSeq 起連續」的訊息只增不減併入 bySeq；回傳是否有實際變動。
   *
   * ConversationMessage 不含 seq 欄位，但 window 與 segment 兩條 DB 查詢均
   * `ORDER BY seq ASC` 回傳連續區間 → 第 i 筆的全域 seq = baseSeq + i。
   */
  const mergeIntoPool = useCallback((msgs: ConversationMessage[], baseSeq: number): boolean => {
    if (msgs.length === 0) return false
    const pool = bySeqRef.current
    let changed = false
    for (let i = 0; i < msgs.length; i++) {
      const seq = baseSeq + i
      const m = msgs[i]
      const prev = pool.get(seq)
      // append-only 不可變：缺則填；同 seq 但內容變長（串流中尾則）則更新。
      if (!prev) {
        pool.set(seq, m)
        changed = true
        if (seq < minLoadedSeqRef.current) minLoadedSeqRef.current = seq
      } else if (sigOf([m]) !== sigOf([prev])) {
        pool.set(seq, m)
        changed = true
      }
    }
    return changed
  }, [])

  const setSegState = useCallback((startSeq: number, st: SegmentLoadState) => {
    segStatesRef.current.set(startSeq, st)
    if (mountedRef.current) setSegStateVersion((v) => v + 1)
  }, [])

  // ── 輪詢：window + segments（同節奏，Promise.all）─────────
  const refreshNew = useCallback(async () => {
    const myEpoch = epochRef.current
    setLoading(true)
    try {
      const [winR, segR] = await Promise.all([
        api.getWindow!(),
        api.getSegments!(),
      ])
      if (!mountedRef.current) return
      // 回包時 epoch 已變 → 丟棄（換綁已觸發新一輪抓取）
      if (epochRef.current !== myEpoch) return
      // window：併入 pool（只增不減；水位縮窗也不會弄丟更早訊息）
      if (winR.ok && winR.data && winR.data.ok) {
        const win = winR.data
        const winSig = `${win.totalCount}:${win.startSeq}:${sigOf(win.messages)}`
        if (winSig !== winSigRef.current) {
          winSigRef.current = winSig
          // window 從 win.startSeq 起連續 → 以此為 baseSeq 推算每筆全域 seq
          const changed = mergeIntoPool(win.messages, win.startSeq)
          // setTotalCount 值相同時 React 自動 bail out，無需手動比對；故不依賴 totalCount
          setTotalCount(win.totalCount)
          if (changed) setPoolVersion((v) => v + 1)
        }
      }
      // segments：append-only，比對 segments.length + 尾段 msg_count/end_seq
      if (segR.ok && segR.data && segR.data.ok) {
        const sig = segSigOf(segR.data.segments)
        if (sig !== segSigRef.current) {
          segSigRef.current = sig
          setSegments(segR.data.segments)
        }
      }
      // 首批回包成功 → 解除 switching
      setSwitching(false)
    } catch {
      /* 靜默 */
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [api, mergeIntoPool])

  // ── 輪詢：舊路徑（getConversation 尾端 300 + 簽名比對）────
  const refreshLegacy = useCallback(async () => {
    const myEpoch = epochRef.current
    setLoading(true)
    try {
      if (typeof api.getLegacy !== 'function') {
        setSwitching(false)
        return
      }
      const r = await api.getLegacy()
      if (!mountedRef.current) return
      // 回包時 epoch 已變 → 丟棄
      if (epochRef.current !== myEpoch) return
      if (r.ok && r.data) {
        const sig = sigOf(r.data)
        if (sig !== legacySigRef.current) {
          legacySigRef.current = sig
          setLegacyMessages(r.data)
        }
      }
      // 首批回包成功 → 解除 switching
      setSwitching(false)
    } catch {
      /* 靜默 */
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [api])

  const refresh = legacyRef.current ? refreshLegacy : refreshNew

  // 進場載入 + 每 3s 輪詢
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [refresh])

  /** 取記憶體中某段已載入的訊息，並判斷是否整段齊全。 */
  const getMessagesFor = useCallback(
    (startSeq: number, endSeq: number): { complete: boolean; messages: ConversationMessage[] } => {
      const pool = bySeqRef.current
      const out: ConversationMessage[] = []
      let complete = true
      for (let s = startSeq; s <= endSeq; s++) {
        const m = pool.get(s)
        if (m) out.push(m)
        else complete = false
      }
      return { complete, messages: out }
    },
    // poolVersion 變動代表 pool 內容改了 → 重建此 callback 讓消費端拿到最新讀取結果
    [poolVersion],
  )

  /** 展開某段時撈整段（DB 直查）併入 pool。冪等：loaded/loading 不重打。 */
  const fetchSegment = useCallback(
    (startSeq: number, endSeq: number) => {
      const cur = segStatesRef.current.get(startSeq)
      if (cur && (cur.phase === 'loading' || cur.phase === 'loaded')) return
      if (typeof api.getSegmentMessages !== 'function') {
        setSegState(startSeq, { phase: 'error' })
        return
      }
      const myEpoch = epochRef.current
      setSegState(startSeq, { phase: 'loading' })
      api
        .getSegmentMessages(startSeq, endSeq)
        .then((r) => {
          if (!mountedRef.current) return
          // 回包時 epoch 已變 → 丟棄（換綁後舊段資料不得污染新池）
          if (epochRef.current !== myEpoch) return
          if (r.ok && r.data && r.data.ok) {
            // getSegmentMessages 從 startSeq 起連續回傳整段 → 以 startSeq 為 baseSeq
            const changed = mergeIntoPool(r.data.messages, startSeq)
            setSegState(startSeq, { phase: 'loaded' })
            if (changed) setPoolVersion((v) => v + 1)
          } else {
            setSegState(startSeq, { phase: 'error' })
          }
        })
        .catch(() => {
          if (mountedRef.current) setSegState(startSeq, { phase: 'error' })
        })
    },
    [api, mergeIntoPool, setSegState],
  )

  const segmentStateOf = useCallback(
    (startSeq: number): SegmentLoadState =>
      segStatesRef.current.get(startSeq) ?? { phase: 'idle' },
    // segStateVersion 變動代表某段狀態改了 → 重建讓消費端拿到最新狀態
    [segStateVersion],
  )

  // 向後相容平鋪：新路徑= bySeq 池依 seq 排序；舊路徑= legacyMessages。
  const messages = useMemo(() => {
    if (legacy) return legacyMessages
    const pool = bySeqRef.current
    return [...pool.keys()].sort((a, b) => a - b).map((k) => pool.get(k)!)
    // poolVersion 變動代表池內容改了 → 重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacy, legacyMessages, poolVersion])

  return {
    segments,
    totalCount,
    getMessagesFor,
    fetchSegment,
    segmentStateOf,
    loading,
    refresh,
    legacyMessages,
    legacy: legacy,
    messages,
    switching,
  }
}

export function useConversation(sessionId: string, epoch = 0): ConversationData {
  const api = useMemo<ConversationDataApi>(
    () => ({
      getWindow:
        typeof window.tuq?.session?.getConversationWindow === 'function'
          ? () => window.tuq.session.getConversationWindow(sessionId)
          : undefined,
      getSegments:
        typeof window.tuq?.session?.getSegments === 'function'
          ? () => window.tuq.session.getSegments(sessionId)
          : undefined,
      getSegmentMessages:
        typeof window.tuq?.session?.getSegmentMessages === 'function'
          ? (startSeq, endSeq) =>
              window.tuq.session.getSegmentMessages(sessionId, startSeq, endSeq)
          : undefined,
      getLegacy: () => window.tuq.session.getConversation(sessionId),
    }),
    [sessionId],
  )
  return useConversationData(sessionId, api, epoch)
}
