/**
 * agentOrgService.ts — 掃描 AgentOrg 目錄、解析 agent.yaml、回傳結構化資料
 *
 * AgentOrg 根目錄由呼叫方傳入（目前常數化於 backend.ts，之後可改設定）。
 * 不依賴 npm yaml 套件，使用輕量手寫 parser（agent.yaml 是淺層 key:value + dispatch: 一層巢狀）。
 */

import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// 排除清單（team 目錄層級）
// ---------------------------------------------------------------------------

const EXCLUDED_DIRS = new Set([
  'protocols',
  'templates',
  'worklogs',
  'worklog',
  'agents',
  '_log',
  '--agent',
  'test-agent',
])

/** 保留目錄名（大小寫不敏感）：非 agent / 非團隊的支援性目錄。 */
const RESERVED_DIR_NAMES = new Set(['worklog', 'worklogs', 'output', 'memory', 'node_modules'])

/**
 * 統一目錄排除判定 — 套用於三處：根層 team 掃描、team 層成員/子團隊掃描、純 .md fallback。
 * 規則：
 *   1. 以 `_` 或 `.` 開頭（如 _protocols / _shared / _log / .claude）→ 排除
 *   2. 保留名（大小寫不敏感）：worklog / worklogs / output / memory / node_modules → 排除
 */
function isExcludedDirName(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('.')) return true
  return RESERVED_DIR_NAMES.has(name.toLowerCase())
}

function isExcludedTeam(name: string): boolean {
  if (isExcludedDirName(name)) return true
  if (EXCLUDED_DIRS.has(name)) return true
  if (name.startsWith('audit-sys-')) return true
  return false
}

// ---------------------------------------------------------------------------
// 輕量 YAML parser（僅支援 agent.yaml 結構）
// ---------------------------------------------------------------------------

/**
 * 解析 agent.yaml 格式的輕量 parser。
 * 支援：
 *   - 頂層 key: value（含引號字串、裸字串、數字、布林）
 *   - 一層巢狀區塊（dispatch: 底下的 model/trigger/not_for）
 *   - 清單項（  - item）— 讀為第一個值字串
 * 不支援：多層嵌套、錨點、YAML 特殊型別。
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split(/\r?\n/)
  let currentBlock: string | null = null
  const blockData: Record<string, string> = {}

  const unquote = (s: string): string => {
    s = s.trim()
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1)
    }
    return s
  }

  for (const rawLine of lines) {
    // 跳過純註解行
    if (rawLine.trim().startsWith('#')) continue

    const indented = rawLine.startsWith('  ') || rawLine.startsWith('\t')

    if (indented && currentBlock !== null) {
      const trimmed = rawLine.trim()
      // 清單項
      if (trimmed.startsWith('- ')) {
        // 只取第一個清單值（bootstrap 等清單不需全部）
        const listVal = trimmed.slice(2).trim()
        if (!(currentBlock + '__list' in blockData)) {
          blockData[currentBlock + '__list'] = unquote(listVal)
        }
        continue
      }
      // 巢狀 key: value
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const k = trimmed.slice(0, colonIdx).trim()
        const v = trimmed.slice(colonIdx + 1).trim()
        blockData[currentBlock + '.' + k] = unquote(v)
      }
      continue
    }

    // 頂層行
    const colonIdx = rawLine.indexOf(':')
    if (colonIdx <= 0) continue
    const key = rawLine.slice(0, colonIdx).trim()
    const rest = rawLine.slice(colonIdx + 1).trim()

    if (rest === '' || rest === '|' || rest === '>') {
      // 新的巢狀區塊（無行內值）
      if (currentBlock !== null) {
        // 落地前一個 block
        result[currentBlock] = { ...blockData }
      }
      currentBlock = key
      Object.keys(blockData).forEach((k) => delete blockData[k])
    } else {
      // 行內值 → 頂層屬性
      if (currentBlock !== null) {
        result[currentBlock] = { ...blockData }
        currentBlock = null
        Object.keys(blockData).forEach((k) => delete blockData[k])
      }
      result[key] = unquote(rest)
    }
  }

  // 落地最後一個 block
  if (currentBlock !== null) {
    result[currentBlock] = { ...blockData }
  }

  return result
}

/** 從 parseSimpleYaml 結果中取巢狀字串欄位 */
function getNestedStr(obj: unknown, blockKey: string, subKey: string): string | null {
  if (typeof obj !== 'object' || obj === null) return null
  const block = (obj as Record<string, unknown>)[blockKey]
  if (typeof block !== 'object' || block === null) return null
  const val = (block as Record<string, unknown>)[blockKey + '.' + subKey]
  return typeof val === 'string' ? val : null
}

// ---------------------------------------------------------------------------
// 型別定義（對應 ipcContracts.ts 的 DTO；這裡是 internal，供服務層使用）
// ---------------------------------------------------------------------------

export interface AgentNode {
  /** teamId/agentName，如 'sw/developer' */
  id: string
  name: string
  title: string
  displayName: string | null
  type: 'worker' | 'manager' | 'director' | 'officer' | string
  roleInTeam: string | null
  model: string | null
  trigger: string | null
  notFor: string | null
  /**
   * 累計 worklog JSON 數量。
   * scan 時不計算（undefined）；getAgentDetail 才精確計算（單一 agent 一次 readdir 可接受）。
   */
  worklogCount?: number
}

export interface AgentTeam {
  /** team 路徑 id，如 'sw' 或 'platform/goose-ops' */
  id: string
  manager: AgentNode | null
  agents: AgentNode[]
  /**
   * 多來源團隊（docs/multi-source-teams.md Phase 1）：此團隊所屬來源識別碼。
   * 純掃描函式（scanAgentOrg）不設此欄（undefined）；由 backend wrapper 逐來源標記。
   * 預設來源恆為 'default'。
   */
  sourceId?: string
  /** 此團隊所屬來源的顯示名（由 backend wrapper 標記；純掃描不設）。 */
  sourceLabel?: string
}

export interface AgentOrgTree {
  teams: AgentTeam[]
  /** 掃描中遭遇「有 agent.yaml 但讀取/解析失敗」的相對路徑清單（相對於 rootPath）。 */
  parseWarnings?: string[]
}

export interface AgentDetail extends AgentNode {
  /** workflow.yaml 原文（找不到則 null） */
  workflowYaml: string | null
  /** soul.md 完整原文（找不到則 null；renderer 側做 markdown 渲染） */
  soulExcerpt: string | null
  /** introduction.json 結構化白話介紹（讀不到或 parse 失敗則 null） */
  introduction: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// worklogCount 計算（只在 getAgentDetail 呼叫；scan 不計算）
// ---------------------------------------------------------------------------

async function countWorklogFiles(agentDir: string): Promise<number> {
  try {
    const wlDir = path.join(agentDir, 'worklog')
    const entries = await fsp.readdir(wlDir)
    return entries.filter((e) => e.endsWith('.json')).length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// 解析單一 agent 目錄
// ---------------------------------------------------------------------------

async function parseAgentDir(
  teamId: string,
  agentDir: string,
  agentName: string,
  /** true = 同時計算 worklogCount（detail 路徑）；false = 不計算（scan 路徑效能考量） */
  withWorklogCount = false,
  /** 可選：收集解析失敗路徑（相對於 rootPath）的陣列；傳入時才記錄 */
  warnings?: string[],
  /** 相對路徑字串（供 warning 訊息用） */
  relPath?: string,
): Promise<AgentNode | null> {
  const yamlPath = path.join(agentDir, 'agent.yaml')
  let raw: Record<string, unknown>
  try {
    const content = await fsp.readFile(yamlPath, 'utf-8')
    raw = parseSimpleYaml(content)
  } catch (e) {
    console.warn(`[agentOrgService] skip ${yamlPath}:`, e)
    if (warnings !== undefined && relPath !== undefined) {
      warnings.push(relPath)
    }
    return null
  }

  const str = (k: string): string | null => {
    const v = raw[k]
    return typeof v === 'string' ? v : null
  }

  const name = str('agent') ?? agentName
  const title = str('title') ?? name
  const displayName = str('display_name')
  const type = str('type') ?? 'worker'
  const roleInTeam = str('role_in_team')
  const model = getNestedStr(raw, 'dispatch', 'model')
  const trigger = getNestedStr(raw, 'dispatch', 'trigger')
  const notFor = getNestedStr(raw, 'dispatch', 'not_for')
  // worklogCount 僅在 detail 路徑計算；scan 路徑省略（undefined）避免逐 agent readdir
  const worklogCount = withWorklogCount ? await countWorklogFiles(agentDir) : undefined

  return {
    id: `${teamId}/${name}`,
    name,
    title,
    displayName,
    type,
    roleInTeam,
    model,
    trigger,
    notFor,
    worklogCount,
  }
}

// ---------------------------------------------------------------------------
// 解析「純 .md agent 目錄」（Claude Code subagent 格式）
// ---------------------------------------------------------------------------

/** 排除不視為 agent 的 .md 檔名（大小寫不敏感比對）。 */
const MD_EXCLUDE = new Set(['readme.md', 'memory.md', 'skill.md'])

/**
 * 列出目錄內的 *.md 檔，每檔解析 frontmatter 中的 name: / description:，
 * 構造 AgentNode 陣列。
 * 無 frontmatter 或缺 name: 時以檔名（去副檔名）作為 name。
 */
async function parseMdAgents(teamId: string, dirPath: string): Promise<AgentNode[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const mdFiles = entries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && !MD_EXCLUDE.has(e.name.toLowerCase()),
  )

  const agents: AgentNode[] = []
  for (const mdFile of mdFiles) {
    const filePath = path.join(dirPath, mdFile.name)
    const baseName = mdFile.name.replace(/\.md$/i, '')

    let name = baseName
    let description = ''

    try {
      const content = await fsp.readFile(filePath, 'utf-8')
      // 解析 frontmatter（--- ... --- 塊開頭）
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (fmMatch) {
        const fmBlock = fmMatch[1]
        // 逐行提取 name: / description:
        for (const line of fmBlock.split(/\r?\n/)) {
          const nameMatch = line.match(/^name:\s*["']?(.+?)["']?\s*$/)
          if (nameMatch) {
            name = nameMatch[1].trim()
            continue
          }
          const descMatch = line.match(/^description:\s*["']?(.+?)["']?\s*$/)
          if (descMatch) {
            description = descMatch[1].trim()
          }
        }
      }
    } catch {
      // 讀取失敗時 name=baseName, description=''
    }

    // title = description 截前 60 字（無 description 則用 name）
    const title = description ? description.slice(0, 60) : name

    agents.push({
      id: `${teamId}/${name}`,
      name,
      title,
      displayName: name,
      type: 'worker',
      roleInTeam: null,
      model: null,
      trigger: null,
      notFor: null,
    })
  }

  return agents
}

// ---------------------------------------------------------------------------
// 掃描單一 team 目錄（支援一層巢狀子團隊）
// ---------------------------------------------------------------------------

async function scanTeamDir(
  teamId: string,
  teamDir: string,
  /** 收集解析失敗路徑的陣列（呼叫方初始化，此函式 push 進去） */
  warnings: string[],
  /** rootPath，用於計算相對路徑 warning 訊息 */
  rootPath: string,
): Promise<AgentTeam[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(teamDir, { withFileTypes: true })
  } catch {
    return []
  }

  const subdirs = entries.filter((e) => e.isDirectory())

  // 直接含 agent.yaml 的子目錄 → 一般 agent
  const directAgents: AgentNode[] = []
  // 不含 agent.yaml 的子目錄 → 可能是子團隊（再往下一層找 agent.yaml）
  const subTeamResults: AgentTeam[] = []

  for (const subdir of subdirs) {
    const subName = subdir.name
    // 統一排除：_protocols / _shared / worklog(s) / output 等不當成員、不當子團隊、不進純 .md fallback
    if (isExcludedDirName(subName)) continue

    const subPath = path.join(teamDir, subName)
    const yamlInSub = path.join(subPath, 'agent.yaml')

    // 用 fsp.access 替代 fs.existsSync
    const yamlExists = await fsp.access(yamlInSub).then(() => true).catch(() => false)
    if (yamlExists) {
      // 直接是 agent（withWorklogCount=false — scan 路徑不計算）
      const relYaml = path.relative(rootPath, yamlInSub)
      const node = await parseAgentDir(teamId, subPath, subName, false, warnings, relYaml)
      if (node) directAgents.push(node)
    } else {
      // 看看子目錄下面有沒有 agent.yaml（子團隊）
      let subEntries: fs.Dirent[]
      try {
        subEntries = await fsp.readdir(subPath, { withFileTypes: true })
      } catch {
        continue
      }
      // 逐一 access 檢查（子層 agent.yaml 存在性）
      const nestedChecks = await Promise.all(
        subEntries
          .filter((e) => e.isDirectory())
          .map(async (e) => fsp.access(path.join(subPath, e.name, 'agent.yaml')).then(() => true).catch(() => false)),
      )
      const hasNestedAgents = nestedChecks.some(Boolean)
      if (hasNestedAgents) {
        // 視為子團隊，攤平為獨立 team
        const subTeamId = `${teamId}/${subName}`
        const subTeams = await scanTeamDir(subTeamId, subPath, warnings, rootPath)
        subTeamResults.push(...subTeams)
      } else {
        // 無 agent.yaml 且無巢狀 agents → fallback：嘗試掃描 .md 檔（純 md agent 目錄）
        const mdAgents = await parseMdAgents(teamId, subPath)
        if (mdAgents.length > 0) {
          directAgents.push(...mdAgents)
        }
      }
    }
  }

  // 若目前層尚無 directAgents（即無 agent.yaml 子目錄），嘗試直接掃描 teamDir 本身的 .md 檔
  // 此情境：teamDir 直接放多個 *.md（無子目錄），即純 md-agent 目錄格式
  if (directAgents.length === 0 && subTeamResults.length === 0) {
    const mdAgentsDirect = await parseMdAgents(teamId, teamDir)
    if (mdAgentsDirect.length > 0) {
      return [{ id: teamId, manager: null, agents: mdAgentsDirect }]
    }
  }

  if (directAgents.length === 0 && subTeamResults.length > 0) {
    return subTeamResults
  }

  // 組 team（manager 與 agents 分開）
  const manager = directAgents.find((a) => a.type === 'manager') ?? null
  const agents = directAgents.filter((a) => a.type !== 'manager')

  const teams: AgentTeam[] = []
  if (directAgents.length > 0) {
    teams.push({ id: teamId, manager, agents })
  }
  teams.push(...subTeamResults)
  return teams
}

// ---------------------------------------------------------------------------
// 主要匯出函式
// ---------------------------------------------------------------------------

/**
 * 掃描 AgentOrg 目錄並回傳完整樹。
 * @param rootPath  agents/ 根目錄（如 'T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents'）
 * @throws {Error} rootPath 不可讀（目錄不存在 / Drive 未掛載）時拋錯，由 IPC router 包成 ok=false。
 */
export async function scanAgentOrg(rootPath: string): Promise<AgentOrgTree> {
  let topEntries: fs.Dirent[]
  try {
    topEntries = await fsp.readdir(rootPath, { withFileTypes: true })
  } catch (e) {
    throw new Error(`[agentOrgService] 無法讀取 AgentOrg 目錄 "${rootPath}"：${(e as Error).message ?? e}`)
  }

  const teams: AgentTeam[] = []
  const parseWarnings: string[] = []

  // 頂層直接有 .md 檔（無 team 子目錄結構）→ 組成一個 team，id 用根目錄資料夾名
  const topMdFiles = topEntries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && !MD_EXCLUDE.has(e.name.toLowerCase()),
  )
  if (topMdFiles.length > 0) {
    const rootDirName = path.basename(rootPath)
    const mdAgents = await parseMdAgents(rootDirName, rootPath)
    if (mdAgents.length > 0) {
      teams.push({ id: rootDirName, manager: null, agents: mdAgents })
    }
  }

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue
    const teamName = entry.name
    if (isExcludedTeam(teamName)) continue

    const teamPath = path.join(rootPath, teamName)
    const scanned = await scanTeamDir(teamName, teamPath, parseWarnings, rootPath)
    teams.push(...scanned)
  }

  return { teams, parseWarnings: parseWarnings.length > 0 ? parseWarnings : undefined }
}

/**
 * 讀取一個團隊 manager 的 introduction.json `flags` 是否含 `teamuq_agent_team_ui`。
 *
 * 此 flag 由 AgentTeams「快速建立」流程（agentTeamCreateService）寫入每個 agent 的
 * introduction.json。手寫 / 已正式化的團隊不帶此 flag。
 *
 * 回傳：
 *   true  — manager introduction.json 帶 `teamuq_agent_team_ui`（= 快速建立、待優化）
 *   false — 無此 flag（手寫團隊）／找不到 introduction.json／讀取/解析失敗
 *
 * @param rootPath agents/ 根目錄
 * @param teamId   team 路徑（可含 '/'，如 'sw' 或 'platform/goose-ops'）
 */
export async function isQuickCreatedTeam(rootPath: string, teamId: string): Promise<boolean> {
  const introPath = path.join(rootPath, ...teamId.split('/'), 'manager', 'introduction.json')
  try {
    const raw = await fsp.readFile(introPath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const flags = parsed['flags']
    return Array.isArray(flags) && flags.includes('teamuq_agent_team_ui')
  } catch {
    // 無 introduction.json / 解析失敗 → 視為非快速建立（不顯示待優化徽章）
    return false
  }
}

/**
 * 取得單一 agent 的詳細資料（含 workflow.yaml 原文 + soul.md 完整原文 + worklogCount）。
 * @param rootPath  agents/ 根目錄
 * @param teamId    team 路徑（如 'sw' 或 'platform/goose-ops'）
 * @param agentName agent 名稱（agent.yaml 中的 agent: 欄或目錄名）
 */
export async function getAgentDetail(
  rootPath: string,
  teamId: string,
  agentName: string,
): Promise<AgentDetail | null> {
  // teamId 可能含 '/'（子團隊），需分段解析 rootPath 下的路徑
  const agentDir = path.join(rootPath, ...teamId.split('/'), agentName)

  // withWorklogCount=true — detail 路徑精確計算
  const node = await parseAgentDir(teamId, agentDir, agentName, true)
  if (!node) return null

  // workflow.yaml
  let workflowYaml: string | null = null
  try {
    workflowYaml = await fsp.readFile(path.join(agentDir, 'workflow.yaml'), 'utf-8')
  } catch {
    // 無此檔不是錯誤
  }

  // soul.md — 完整原文（renderer 側做 markdown 渲染；抽屜可捲動）
  let soulExcerpt: string | null = null
  try {
    soulExcerpt = await fsp.readFile(path.join(agentDir, 'soul.md'), 'utf-8')
  } catch {
    // 無此檔不是錯誤
  }

  // introduction.json — 結構化白話介紹（讀不到或 parse 失敗 → null，不 throw）
  let introduction: Record<string, unknown> | null = null
  try {
    const raw = await fsp.readFile(path.join(agentDir, 'introduction.json'), 'utf-8')
    introduction = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // 無此檔或格式錯誤不是錯誤
  }

  return { ...node, workflowYaml, soulExcerpt, introduction }
}
