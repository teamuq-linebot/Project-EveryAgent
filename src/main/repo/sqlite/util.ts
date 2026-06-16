import * as crypto from 'crypto'

// ---------------------------------------------------------------------------
// 小工具：local_id 生成 / ISO 時間戳 / 字串正規化（範式取自 backend.ts / punchLedger.ts）
// ---------------------------------------------------------------------------

/** 產生正式 local_id（含連字號 UUID；'loc:…' 暫鍵由打卡路徑另行產生，§2.9）。 */
export function genLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const h = (n: number): string =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${h(8)}-${h(4)}-4${h(3)}-${h(4)}-${h(12)}`
}

/**
 * 產生 'loc:…' 打卡暫鍵（§2.9 打卡 local-first）。打卡當下後端尚未配發 remote_id，
 * 子任務先以 'loc:' 前綴的本地暫鍵存活；flush 成功由 LocBackfill 回填 remote_id（不改 local_id）。
 * 前綴 'loc:' 是歷史本地暫鍵的外洩防護判別點。
 */
export function genLocSubtaskId(): string {
  return `loc:${genLocalId()}`
}

/** 將任意值正規化為字串或 null（None/undefined/'' → null）；對齊 punchLedger._s 範式。 */
export function toStrOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null
  const s = String(val)
  return s === '' ? null : s
}

/** ISO timestamp（毫秒精度；對齊 punchLedger.nowIso 範式）。 */
export function nowIso(): string {
  const now = new Date()
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0')
  return now.toISOString().replace(/\.\d+Z$/, `.${ms}Z`)
}

/** 取 node 第一個非空字串欄（認親 / 補欄位用；缺則 null）。 */
export function pickStr(node: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = node[k]
    if (v !== null && v !== undefined && v !== '') return String(v)
  }
  return null
}

/** 取 node 第一個可轉數字欄（version / duration 等；缺或非數值則 null）。 */
export function pickNum(node: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = node[k]
    if (v === null || v === undefined || v === '') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** 取 node 的子物件欄（巢狀展開用；非物件或缺則 null）。 */
export function pickObj(node: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = node[key]
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}
