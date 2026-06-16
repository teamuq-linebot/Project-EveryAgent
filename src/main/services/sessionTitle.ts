/**
 * sessionTitle.ts — 往 claude session JSONL 追加 custom-title 記錄（session 改名）。
 * 忠實移植自 Python teamuq/tools/sessions.py write_session_custom_title。
 *
 * 以 append 模式寫一行（claude 本身也在持續 append 此檔，重寫整檔會損毀 session）。
 * 定位走 worktime/claude discover.findProjectFolder（不自行重寫路徑編碼）。
 */

import * as fs from 'fs'
import * as nodePath from 'path'
import { findProjectFolder } from '../worktime/claude/discover'

const SKIP_MATCHES = new Set(['not-found', 'parent-direct', 'parent-case-insensitive'])

/**
 * 往 `<.claude/projects/<encoded>>/<sessionId>.jsonl` 追加一筆 custom-title 記錄。
 * 成功回 true；JSONL 不存在 / 定位失敗 / 任何例外 → false（不拋給上層）。
 */
export function writeSessionCustomTitle(
  projectPath: string,
  sessionId: string,
  customTitle: string,
): boolean {
  try {
    const match = findProjectFolder(projectPath)
    if (SKIP_MATCHES.has(match.match)) return false
    const folder = match.folder_path
    if (!folder || !fs.existsSync(folder)) return false
    const jsonl = nodePath.join(folder, `${sessionId}.jsonl`)
    if (!fs.existsSync(jsonl)) return false

    const record = {
      type: 'custom-title',
      customTitle,
      sessionId,
      timestamp: new Date().toISOString(),
      uuid:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }
    fs.appendFileSync(jsonl, JSON.stringify(record) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}
