/**
 * introductionDraftStore.ts — introduction.json 草稿存取（agentteams-edit-flow §4.3、§6.3）
 *
 * 草稿檔：introduction.draft.{hostname}.json，與 introduction.json 同層（agent 目錄內）。
 *   - hostname 後綴：防 Google Drive 多機同步衝突（各機維護自己的草稿）
 *   - _meta._base_hash：草稿建立時 introduction.json 原文 sha256（上游衝突偵測）
 *
 * 自 agentOrgService.ts 抽出獨立檔（既有檔近 500 行，ESLint max-lines 守門）。
 * 所有 import 皆頂層（main 端禁 lazy require — esbuild 不打包動態 require）。
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import type {
  AgentIntroduction,
  AgentIntroductionDraft,
  AgentOrgDraftResult,
  IntroductionDraftMeta,
} from '../../shared/ipcContracts'

// ---------------------------------------------------------------------------
// 路徑 / hash helpers
// ---------------------------------------------------------------------------

/** hostname 檔名安全化：非 [A-Za-z0-9._-] 一律替換為 '-'（空結果 fallback 'local'）。 */
function sanitizeHostname(hostname: string): string {
  const safe = hostname.replace(/[^A-Za-z0-9._-]/g, '-')
  return safe || 'local'
}

/** 本機草稿檔名（introduction.draft.{hostname}.json）。 */
export function draftFileName(hostname: string = os.hostname()): string {
  return `introduction.draft.${sanitizeHostname(hostname)}.json`
}

/** agent 目錄解析（teamId 可含 '/' 子團隊，與 getAgentDetail 同邏輯）。 */
function agentDirOf(rootPath: string, teamId: string, agentName: string): string {
  return path.join(rootPath, ...teamId.split('/'), agentName)
}

/** 字串內容 sha256 hex。 */
export function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/** 讀取目前 introduction.json 原文並計算 sha256；讀不到（無檔）→ null。 */
async function readIntroductionHash(agentDir: string): Promise<string | null> {
  try {
    const raw = await fsp.readFile(path.join(agentDir, 'introduction.json'), 'utf-8')
    return sha256Of(raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 草稿存取
// ---------------------------------------------------------------------------

/**
 * 寫入本機 hostname 的草稿檔。
 * @param baseHash 草稿基礎的 introduction.json sha256；省略時以目前檔案內容計算
 *                 （introduction.json 不存在則存空字串 → getDraft 不觸發衝突）。
 */
export async function saveDraft(
  rootPath: string,
  teamId: string,
  agentName: string,
  draft: AgentIntroduction,
  baseHash?: string,
): Promise<void> {
  const agentDir = agentDirOf(rootPath, teamId, agentName)
  const resolvedBaseHash = baseHash ?? (await readIntroductionHash(agentDir)) ?? ''
  const meta: IntroductionDraftMeta = {
    _base_hash: resolvedBaseHash,
    _created_at: new Date().toISOString(),
    _hostname: os.hostname(),
  }
  const payload: AgentIntroductionDraft = { ...draft, _meta: meta }
  await fsp.writeFile(
    path.join(agentDir, draftFileName()),
    JSON.stringify(payload, null, 2),
    'utf-8',
  )
}

/**
 * 讀取本機 hostname 的草稿。
 * 回傳 { draft|null, conflict }；conflict = 草稿 _base_hash ≠ sha256(目前 introduction.json)。
 * 無草稿檔或 JSON parse 失敗（AI 寫壞防護）→ { draft: null, conflict: false }。
 */
export async function getDraft(
  rootPath: string,
  teamId: string,
  agentName: string,
): Promise<AgentOrgDraftResult> {
  const agentDir = agentDirOf(rootPath, teamId, agentName)
  let draft: AgentIntroductionDraft
  try {
    const raw = await fsp.readFile(path.join(agentDir, draftFileName()), 'utf-8')
    draft = JSON.parse(raw) as AgentIntroductionDraft
  } catch {
    // 無草稿檔或格式壞掉都不是錯誤（壞 JSON 防護見 agentteams-edit-flow §4.4-7）
    return { draft: null, conflict: false }
  }

  const baseHash = draft._meta?._base_hash
  let conflict = false
  if (typeof baseHash === 'string' && baseHash !== '') {
    const currentHash = await readIntroductionHash(agentDir)
    // introduction.json 被改過（hash 不符）或被刪（currentHash=null）→ 衝突
    conflict = currentHash !== baseHash
  }
  return { draft, conflict }
}

/** 刪除本機 hostname 的草稿檔（不存在視為成功，冪等）。 */
export async function clearDraft(
  rootPath: string,
  teamId: string,
  agentName: string,
): Promise<void> {
  const agentDir = agentDirOf(rootPath, teamId, agentName)
  try {
    await fsp.unlink(path.join(agentDir, draftFileName()))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

/**
 * 套用前備份：複製 introduction.json → introduction.backup.json（同層覆寫）。
 * M7 失敗安全保證用；introduction.json 不存在時拋錯（呼叫方不應在無原檔時套用）。
 */
export async function backupIntroduction(
  rootPath: string,
  teamId: string,
  agentName: string,
): Promise<void> {
  const agentDir = agentDirOf(rootPath, teamId, agentName)
  await fsp.copyFile(
    path.join(agentDir, 'introduction.json'),
    path.join(agentDir, 'introduction.backup.json'),
  )
}

// ---------------------------------------------------------------------------
// fs.watch 草稿監看（agentteams-edit-flow §4.4 — AI 共編推播）
// ---------------------------------------------------------------------------

/** key: agentDir + ':' + hostname（一機一草稿路徑唯一）。 */
const watchers = new Map<string, fs.FSWatcher>()

/**
 * 開始監看 introduction.draft.{hostname}.json。
 * - 已有 watcher 時先關閉再重建（冪等）。
 * - 草稿檔不存在時改監看父目錄（Windows 上監看目錄比單一檔案更穩定）。
 * - callback 傳入新草稿內容；JSON parse 失敗時傳 null（AI 寫壞防護）。
 */
export function watchDraft(
  agentDir: string,
  hostname: string,
  callback: (draft: AgentIntroduction | null) => void,
): void {
  const key = `${agentDir}:${hostname}`
  const existing = watchers.get(key)
  if (existing) {
    try { existing.close() } catch { /**/ }
  }

  const filePath = path.join(agentDir, draftFileName(hostname))
  // 決定監看目標：檔存在監看檔，否則監看目錄（Windows 穩定性）
  let target: string
  try {
    fs.accessSync(filePath)
    target = filePath
  } catch {
    target = agentDir
  }

  const watcher = fs.watch(target, { persistent: false }, (_event, filename) => {
    const isTarget =
      !filename ||
      filename === `introduction.draft.${sanitizeHostname(hostname)}.json`
    if (!isTarget) return
    // 異步讀取；JSON parse 失敗靜默（AI 寫壞防護 M5）
    fsp
      .readFile(filePath, 'utf-8')
      .then((raw) => {
        try {
          const data = JSON.parse(raw) as AgentIntroductionDraft
          callback(data)
        } catch {
          callback(null)
        }
      })
      .catch(() => callback(null))
  })
  watchers.set(key, watcher)
}

/**
 * 停止監看指定 agentDir + hostname 的草稿（watcher 不存在視為 no-op）。
 */
export function unwatchDraft(agentDir: string, hostname: string): void {
  const key = `${agentDir}:${hostname}`
  const w = watchers.get(key)
  if (w) {
    try { w.close() } catch { /**/ }
    watchers.delete(key)
  }
}
