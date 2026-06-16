/**
 * sync-agent-templates.js — 白名單抽取腳本
 *
 * 管理範圍（先清後抄，嚴禁碰其他子樹）：
 *   1. <DST>/.claude/skills/tuq-agent/
 *      ← <SRC>/.claude/skills/tuq-agent/
 *   2. <DST>/agents/protocols/definitions.md
 *      ← <SRC>/agents/protocols/definitions.md（單檔，不抄整個 protocols/）
 *   3. <DST>/agents/agent-ops/
 *      ← <SRC>/agents/agent-ops/ 下指定子目錄：
 *        manager/ _protocols/ _shared/calculator/ agent-builder/
 *        governance/ evolution/ researcher/
 *
 * 嚴禁刪除/覆蓋：
 *   <DST>/agents/general/  （示範範本，不屬本腳本管理）
 *   <DST>/README.md         （根說明文件）
 *
 * 白名單來源：task_id tuq-agent-builtin-bundle-20260611
 *
 * 用法：
 *   node scripts/sync-agent-templates.js [--src=<path>] [--dst=<path>]
 *   環境變數：AGENTORG_SRC（CLI --src 優先）
 *   --dst 僅供測試（不列入正式 README），允許指定任意輸出根。
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

// ─── 1. 解析 CLI 參數 ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let argSrc = null
let argDst = null

for (const arg of args) {
  if (arg.startsWith('--src=')) argSrc = arg.slice('--src='.length)
  else if (arg.startsWith('--dst=')) argDst = arg.slice('--dst='.length)
}

// ─── 2. 決定來源 / 目標根 ────────────────────────────────────────────────────

const DEFAULT_SRC = 'T:/共用雲端硬碟/快組隊.Agents/AgentOrg'

const SRC_ROOT = argSrc || process.env.AGENTORG_SRC || DEFAULT_SRC
// 目標根：以腳本位置 __dirname/.. 推導（不依賴 CWD）
const PROJ_ROOT = path.resolve(__dirname, '..')
const DST_ROOT = argDst || path.join(PROJ_ROOT, 'resources', 'agent-templates')

// ─── 3. EXCLUDE 規則 ─────────────────────────────────────────────────────────

const EXCLUDE_DIRS = new Set([
  'memory', 'worklog', 'output', '_log', 'retrospective',
  'archive', '__pycache__', '.draft',
])

// 檔名完整比對
const EXCLUDE_FILENAMES = new Set(['README.md', '.DS_Store'])

// 檔名後綴 / pattern 比對（依序）
const EXCLUDE_FILE_PATTERNS = [
  /\.bak$/,
  /\.bak\./,
  /\.draft\./,
  /^introduction\.draft\./,
  /^introduction\.backup\.json$/,
  /\.tmp$/,
]

/**
 * @param {string} name 純檔名（不含路徑）
 * @returns {boolean} true = 應排除
 */
function shouldExcludeFile(name) {
  if (EXCLUDE_FILENAMES.has(name)) return true
  return EXCLUDE_FILE_PATTERNS.some((re) => re.test(name))
}

/**
 * @param {string} name 純目錄名
 * @returns {boolean} true = 應剪枝（整個子樹跳過）
 */
function shouldExcludeDir(name) {
  return EXCLUDE_DIRS.has(name)
}

// ─── 4. 遞迴複製工具 ─────────────────────────────────────────────────────────

let copiedCount = 0
let skippedCount = 0

/**
 * 遞迴抄寫 srcDir → dstDir，套用 EXCLUDE 規則。
 * @param {string} srcDir
 * @param {string} dstDir
 */
function copyDirRecursive(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return

  fs.mkdirSync(dstDir, { recursive: true })

  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcEntry = path.join(srcDir, entry.name)
    const dstEntry = path.join(dstDir, entry.name)

    if (entry.isDirectory()) {
      if (shouldExcludeDir(entry.name)) {
        skippedCount++
        continue
      }
      copyDirRecursive(srcEntry, dstEntry)
    } else if (entry.isFile()) {
      if (shouldExcludeFile(entry.name)) {
        skippedCount++
        continue
      }
      fs.mkdirSync(path.dirname(dstEntry), { recursive: true })
      fs.copyFileSync(srcEntry, dstEntry)
      copiedCount++
    }
  }
}

/**
 * 抄寫 srcDir 下指定子目錄清單 → dstDir/<subdir>。
 * @param {string} srcDir
 * @param {string} dstDir
 * @param {string[]} subdirs
 */
function copySubdirs(srcDir, dstDir, subdirs) {
  for (const sub of subdirs) {
    // 支援巢狀路徑（如 _shared/calculator）
    const srcSub = path.join(srcDir, sub)
    const dstSub = path.join(dstDir, sub)
    copyDirRecursive(srcSub, dstSub)
  }
}

// ─── 5. 主流程 ───────────────────────────────────────────────────────────────

function main() {
  // 5-0. 來源存在確認
  if (!fs.existsSync(SRC_ROOT)) {
    console.error(`[sync-agent-templates] ERROR: 來源根不存在：${SRC_ROOT}`)
    console.error('  請確認 T: 磁碟已掛載，或用 --src=<path> 指定本機路徑，或設 AGENTORG_SRC 環境變數。')
    process.exit(1)
  }

  console.log(`[sync-agent-templates] 來源：${SRC_ROOT}`)
  console.log(`[sync-agent-templates] 目標：${DST_ROOT}`)

  // ── 管理子樹定義 ──────────────────────────────────────────────────────────

  // 子樹 1：tuq-agent skill
  const SKILL_SRC = path.join(SRC_ROOT, '.claude', 'skills', 'tuq-agent')
  const SKILL_DST = path.join(DST_ROOT, '.claude', 'skills', 'tuq-agent')

  // 子樹 2：definitions.md（單檔）
  const DEFS_SRC = path.join(SRC_ROOT, 'agents', 'protocols', 'definitions.md')
  const DEFS_DST = path.join(DST_ROOT, 'agents', 'protocols', 'definitions.md')

  // 子樹 3：agent-ops 指定子目錄
  const AGENT_OPS_SRC = path.join(SRC_ROOT, 'agents', 'agent-ops')
  const AGENT_OPS_DST = path.join(DST_ROOT, 'agents', 'agent-ops')
  const AGENT_OPS_SUBDIRS = [
    'manager',
    '_protocols',
    path.join('_shared', 'calculator'),
    'agent-builder',
    'governance',
    'evolution',
    'researcher',
  ]

  // ── 5-1. 先清（只清管理子樹）────────────────────────────────────────────

  console.log('[sync-agent-templates] 清除管理子樹舊內容…')
  fs.rmSync(SKILL_DST, { recursive: true, force: true })
  // definitions.md：只刪單檔
  if (fs.existsSync(DEFS_DST)) fs.rmSync(DEFS_DST, { force: true })
  // agent-ops：只清指定子目錄
  for (const sub of AGENT_OPS_SUBDIRS) {
    const dstSub = path.join(AGENT_OPS_DST, sub)
    fs.rmSync(dstSub, { recursive: true, force: true })
  }

  // ── 5-2. 後抄 ────────────────────────────────────────────────────────────

  console.log('[sync-agent-templates] 抄寫白名單內容…')

  // 子樹 1
  copyDirRecursive(SKILL_SRC, SKILL_DST)

  // 子樹 2（單檔）
  if (fs.existsSync(DEFS_SRC)) {
    fs.mkdirSync(path.dirname(DEFS_DST), { recursive: true })
    fs.copyFileSync(DEFS_SRC, DEFS_DST)
    copiedCount++
  } else {
    console.warn(`[sync-agent-templates] WARNING: 找不到 ${DEFS_SRC}，略過。`)
  }

  // 子樹 3
  copySubdirs(AGENT_OPS_SRC, AGENT_OPS_DST, AGENT_OPS_SUBDIRS)

  // ── 5-3. 摘要 ────────────────────────────────────────────────────────────

  console.log('\n[sync-agent-templates] 完成摘要：')
  console.log(`  複製檔數：${copiedCount}`)
  console.log(`  略過（exclude）檔/目錄數：${skippedCount}`)
  console.log('  各管理子樹目標路徑：')
  console.log(`    [1] .claude/skills/tuq-agent/ → ${SKILL_DST}`)
  console.log(`    [2] agents/protocols/definitions.md → ${DEFS_DST}`)
  console.log(`    [3] agents/agent-ops/<subdirs> → ${AGENT_OPS_DST}`)
}

main()
