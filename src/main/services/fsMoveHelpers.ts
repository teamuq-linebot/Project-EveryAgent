/**
 * fsMoveHelpers.ts — 跨磁碟/跨雲端硬碟「安全搬移」檔案 helper（plan_v2 §2.2）
 *
 * 純 node:fs / node:path 邏輯，不碰 DB / better-sqlite3。
 * teamRelocationService 的 copyVerify 抽到此檔，控 max-lines（兩檔皆 <500）。
 *
 * 核心策略（跨磁碟 C: ↔ T: Google Drive 一律 copy+verify+delete，不用 rename）：
 *   1. copy   — fs.cp(recursive:true, errorOnExist:true, force:false)：目標已存在即拒絕。
 *   2. verify — 比對來源/目標「檔案清單（相對路徑集合） + 每檔 byte 大小」一致。
 *   3. delete — verify 通過才 fs.rm(src, recursive)；verify 失敗保留來源、不刪。
 *
 * verify 只比「檔數 + 大小」（不做 full hash——Drive 上大量 hash 太慢；
 * 檔數+大小足以抓「部分同步/截斷」）。
 *
 * ⚠️ 禁 lazy require / 動態 import：所有 import 一律頂層（esbuild 不打包 → runtime 缺模組）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** copyVerify 結果（phase 與 teamRelocationService 對齊；'done'＝copy+verify+delete 全成功）。 */
export interface CopyVerifyResult {
  ok: boolean
  phase: 'copy' | 'verify' | 'cleanup' | 'done'
  message?: string
}

/**
 * 遞迴列出 `root` 下所有「檔案」的「相對路徑 → byte 大小」映射。
 * 不含目錄本身（只記檔案）；相對路徑一律以 `/` 為分隔符（跨平台可比對）。
 * root 不存在 / 任何 IO 例外 → 回傳空 Map（呼叫端依此判定缺檔）。
 */
export async function listFilesWithSizes(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()

  async function walk(dir: string, rel: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(abs, relPath)
      } else if (entry.isFile()) {
        try {
          const st = await fs.promises.stat(abs)
          out.set(relPath, st.size)
        } catch {
          // 單檔 stat 失敗 → 略過（verify 端會偵測缺檔）
        }
      }
      // symlink / 其他類型：跳過（agent 檔目錄不應含 symlink；保守不搬）
    }
  }

  try {
    await walk(root, '')
  } catch {
    /* 任何例外 → 回已收集到的部分（呼叫端比對即偵測不一致） */
  }
  return out
}

/**
 * 比對 src / dst 兩棵子樹的「檔案清單 + 每檔 byte 大小」是否一致。
 *   一致 → { ok:true }
 *   不一致 → { ok:false, message }（message 為白話：缺檔 / 大小不符 / 多檔）。
 *
 * 用於 copyVerify 的 verify 階段，也供 relocateTeam「skill 目錄續傳偵測」重用。
 */
export async function verifyTreesMatch(
  src: string,
  dst: string,
): Promise<{ ok: boolean; message?: string }> {
  const srcFiles = await listFilesWithSizes(src)
  const dstFiles = await listFilesWithSizes(dst)

  if (srcFiles.size !== dstFiles.size) {
    return {
      ok: false,
      message: `檔案數量不一致（來源 ${srcFiles.size}、目標 ${dstFiles.size}），複製可能未完成`,
    }
  }

  for (const [rel, srcSize] of srcFiles) {
    if (!dstFiles.has(rel)) {
      return { ok: false, message: `目標缺少檔案「${rel}」，複製可能未完成` }
    }
    const dstSize = dstFiles.get(rel) as number
    if (dstSize !== srcSize) {
      return {
        ok: false,
        message: `檔案「${rel}」大小不符（來源 ${srcSize}、目標 ${dstSize} bytes），複製可能未完成`,
      }
    }
  }

  return { ok: true }
}

/**
 * copyVerify — 跨磁碟安全搬移單一子樹（plan_v2 §2.2）。
 *
 * 流程：
 *   1. copy   — `fs.cp(src, dst, { recursive:true, errorOnExist:true, force:false })`。
 *               目標已存在 → 拋錯（與 §4 衝突偵測雙保險）→ 回 phase:'copy' 失敗，**不刪來源**。
 *   2. verify — `verifyTreesMatch(src, dst)`：檔數 + 大小一致才通過。
 *               不一致 → 回 phase:'verify' 失敗，**保留來源**，並嘗試刪除半拷的目標（讓呼叫端可重試）。
 *   3. delete — verify 通過才 `fs.rm(src, { recursive:true })`。
 *               delete 失敗 → 視為「搬移成功但舊位置殘留」：回 ok:true、phase:'cleanup'、帶 warning。
 *
 * @param src 來源子樹（須存在）
 * @param dst 目標子樹（**必須不存在**，errorOnExist 強制）
 * @returns CopyVerifyResult；ok:true 代表「資料已安全在目標」（含 delete 失敗但 verify 過的情形）。
 */
export async function copyVerify(src: string, dst: string): Promise<CopyVerifyResult> {
  // 0. 目標已存在（任何形態）→ 拒絕，不動來源（§4 衝突偵測；fs.cp 的 errorOnExist 只逐檔擋，
  //    無法擋「目標夾已存在但檔名不同」的情形，故此處先整夾偵測）。
  if (await pathExists(dst)) {
    return { ok: false, phase: 'copy', message: `目標已存在「${dst}」，為避免覆蓋未複製` }
  }
  // 1. copy（errorOnExist：逐檔再擋一次）
  try {
    await fs.promises.cp(src, dst, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
  } catch (e) {
    // copy 失敗：來源完好；目標可能半拷 → 嘗試清掉半拷目標，回 copy 失敗。
    await rmQuiet(dst)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, phase: 'copy', message: `複製失敗：${msg}` }
  }

  // 2. verify（檔數 + 大小）
  const v = await verifyTreesMatch(src, dst)
  if (!v.ok) {
    // verify 失敗：保留來源不刪；清掉半拷目標讓呼叫端可重試。
    await rmQuiet(dst)
    return { ok: false, phase: 'verify', message: v.message }
  }

  // 3. delete 來源（verify 通過）
  try {
    await fs.promises.rm(src, { recursive: true })
  } catch (e) {
    // 資料已安全在目標，舊位置殘留 → 不視為失敗，回 warning。
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: true,
      phase: 'cleanup',
      message: `已複製到新位置，但舊資料夾未能清除（可手動刪除）：${msg}`,
    }
  }

  return { ok: true, phase: 'done' }
}

/**
 * copyVerifyKeepSource — copy + verify，但**不刪來源**（plan_v2 §2.3 step4 skill 用）。
 *
 * 與 copyVerify 同的 copy+verify，差別在「verify 通過後保留來源」——
 * 供 claude 入口 skill 目錄使用：step4 先複製到新來源（不刪），
 * step6 cleanup 再以 R4 安全檢查決定是否刪舊來源 skill（避免誤刪共用 skillName 的別隊）。
 *
 * @returns CopyVerifyResult；phase 'done'＝copy+verify 成功（來源仍在）。
 */
export async function copyVerifyKeepSource(src: string, dst: string): Promise<CopyVerifyResult> {
  if (await pathExists(dst)) {
    return { ok: false, phase: 'copy', message: `目標已存在「${dst}」，為避免覆蓋未複製` }
  }
  try {
    await fs.promises.cp(src, dst, { recursive: true, errorOnExist: true, force: false })
  } catch (e) {
    await rmQuiet(dst)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, phase: 'copy', message: `複製失敗：${msg}` }
  }
  const v = await verifyTreesMatch(src, dst)
  if (!v.ok) {
    await rmQuiet(dst)
    return { ok: false, phase: 'verify', message: v.message }
  }
  return { ok: true, phase: 'done' }
}

/** 靜默刪除（recursive + force）：路徑不存在 / 任何例外都不拋（回滾清理用）。 */
export async function rmQuiet(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true })
  } catch {
    /* 回滾清理 best-effort，永不 throw */
  }
}

/** 路徑存在性探測：存在→true、不存在/任何錯誤→false（永不 throw）。 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}
