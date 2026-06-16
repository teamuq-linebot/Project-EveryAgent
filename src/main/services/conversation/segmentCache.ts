/**
 * segmentCache.ts — 段切片記憶體 LRU 機制（move-only，行為保留）。
 *
 * 原本內嵌於 conversationStore.ts 的 _readSlice：以 `segCache: Map<string, ConversationMessage[]>`
 * 做「key = `${start_pos}:${end_pos}` → 該範圍解析出的訊息（已濾 null）」的小型 LRU
 * （最多 SEG_CACHE_MAX 段），避免 UI 反覆展開同段時重複 fs.read + 解析。
 *
 * 抽出時嚴格保留原邏輯：
 *   - cacheKey(startPos, endPos)        產生與原本逐字相同的 key（`${startPos}:${endPos}`）。
 *   - segCacheGet(map, key)             命中時 delete→set 重插推到最新端（LRU touch），回 hit；未命中回 undefined。
 *   - segCacheSet(map, key, msgs)       存入後 while(size > SEG_CACHE_MAX) 從最舊端淘汰。
 *
 * 快取的容器（Map）仍存放在 MemEntry.segCache（不改持有位置 / 形狀），
 * 本檔只提供無狀態的操作函式；facade（conversationStore.ts）import 回去委派。
 */

import type { ConversationMessage } from '../../../shared/ipcContracts'

/** 段切片記憶體 LRU 上限（每檔）。原 conversationStore.ts 的 SEG_CACHE_MAX。 */
export const SEG_CACHE_MAX = 8

/** 段切片 LRU 的 key：與原 _readSlice 逐字相同（`${startPos}:${endPos}`）。 */
export function cacheKey(startPos: number, endPos: number): string {
  return `${startPos}:${endPos}`
}

/**
 * LRU 讀取：命中則 delete 後重插（推到最新端）並回傳；未命中回 undefined。
 * 與原 _readSlice 的命中分支邏輯逐字一致。
 */
export function segCacheGet(
  map: Map<string, ConversationMessage[]>,
  key: string,
): ConversationMessage[] | undefined {
  const hit = map.get(key)
  if (hit) {
    // LRU touch：刪後重插推到最新端
    map.delete(key)
    map.set(key, hit)
    return hit
  }
  return undefined
}

/**
 * LRU 存入：寫 key→msgs 後，while size > SEG_CACHE_MAX 從最舊端（keys().next()）淘汰。
 * 與原 _readSlice 的存入/淘汰分支邏輯逐字一致。
 */
export function segCacheSet(
  map: Map<string, ConversationMessage[]>,
  key: string,
  msgs: ConversationMessage[],
): void {
  map.set(key, msgs)
  while (map.size > SEG_CACHE_MAX) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
