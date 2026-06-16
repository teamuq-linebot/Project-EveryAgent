/**
 * skillsList.ts — 掃描可用的 Claude Code slash command（skill）清單。
 *
 * Skill 即檔案系統目錄：每個含 SKILL.md 的子目錄就是一個 `/<名稱>` 指令。
 * 掃描來源（後者覆蓋前者，與 Claude Code 解析順序一致）：
 *   1. 全域：~/.claude/skills/<name>/SKILL.md
 *   2. 專案：<projectPath>/.claude/skills/<name>/SKILL.md
 * description 取 SKILL.md YAML frontmatter 的 `description:`（下拉 tooltip 用）。
 * 全程容錯：目錄不存在 / 讀檔失敗一律跳過，回空清單不拋錯。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { SkillItem } from '../../shared/ipcContracts'

/** 讀 SKILL.md frontmatter 的 description（單行；無 frontmatter / 無欄位 → null）。 */
function readDescription(skillMdPath: string): string | null {
  let text: string
  try {
    // skill 檔案很小，整檔讀無妨；只取前 4KB 防呆。
    text = fs.readFileSync(skillMdPath, 'utf-8').slice(0, 4096)
  } catch {
    return null
  }
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  const frontmatter = end === -1 ? text : text.slice(0, end)
  const m = frontmatter.match(/^description:\s*(.+)$/m)
  if (!m) return null
  const desc = m[1].trim().replace(/^['"]|['"]$/g, '')
  return desc || null
}

/** 掃一個 skills 根目錄，收集 {name → SkillItem}。 */
function scanDir(root: string, into: Map<string, SkillItem>): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return // 目錄不存在 / 無權限
  }
  for (const e of entries) {
    // Dirent 對 symlink 的 isDirectory() 回 false，必須同時收 symlink
    // （tuq-* skills 皆為指向 AgentOrg 的 symlink，只靠 isDirectory() 會漏掉）
    if (!e.isDirectory() && !e.isSymbolicLink()) continue
    const skillMd = path.join(root, e.name, 'SKILL.md')
    try {
      if (!fs.statSync(skillMd).isFile()) continue
    } catch {
      continue
    }
    into.set(e.name, { name: e.name, description: readDescription(skillMd) })
  }
}

/**
 * 列出可用 skill 指令（全域 + 專案；專案覆蓋同名全域）。
 * projectPath 空 / null → 只掃全域。
 */
export function listSkillCommands(projectPath: string | null): SkillItem[] {
  const found = new Map<string, SkillItem>()
  scanDir(path.join(os.homedir(), '.claude', 'skills'), found)
  if (projectPath) {
    scanDir(path.join(projectPath, '.claude', 'skills'), found)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}
