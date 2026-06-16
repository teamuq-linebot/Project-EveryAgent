/**
 * teamRegistrationService.ts — 團隊入口 skill 反查 + junction 連結服務
 *
 * 純 node:fs / node:path / node:os 邏輯，不碰 DB / better-sqlite3。
 * 所有匯出函式全面容錯（catch → 安全預設，永不 throw）。
 *
 * ⚠️ 禁 lazy require / 動態 import：所有 import 一律頂層（esbuild 不打包 → runtime 缺模組）。
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  PlatformResult,
  RegisterTeamResult,
  UnregisterTeamResult,
} from '../../shared/ipcContracts'
import { renderClaudeEntrySkill, renderRootResolutionBlock } from './agentTeamCreateService'
import { isQuickCreatedTeam } from './agentOrgService'

// ---------------------------------------------------------------------------
// 入口 skill 反查共用邏輯（resolveEntrySkill / buildTeamSkillNameMap 共用，避免行為漂移）
// ---------------------------------------------------------------------------

/**
 * teamId → 反查 needle（`agents/<normalizedTeamId>/manager`）。
 * teamId 中 `\` 正規化為 `/`（Windows 路徑分隔符容錯）。
 * 與 resolveEntrySkill 原行為逐字等義。
 */
function teamIdToNeedle(teamId: string): string {
  const normalizedTeamId = teamId.replace(/\\/g, '/')
  return `agents/${normalizedTeamId}/manager`
}

/** RegExp 特殊字元跳脫（teamId 可能含 `.`/`-` 等，需逐字當字面比對）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 判定某份 SKILL.md body 是否命中該 needle（needle = `agents/<teamId>/manager`）。
 * 比對前先把 body 的 `\` 正規化為 `/`（與 resolveEntrySkill 原行為逐字等義）。
 *
 * ⚠️ boundary-aware（修 P3 假命中）：純子字串 `includes(needle)` 會讓
 * 「最後一段為 manager」的子團隊（teamId=`a/manager`，body 含
 * `agents/a/manager/manager/agent.yaml`）誤命中父團隊 `a` 的 needle
 * `agents/a/manager`，把父隊反查到子隊的 skillName。
 *
 * 命中條件改成（任一成立即 true）：
 *   (a) `needle + '/'` 之後緊接的下一個路徑段是「檔名」（含副檔名，形如 `xxx.yyy`，
 *       如 agent.yaml/soul.md/org.md/tools.md/workflow.yaml）——即 manager 目錄下
 *       直接接 bootstrap 檔；子團隊那段 `agents/a/manager/manager/...` 對父 needle
 *       不成立（其後是 `manager`，無副檔名、以 `/` 收尾）。
 *   (b) `needle` 之後緊接「硬邊界」字元（行尾/空白/引號/反引號/`)`/`]`/`、`），即非 `/`
 *       收尾的字面引用。
 * 子 needle `agents/a/manager/manager` 仍經 (a) 命中（其後 `agent.yaml` 有副檔名）。
 */
function skillBodyMatchesNeedle(body: string, needle: string): boolean {
  const normalized = body.replace(/\\/g, '/')
  const escaped = escapeRegExp(needle)
  // (a) needle/<下一段為含副檔名的檔名>
  const fileRe = new RegExp(escaped + "/[^/\\s'\"`)]*\\.[^/\\s'\"`)]+")
  if (fileRe.test(normalized)) return true
  // (b) needle 後緊接硬邊界（行尾或非路徑字元），即非 `/` 收尾
  const boundaryRe = new RegExp(escaped + "($|[\\s'\"`)\\]、])")
  return boundaryRe.test(normalized)
}

// ---------------------------------------------------------------------------
// resolveEntrySkill
// ---------------------------------------------------------------------------

/**
 * 掃描 `<agentOrgRoot>/.claude/skills` 下子目錄的 SKILL.md，
 * 找出 body 含 `agents/<teamId>/manager` 字串（teamId 中 `\` 正規化為 `/`）的目錄。
 * 找到回 `{ skillName, skillDir }`；找不到回 null；任何 IO 例外回 null。
 */
export async function resolveEntrySkill(
  agentOrgRoot: string,
  teamId: string,
): Promise<{ skillName: string; skillDir: string } | null> {
  try {
    const skillsDir = path.join(agentOrgRoot, '.claude', 'skills')
    const needle = teamIdToNeedle(teamId)

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const body = await fs.promises.readFile(skillMdPath, 'utf8')
        if (skillBodyMatchesNeedle(body, needle)) {
          return {
            skillName: entry.name,
            skillDir: path.join(skillsDir, entry.name),
          }
        }
      } catch {
        // 讀單個 SKILL.md 失敗 → 略過此 entry
      }
    }

    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// buildTeamSkillNameMap — 掃一次 skills 目錄，建 teamId → skillName 映射
// ---------------------------------------------------------------------------

/**
 * 批次反查：**只 readdir 一次** `<agentOrgRoot>/.claude/skills` + 每個子目錄的 SKILL.md
 * 只讀一次（建 `skillDirName → body` 暫存），再對每個 teamId 用 resolveEntrySkill 同款
 * needle 比對找出命中的 skillDirName。
 *
 * 動機（效能）：原本 `_mergeStandardized` 對 N 隊各呼一次 inspectTeamPlatforms，
 * 後者內部 resolveEntrySkill 各自 readdir + 逐一 readFile 每個 SKILL.md，
 * 造成 N×M 次 fs I/O。本函式把 readdir/readFile 攤平成「掃一次（1×M）」，
 * 再對 N 隊純記憶體比對，I/O 從 N×M 降到 1×M。
 *
 * 等價性：單隊查 `map.get(teamId)` 與原 `resolveEntrySkill(agentOrgRoot, teamId).skillName`
 * 結果相同——同一份 needle/正規化/比對邏輯（teamIdToNeedle + skillBodyMatchesNeedle），
 * 且遍歷順序同為 readdir entries 順序（取第一個命中）。
 *
 * 全面容錯：readdir 失敗 → 所有 teamId 對 null；讀單個 SKILL.md 失敗 → 略過該目錄；
 * 任何例外 → 回「每個 teamId 皆 null」的 map，絕不 throw。
 *
 * @returns `Map<teamId, skillName|null>`（每個傳入的 teamId 都會有 entry）。
 */
export async function buildTeamSkillNameMap(
  agentOrgRoot: string,
  teamIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  // 預設每隊 null（即使後續任何步驟失敗也保證每個 teamId 都有 entry）
  for (const teamId of teamIds) result.set(teamId, null)

  try {
    const skillsDir = path.join(agentOrgRoot, '.claude', 'skills')

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
    } catch {
      // 目錄不存在/不可讀 → 全部維持 null（等同 resolveEntrySkill 回 null）
      return result
    }

    // 掃一次：建 skillDirName → body 暫存（保留 readdir 原順序，與 resolveEntrySkill 一致）
    const bodies: { skillName: string; body: string }[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const body = await fs.promises.readFile(skillMdPath, 'utf8')
        bodies.push({ skillName: entry.name, body })
      } catch {
        // 讀單個 SKILL.md 失敗 → 略過此 entry（與 resolveEntrySkill 一致）
      }
    }

    // 對每隊用同款 needle 比對；取第一個命中的 skillName（與 resolveEntrySkill 同序）
    for (const teamId of teamIds) {
      const needle = teamIdToNeedle(teamId)
      for (const { skillName, body } of bodies) {
        if (skillBodyMatchesNeedle(body, needle)) {
          result.set(teamId, skillName)
          break
        }
      }
    }

    return result
  } catch {
    return result
  }
}

// ---------------------------------------------------------------------------
// inspectTeamPlatforms — 三平台 skill 實際註冊狀態（唯讀，不寫檔）
// ---------------------------------------------------------------------------

/**
 * 三平台預設 skills 目錄 —— **單一真相來源**。
 *
 * inspect 端（inspectTeamPlatformsBySkill）與 register/unregister 端
 * （linkClaudeSkill / unlinkClaudeSkill / generateCodexSkill / removeCodexSkill /
 * generateAgySkill / removeAgySkill）的預設 skillsDir 全部取自此函式對應欄位，
 * 確保「徽章探測的路徑」與「實際連結/產生的路徑」永遠同源，任一端日後改路徑時
 * 不會讓徽章默默失準。注入用的 *SkillsDir 參數（測試 temp 目錄）優先於此預設。
 */
function defaultPlatformSkillsDirs(): {
  claude: string
  codex: string
  antigravity: string
} {
  const home = os.homedir()
  return {
    claude: path.join(home, '.claude', 'skills'),
    codex: path.join(home, '.agents', 'skills'),
    antigravity: path.join(home, '.gemini', 'antigravity-cli', 'skills'),
  }
}

/** 單一路徑存在性探測：存在→true、不存在/任何錯誤→false（永不 throw）。 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 唯讀純函式：給定（已反查好的）入口 skillName，算出該 skill 在三平台是否「實際已註冊」。
 *
 * 流程（即原 inspectTeamPlatforms 的「後半段」，不含 resolveEntrySkill 反查）：
 *   - skillName 為 null（找不到入口 skill）→ 三平台一律 false（無從判定 dst 路徑）。
 *   - 否則以三平台預設 skills 目錄 + skillName 組出 dst，各做一次 `fs.access`：
 *     存在→true、不存在/錯誤→false。
 *
 * 動機：把反查與探測拆開，讓批次掃描可先 `buildTeamSkillNameMap` 攤平 readdir/readFile，
 * 再對每隊用此函式做 N×3 次 fs.access，避免每隊重新 readdir 整個 skills 目錄。
 *
 * 全面容錯：任何例外 → 回三平台 false，絕不 throw（呼叫端在 Promise.all 中，
 * 單隊失敗不可炸掉整批掃描）。
 *
 * ⚠️ 唯讀：只用 fs.access 探測，不建立/覆寫任何 skill 檔。
 */
export async function inspectTeamPlatformsBySkill(
  skillName: string | null,
): Promise<{ claude: boolean; codex: boolean; antigravity: boolean }> {
  try {
    if (skillName === null) {
      return { claude: false, codex: false, antigravity: false }
    }
    const dirs = defaultPlatformSkillsDirs()
    const [claude, codex, antigravity] = await Promise.all([
      pathExists(path.join(dirs.claude, skillName)),
      pathExists(path.join(dirs.codex, skillName)),
      pathExists(path.join(dirs.antigravity, skillName)),
    ])
    return { claude, codex, antigravity }
  } catch {
    return { claude: false, codex: false, antigravity: false }
  }
}

/**
 * 唯讀純函式：算出某 team 在 claude / codex / antigravity 三平台是否「實際已註冊」。
 *
 * 流程：
 *   1. `resolveEntrySkill(agentOrgRoot, teamId)` 反查入口 skillName。
 *      - 回 null（找不到入口 skill）→ 三平台一律 false（無從判定 dst 路徑）。
 *   2. 委派 `inspectTeamPlatformsBySkill(skillName)`：以三平台預設 skills 目錄 + skillName
 *      組出 dst，各做一次 `fs.access`。
 *
 * 單隊用入口（批次掃描請改用 buildTeamSkillNameMap + inspectTeamPlatformsBySkill，
 * 避免每隊重新 readdir 整個 skills 目錄）。
 *
 * 全面容錯：任何例外（含 resolveEntrySkill 拋錯，雖其本身已內部 catch）→ 回三平台 false，
 * 絕不 throw（呼叫端在 Promise.all 中，單隊失敗不可炸掉整批掃描）。
 *
 * ⚠️ 唯讀：只用 fs.access 探測，不建立/覆寫任何 skill 檔。
 */
export async function inspectTeamPlatforms(
  agentOrgRoot: string,
  teamId: string,
): Promise<{ claude: boolean; codex: boolean; antigravity: boolean }> {
  try {
    const resolved = await resolveEntrySkill(agentOrgRoot, teamId)
    return inspectTeamPlatformsBySkill(resolved?.skillName ?? null)
  } catch {
    return { claude: false, codex: false, antigravity: false }
  }
}

// ---------------------------------------------------------------------------
// 可攜 SKILL.md body 組裝（codex / agy 共用）
// ---------------------------------------------------------------------------

/**
 * 從絕對 `managerDir`（`<agentOrgRoot>/agents/<teamId>/manager`）反推出相對於
 * `<ROOT>` 的可攜路徑 `agents/<teamId>/manager`（一律用 `/`）。
 *
 * needle 來源優先序：
 *   1. 若呼叫端傳入已知的完整 `teamId`（registerTeam 等都有），直接用
 *      `agents/<normalizedTeamId>/manager`（與 resolveEntrySkill 的 teamIdToNeedle
 *      同款 normalize）。子團隊（如 `platform/goose-ops`）的 needle 不會被截成 basename，
 *      與反查 needle `agents/platform/goose-ops/manager` 逐字一致。
 *   2. 未傳 teamId（無法得知完整 teamId 的舊路徑）→ 從 managerDir 反推：
 *      找出最後一個 `agents` 路徑段，自該段起取到結尾；找不到段時 fallback
 *      為 `agents/<basename>/manager` 形態（保底，確保仍含 needle）。
 */
function toPortableManagerPath(managerDir: string, teamId?: string): string {
  if (teamId !== undefined && teamId !== '') {
    // 與 teamIdToNeedle 同款 normalize：`\` → `/`，需求 needle 對子團隊完整保留
    return `agents/${teamId.replace(/\\/g, '/')}/manager`
  }
  const normalized = managerDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  const agentsIdx = segments.lastIndexOf('agents')
  if (agentsIdx !== -1 && agentsIdx < segments.length - 1) {
    return segments.slice(agentsIdx).join('/')
  }
  // fallback：保證輸出仍含 agents/.../manager needle
  return `agents/${segments.at(-1) ?? 'team'}/manager`
}

/**
 * 組可攜 SKILL.md body（codex / agy 共用）：
 * 「Step 0 定位 ROOT」+ bootstrap 用 `<ROOT>/agents/<teamId>/manager/...` 絕對路徑。
 * 不寫死掛載槽（T:），換機器／換掛載點仍可用。
 *
 * 🔒 保留字面字串 `agents/<teamId>/manager`（`relManagerDir`），供 resolveEntrySkill 反查。
 *    傳入 `teamId` 時直接用之組 needle（子團隊不被截成 basename）；未傳時從 managerDir 反推。
 */
function renderPortableManagerSkillBody(
  skillName: string,
  managerDir: string,
  teamId?: string,
): string {
  const relManagerDir = toPortableManagerPath(managerDir, teamId)
  return [
    '---',
    `name: ${skillName}`,
    `description: Use when you want the ${skillName} manager from AgentOrg to handle tasks for this team.`,
    '---',
    '',
    `# AgentOrg ${skillName} Manager`,
    '',
    '- Treat this skill as entering the manager role before responding.',
    // 🔒 硬約束：保留字面字串 agents/<teamId>/manager 供 resolveEntrySkill 反查（needle）。勿移除。
    `- Manager directory (relative to ROOT): ${relManagerDir}`,
    '',
    renderRootResolutionBlock(skillName),
    '',
    '## Bootstrap',
    '',
    '解出 `<ROOT>` 後，依序讀取下列檔案（一律用 `<ROOT>/` 絕對前綴，嚴禁相對路徑、嚴禁 search/Glob 亂找）：',
    `  1. \`<ROOT>/${relManagerDir}/agent.yaml\``,
    `  2. \`<ROOT>/${relManagerDir}/soul.md\``,
    `  3. \`<ROOT>/${relManagerDir}/org.md\``,
    `  4. \`<ROOT>/${relManagerDir}/tools.md\``,
    `  5. \`<ROOT>/${relManagerDir}/workflow.yaml\``,
    '',
    "- Follow that manager's scope, principles, dispatch rules, and workflow.",
    '- Speak as this manager for the conversation, not as a generic assistant.',
    "- If the task is outside this team's scope, say which team manager should take over.",
    '- Always respond in Traditional Chinese unless the user clearly asks for another language.',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// overwriteClaudeEntrySkill（claude 內容感知覆寫）
// ---------------------------------------------------------------------------

/**
 * 從既有 SKILL.md body 反推 team 顯示名（teamName）。
 *
 * 來源優先序：
 *   1. `# <teamName> Manager` 標題行（renderClaudeEntrySkill 的 heading）
 *   2. `description: Use when you want the <teamName> manager from AgentOrg` 行
 * 兩者皆抓不到時回 null（呼叫端 fallback 為 teamId）。
 */
function extractTeamName(body: string): string | null {
  const heading = body.match(/^#\s+(.+?)\s+Manager\s*$/m)
  if (heading && heading[1].trim()) return heading[1].trim()
  const desc = body.match(/description:\s*Use when you want the (.+?) manager from AgentOrg/i)
  if (desc && desc[1].trim()) return desc[1].trim()
  return null
}

/**
 * 內容感知覆寫 AgentOrg 端 claude 入口 SKILL.md
 * （`<agentOrgRoot>/.claude/skills/<skillName>/SKILL.md`，即 junction 來源）。
 *
 * 與 codex / agy 的 updated/skipped 模式一致：
 *   - 用 `renderClaudeEntrySkill` 產出新可攜版內容（Step 0 ROOT + `<ROOT>/agents/<teamId>/manager`
 *     絕對 bootstrap + needle 字面 `agents/<teamId>/manager`）。
 *   - teamName 從既有 SKILL.md body 反推（抓不到 fallback teamId）。
 *   - 讀現有檔，內容相同 → skip（不寫）；不同 → 覆寫。
 *
 * 全面容錯（catch → 安全預設，永不 throw）：來源檔不存在或寫入失敗都不阻斷 sync。
 * junction 由 linkClaudeSkill 另外建立，會直讀此處最新內容。
 *
 * 三態回傳（resolveEntrySkill 已保證 skillDir 存在）：
 *   - 'updated' — 內容不同，已覆寫
 *   - 'skipped' — 內容相同，未動
 *   - 'warning' — IO 失敗（graceful，不阻斷其他平台）
 */
async function overwriteClaudeEntrySkill(
  skillDir: string,
  skillName: string,
  teamId: string,
): Promise<'updated' | 'skipped' | 'warning'> {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md')

    let existing = ''
    try {
      existing = await fs.promises.readFile(skillMdPath, 'utf8')
    } catch {
      // 來源檔讀不到 → 仍嘗試寫出新版（teamName fallback teamId）
    }

    const teamName = extractTeamName(existing) ?? teamId
    const next = renderClaudeEntrySkill(teamId, teamName, skillName)

    if (existing === next) return 'skipped'

    await fs.promises.mkdir(skillDir, { recursive: true })
    await fs.promises.writeFile(skillMdPath, next, 'utf8')
    return 'updated'
  } catch {
    return 'warning'
  }
}

// ---------------------------------------------------------------------------
// linkClaudeSkill
// ---------------------------------------------------------------------------

/**
 * 把 `srcSkillDir` 以 junction/symlink 連結到 `<claudeSkillsDir>/<skillName>`。
 *
 * 三態回傳（RegistrationState）：
 *   - 'linked'  — 成功建立 junction/symlink
 *   - 'skipped' — dst 已是 symlink/junction（冪等）
 *   - 'warning' — dst 已是實體目錄，或建立失敗（帶 message）
 *
 * `claudeSkillsDir` 可選注入（測試用 temp 目錄）；預設 `~/.claude/skills`。
 */
export async function linkClaudeSkill(
  srcSkillDir: string,
  skillName: string,
  claudeSkillsDir?: string,
): Promise<PlatformResult> {
  const targetDir = claudeSkillsDir ?? defaultPlatformSkillsDirs().claude
  const dst = path.join(targetDir, skillName)

  try {
    // mkdir -p 目標目錄
    try {
      await fs.promises.mkdir(targetDir, { recursive: true })
    } catch {
      // mkdir 失敗不中止，後續 lstat 會再報
    }

    // 探測 dst 現狀
    let dstStat: fs.Stats | null = null
    let dstLstat: fs.Stats | null = null
    try {
      dstLstat = await fs.promises.lstat(dst)
      dstStat = await fs.promises.stat(dst)
    } catch {
      // dst 不存在 → lstat/stat 都會丟例外，維持 null
    }

    if (dstLstat !== null) {
      // 已存在
      if (dstLstat.isSymbolicLink() || (dstStat === null && dstLstat !== null)) {
        // symlink / junction（lstat.isDirectory() on Windows junction = true，但 lstat !== stat 指向不同 ino）
        // 保守判斷：只要 lstat 回傳即代表某種連結存在 → skipped
        return { state: 'skipped', skillName }
      }
      if (dstLstat.isDirectory()) {
        return { state: 'warning', skillName, message: `目的地 ${dst} 已是實體目錄，略過` }
      }
      // 其他情況（檔案）→ 視為 warning
      return { state: 'warning', skillName, message: `目的地 ${dst} 已存在（非目錄），略過` }
    }

    // dst 不存在 → 建立 junction / symlink
    const junctionType: 'junction' | 'dir' = process.platform === 'win32' ? 'junction' : 'dir'
    try {
      await fs.promises.symlink(srcSkillDir, dst, junctionType)
      return { state: 'linked', skillName }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { state: 'warning', skillName, message: `建立 junction 失敗：${msg}` }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `linkClaudeSkill 例外：${msg}` }
  }
}

// ---------------------------------------------------------------------------
// generateCodexSkill
// ---------------------------------------------------------------------------

/**
 * 在 codex user-level skills 目錄產生 `<skillName>/SKILL.md`（及 agents/openai.yaml）。
 *
 * 五態回傳（RegistrationState）：
 *   - 'created'  — 目錄不存在，新建並寫出
 *   - 'updated'  — 目錄已存在但無 marker（接管），或有 marker 且內容不同（覆寫）
 *   - 'skipped'  — 目錄已存在（含 marker），內容相同，不動
 *   - 'warning'  — IO 失敗
 *
 * `codexSkillsDir` 可選注入（測試用 temp 目錄）；
 * 預設取自 `defaultPlatformSkillsDirs().codex`（與 inspect 同源；現為 `~/.agents/skills`）。
 *
 * `teamId` 可選：傳入時 needle 直接用 `agents/<teamId>/manager`（子團隊不被截成 basename，
 * 與 resolveEntrySkill 反查 needle 逐字一致）；未傳時從 managerDir 反推（保底，相容舊呼叫）。
 */
export async function generateCodexSkill(
  skillName: string,
  managerDir: string,
  codexSkillsDir?: string,
  teamId?: string,
): Promise<PlatformResult> {
  try {
    const skillsDir = codexSkillsDir ?? defaultPlatformSkillsDirs().codex

    const skillDir = path.join(skillsDir, skillName)
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const markerPath = path.join(skillDir, '.teamuq-managed')
    const openaiYamlPath = path.join(skillDir, 'agents', 'openai.yaml')

    // 組合將要寫出的 SKILL.md 內容（可攜：Step 0 定位 ROOT + <ROOT>/agents/<teamId>/manager 絕對路徑）
    const skillMdContent = renderPortableManagerSkillBody(skillName, managerDir, teamId)

    // 組合 agents/openai.yaml 內容
    const openaiYamlContent = [
      'interface:',
      `  display_name: "${skillName}"`,
      `  short_description: "Handle tasks via AgentOrg ${skillName} manager"`,
      `  default_prompt: "Handle this task as the AgentOrg ${skillName} manager."`,
      '',
    ].join('\n')

    // 探測目錄現狀
    let dirExists = false
    try {
      await fs.promises.stat(skillDir)
      dirExists = true
    } catch {
      // 不存在
    }

    if (dirExists) {
      // 確認是否有 marker
      let hasMarker = false
      try {
        await fs.promises.stat(markerPath)
        hasMarker = true
      } catch {
        // 無 marker
      }

      if (!hasMarker) {
        // 無 marker（如 npx skills 安裝的既有 skill）→ 接管：覆寫成 App 版並寫入 marker
        await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
        await fs.promises.mkdir(path.dirname(openaiYamlPath), { recursive: true })
        await fs.promises.writeFile(openaiYamlPath, openaiYamlContent, 'utf8')
        await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
        return { state: 'updated', skillName }
      }

      // 有 marker → 比對內容
      let existingContent = ''
      try {
        existingContent = await fs.promises.readFile(skillMdPath, 'utf8')
      } catch {
        // 讀失敗也視為需要寫出
      }

      if (existingContent === skillMdContent) {
        return { state: 'skipped', skillName }
      }

      // 內容不同 → 覆寫
      await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
      await fs.promises.mkdir(path.dirname(openaiYamlPath), { recursive: true })
      await fs.promises.writeFile(openaiYamlPath, openaiYamlContent, 'utf8')
      await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
      return { state: 'updated', skillName }
    }

    // 目錄不存在 → 建立
    await fs.promises.mkdir(path.join(skillDir, 'agents'), { recursive: true })
    await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
    await fs.promises.writeFile(openaiYamlPath, openaiYamlContent, 'utf8')
    await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
    return { state: 'created', skillName }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `generateCodexSkill 例外：${msg}` }
  }
}

// ---------------------------------------------------------------------------
// registerTeam
// ---------------------------------------------------------------------------

/**
 * 把一個 team 的入口 skill 連結到各平台的 skills 目錄。
 *
 * @param agentsRoot — `_resolveAgentOrgRoot()` 回傳值（含尾段 `agents`）
 * @param teamId     — team 識別碼（如 `sw`、`platform/goose-ops`）
 * @param platforms  — 支援 `'claude'`（junction）、`'codex'`（產生 SKILL.md）、`'antigravity'`（agy skill）；預設 `['claude']`
 */
export async function registerTeam(
  agentsRoot: string,
  teamId: string,
  platforms: ('claude' | 'codex' | 'antigravity')[] = ['claude'],
): Promise<RegisterTeamResult> {
  try {
    // 去掉尾段 agents（不論 / 或 \，單層）得 agentOrgRoot
    const agentOrgRoot = agentsRoot.replace(/[/\\]agents[/\\]?$/, '')

    const resolved = await resolveEntrySkill(agentOrgRoot, teamId)
    if (resolved === null) {
      return { teamId, skillName: null }
    }

    const { skillName, skillDir } = resolved
    const result: RegisterTeamResult = { teamId, skillName }

    if (platforms.includes('claude')) {
      // 守門：只有「UI 快速建立的團隊」才覆寫 AgentOrg 端 claude SKILL.md。
      //
      // 為何：claude skill 走 junction 直連 AgentOrg 端
      //   `<agentOrgRoot>/.claude/skills/<skillName>/SKILL.md`。
      // 手寫團隊（sw→tuq-dev、finance→tuq-bill 等）那份是人工撰寫的豐富內容
      // （含 manager dispatch 流程、workflow 路由、角色說明）。overwriteClaudeEntrySkill
      // 用 renderClaudeEntrySkill 產的是陽春自動格式，對手寫團隊覆寫會弄壞 /tuq-dev 等 skill。
      //
      // isQuickCreatedTeam 讀該團隊 manager 的 introduction.json `flags` 是否含
      // `teamuq_agent_team_ui`（只有 agentTeamCreateService 快速建立流程會寫入）。
      //   true  → UI 快速建立（如 mddr）：照常覆寫（升級陽春→可攜陽春，本就 App 管的）。
      //   false → 手寫團隊：完全跳過覆寫，絕不碰 AgentOrg 端那份豐富 SKILL.md。
      // graceful：isQuickCreatedTeam 內部讀檔失敗時回 false → 保守視為非快速建立 → 跳過覆寫
      //           （寧可不升級也不要誤刪手寫內容）。
      // 註：isQuickCreatedTeam 第一參數需 agents/ 根目錄，即 agentsRoot（含尾段 agents），非去尾的 agentOrgRoot。
      const quickCreated = await isQuickCreatedTeam(agentsRoot, teamId)
      if (quickCreated) {
        // 先內容感知覆寫 AgentOrg 端 claude SKILL.md（junction 來源），
        // 把快速建立團隊更新到新可攜版（Step 0 ROOT + <ROOT>/ 絕對 bootstrap）。
        // 失敗不阻斷後續 junction 與其他平台。
        await overwriteClaudeEntrySkill(skillDir, skillName, teamId)
      }
      // 建 junction（直讀來源最新內容；手寫團隊不覆寫，junction 直連豐富版）。
      result.claude = await linkClaudeSkill(skillDir, skillName)
    }

    if (platforms.includes('codex')) {
      const managerDir = path.join(agentOrgRoot, 'agents', teamId, 'manager')
      // 傳入完整 teamId：子團隊 needle 直接用 agents/<teamId>/manager，避免 basename 失配
      result.codex = await generateCodexSkill(skillName, managerDir, undefined, teamId)
    }

    if (platforms.includes('antigravity')) {
      // agy 支援 ~/.gemini/antigravity-cli/skills/ 全域 skills（SKILL.md 格式）
      // 研究結論：feasible=skills，機制與 codex 相容，skill 前綴符號為 /
      // 詳見 team-registration-agy-research-20260611
      const managerDir = path.join(agentOrgRoot, 'agents', teamId, 'manager')
      // 傳入完整 teamId：子團隊 needle 直接用 agents/<teamId>/manager，避免 basename 失配
      result.agy = await generateAgySkill(skillName, managerDir, undefined, teamId)
    }

    return result
  } catch (e) {
    // 頂層容錯：回傳 warning 狀態
    const msg = e instanceof Error ? e.message : String(e)
    return {
      teamId,
      skillName: null,
      claude: { state: 'warning', skillName: '', message: `registerTeam 例外：${msg}` },
    }
  }
}

// ---------------------------------------------------------------------------
// syncTeam
// ---------------------------------------------------------------------------

/**
 * 同步一個 team 的入口 skill 到各平台（語意上等同於「重跑 register 的冪等更新」）。
 *
 * @param agentsRoot — `_resolveAgentOrgRoot()` 回傳值（含尾段 `agents`）
 * @param teamId     — team 識別碼（如 `sw`、`platform/goose-ops`）
 * @param platforms  — 要同步的平台；預設 `['claude', 'codex']`（兩個都同步）
 *
 * ### 與 `registerTeam` 的等價關係
 * `syncTeam` **直接委派** `registerTeam`，兩者行為完全相同。
 * 暴露獨立名稱的目的是讓 UI 擁有一個語意明確的「更新/同步」動作入口，
 * 而不必重用「首次連結」語意的 `register`。
 *
 * ### 為何 claude 永遠 live
 * Claude platform 走 **junction/symlink**：dst 指向 src（AgentOrg 的 skill 目錄），
 * 任何時刻讀 dst 都直接讀到 src 的最新內容，無需複製或覆寫。
 * 因此「同步 claude」只需確認 junction 存在（已存在 → `skipped`，不存在才 `linked`），
 * 不需要做任何額外的內容更新步驟。
 * codex 平台則會比對 SKILL.md 內容：相同 → `skipped`，不同 → `updated`。
 */
export async function syncTeam(
  agentsRoot: string,
  teamId: string,
  platforms: ('claude' | 'codex' | 'antigravity')[] = ['claude', 'codex'],
): Promise<RegisterTeamResult> {
  return registerTeam(agentsRoot, teamId, platforms)
}

// ---------------------------------------------------------------------------
// unlinkClaudeSkill
// ---------------------------------------------------------------------------

/**
 * 移除 `<claudeSkillsDir>/<skillName>` 處的 junction/symlink。
 *
 * ⚠️ 安全規則：只呼 `unlink`（失敗 fallback `rmdir`，無 recursive），
 * 絕對不呼 `fs.rm(..., { recursive })` — 否則 Windows junction 會順著連結
 * 遞迴刪掉 AgentOrg 真實來源目錄的所有檔案。
 *
 * 四態回傳（RegistrationState）：
 *   - 'skipped'  — dst 不存在（本來就沒裝）
 *   - 'unlinked' — 成功移除 junction/symlink
 *   - 'warning'  — dst 是實體目錄（非連結），或 IO 例外
 */
export async function unlinkClaudeSkill(
  skillName: string,
  claudeSkillsDir?: string,
): Promise<PlatformResult> {
  const targetDir = claudeSkillsDir ?? defaultPlatformSkillsDirs().claude
  const dst = path.join(targetDir, skillName)

  try {
    // 先探測 dst 是否存在
    let lstatResult: fs.Stats | null = null
    try {
      lstatResult = await fs.promises.lstat(dst)
    } catch {
      // ENOENT → dst 不存在
      return { state: 'skipped', skillName }
    }

    // 判斷是否為 symlink / junction
    // Windows junction：lstat().isSymbolicLink() = false, isDirectory() = true
    // Unix symlink：lstat().isSymbolicLink() = true
    // 實體目錄：lstat().isSymbolicLink() = false, isDirectory() = true
    // 區分 junction vs 實體目錄的方式：stat()（follow link）是否與 lstat() 的 ino 相同。
    // 最保守的判斷：先嘗試 stat（follow），若 stat 拋 ENOENT（來源已消失）或 ino 不同 → 視為連結。
    // 若 lstat.isSymbolicLink() = true → 確定是 symlink。

    if (lstatResult.isSymbolicLink()) {
      // Unix symlink 或部分 Windows symlink
      return await _doUnlink(dst, skillName)
    }

    if (lstatResult.isDirectory()) {
      // 可能是 Windows junction 或實體目錄；用 stat().ino 與 lstat().ino 比對
      let statResult: fs.Stats | null = null
      try {
        statResult = await fs.promises.stat(dst)
      } catch {
        // stat 拋例外（如來源已消失）→ 確認是 junction
        return await _doUnlink(dst, skillName)
      }

      if (statResult.ino !== lstatResult.ino) {
        // ino 不同 → junction（reparse point）
        return await _doUnlink(dst, skillName)
      }

      // ino 相同 → 實體目錄，不動
      return {
        state: 'warning',
        skillName,
        message: `目標 ${dst} 為實體目錄非連結，未刪`,
      }
    }

    // 其他情況（普通檔案等）→ warning
    return {
      state: 'warning',
      skillName,
      message: `目標 ${dst} 為非目錄檔案，未刪`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `unlinkClaudeSkill 例外：${msg}` }
  }
}

/** 共用移除邏輯：unlink → 若 EPERM/EISDIR fallback rmdir（無 recursive）。 */
async function _doUnlink(dst: string, skillName: string): Promise<PlatformResult> {
  try {
    await fs.promises.unlink(dst)
    return { state: 'unlinked', skillName }
  } catch (unlinkErr) {
    // Windows junction 可能回 EPERM / EISDIR → fallback rmdir（不帶 recursive）
    try {
      await fs.promises.rmdir(dst)
      return { state: 'unlinked', skillName }
    } catch (rmdirErr) {
      const msg = rmdirErr instanceof Error ? rmdirErr.message : String(rmdirErr)
      return { state: 'warning', skillName, message: `移除連結失敗：${msg}` }
    }
  }
}

// ---------------------------------------------------------------------------
// removeCodexSkill
// ---------------------------------------------------------------------------

/**
 * 移除 `<codexSkillsDir>/<skillName>` 實體目錄（使用者明確點刪除，不論有無 marker）。
 * 安全界線：只刪 `<codexSkillsDir>/<skillName>` 單一目錄，不 glob、不刪其他 skill。
 *
 * 三態回傳（RegistrationState）：
 *   - 'skipped' — dst 不存在
 *   - 'removed' — 成功刪除（不論有無 marker）
 *   - 'warning' — IO 例外
 *
 * `codexSkillsDir` 可選注入（測試用 temp 目錄）；
 * 預設：`~/.agents/skills`（codex 官方使用者層 skills 目錄）。
 */
export async function removeCodexSkill(
  skillName: string,
  codexSkillsDir?: string,
): Promise<PlatformResult> {
  try {
    const skillsDir = codexSkillsDir ?? defaultPlatformSkillsDirs().codex

    const dst = path.join(skillsDir, skillName)
    const markerPath = path.join(dst, '.teamuq-managed')

    // 確認目錄存在
    try {
      await fs.promises.stat(dst)
    } catch {
      return { state: 'skipped', skillName }
    }

    // 確認有 marker
    let hasMarker = false
    try {
      await fs.promises.stat(markerPath)
      hasMarker = true
    } catch {
      // 無 marker
    }

    // 不論有無 marker，使用者明確點刪除 → 直接刪除該單一目錄
    await fs.promises.rm(dst, { recursive: true })
    return { state: 'removed', skillName }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `removeCodexSkill 例外：${msg}` }
  }
}

// ---------------------------------------------------------------------------
// generateAgySkill
// ---------------------------------------------------------------------------

/**
 * 在 agy 全域 skills 目錄產生 `<skillName>/SKILL.md`。
 *
 * 機制依據：agy 透過 ~/.gemini/antigravity-cli/skills/ 載入全域 skills（SKILL.md 格式
 * 與 codex 相同：YAML frontmatter `name` + `description` + Markdown body）。
 * 使用者可在 TUI 內以 `/skill-name` 觸發。
 * 詳見 team-registration-agy-research-20260611。
 *
 * 五態回傳（RegistrationState）：
 *   - 'created'  — 目錄不存在，新建並寫出
 *   - 'updated'  — 目錄已存在有 marker 但內容不同，或無 marker（接管），覆寫
 *   - 'skipped'  — 有 marker 且內容相同，不動
 *   - 'warning'  — IO 失敗
 *
 * `agySkillsDir` 可選注入（測試用 temp 目錄）；
 * 預設取自 `defaultPlatformSkillsDirs().antigravity`（與 inspect 同源；現為
 * `~/.gemini/antigravity-cli/skills/`）。
 *
 * `teamId` 可選：傳入時 needle 直接用 `agents/<teamId>/manager`（子團隊不被截成 basename，
 * 與 resolveEntrySkill 反查 needle 逐字一致）；未傳時從 managerDir 反推（保底，相容舊呼叫）。
 */
export async function generateAgySkill(
  skillName: string,
  managerDir: string,
  agySkillsDir?: string,
  teamId?: string,
): Promise<PlatformResult> {
  try {
    const skillsDir = agySkillsDir ?? defaultPlatformSkillsDirs().antigravity

    const skillDir = path.join(skillsDir, skillName)
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const markerPath = path.join(skillDir, '.teamuq-managed')

    // SKILL.md 內容（可攜：Step 0 定位 ROOT + <ROOT>/agents/<teamId>/manager 絕對路徑；與 codex 格式對齊）
    const skillMdContent = renderPortableManagerSkillBody(skillName, managerDir, teamId)

    // 探測目錄現狀
    let dirExists = false
    try {
      await fs.promises.stat(skillDir)
      dirExists = true
    } catch {
      // 不存在
    }

    if (dirExists) {
      let hasMarker = false
      try {
        await fs.promises.stat(markerPath)
        hasMarker = true
      } catch {
        // 無 marker
      }

      if (!hasMarker) {
        // 無 marker → 接管：覆寫並寫入 marker
        await fs.promises.mkdir(skillDir, { recursive: true })
        await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
        await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
        return { state: 'updated', skillName }
      }

      // 有 marker → 比對內容
      let existingContent = ''
      try {
        existingContent = await fs.promises.readFile(skillMdPath, 'utf8')
      } catch {
        // 讀失敗也視為需要寫出
      }

      if (existingContent === skillMdContent) {
        return { state: 'skipped', skillName }
      }

      // 內容不同 → 覆寫
      await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
      await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
      return { state: 'updated', skillName }
    }

    // 目錄不存在 → 建立
    await fs.promises.mkdir(skillDir, { recursive: true })
    await fs.promises.writeFile(skillMdPath, skillMdContent, 'utf8')
    await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8')
    return { state: 'created', skillName }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `generateAgySkill 例外：${msg}` }
  }
}

// ---------------------------------------------------------------------------
// removeAgySkill
// ---------------------------------------------------------------------------

/**
 * 移除 `<agySkillsDir>/<skillName>` 實體目錄（含 .teamuq-managed marker）。
 * 安全界線：只刪 `<agySkillsDir>/<skillName>` 單一目錄，不 glob、不刪其他 skill。
 *
 * 三態回傳（RegistrationState）：
 *   - 'skipped' — dst 不存在
 *   - 'removed' — 成功刪除
 *   - 'warning' — IO 例外
 *
 * `agySkillsDir` 可選注入（測試用 temp 目錄）；
 * 預設：`~/.gemini/antigravity-cli/skills/`（agy CLI 全域 skills 目錄）。
 */
export async function removeAgySkill(
  skillName: string,
  agySkillsDir?: string,
): Promise<PlatformResult> {
  try {
    const skillsDir = agySkillsDir ?? defaultPlatformSkillsDirs().antigravity

    const dst = path.join(skillsDir, skillName)

    // 確認目錄存在
    try {
      await fs.promises.stat(dst)
    } catch {
      return { state: 'skipped', skillName }
    }

    await fs.promises.rm(dst, { recursive: true })
    return { state: 'removed', skillName }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { state: 'warning', skillName, message: `removeAgySkill 例外：${msg}` }
  }
}

// ---------------------------------------------------------------------------
// unregisterTeam
// ---------------------------------------------------------------------------

/**
 * 移除一個 team 的入口 skill 連結與/或 codex 產生物。
 *
 * @param agentsRoot — `_resolveAgentOrgRoot()` 回傳值（含尾段 `agents`）
 * @param target     — teamId 或 skillName（至少一個）
 * @param platforms  — 要移除的平台（預設 `['claude', 'codex']`）
 */
export async function unregisterTeam(
  agentsRoot: string,
  target: { teamId?: string; skillName?: string },
  platforms: ('claude' | 'codex' | 'antigravity')[] = ['claude', 'codex'],
): Promise<UnregisterTeamResult> {
  try {
    // 取得 skillName
    let skillName: string | null = target.skillName ?? null

    if (!skillName && target.teamId) {
      // 去掉尾段 agents 得 agentOrgRoot，再反查入口 skill
      const agentOrgRoot = agentsRoot.replace(/[/\\]agents[/\\]?$/, '')
      const resolved = await resolveEntrySkill(agentOrgRoot, target.teamId)
      if (resolved !== null) {
        skillName = resolved.skillName
      }
    }

    if (!skillName) {
      // 無法取得 skillName → 回傳空結果
      return { teamId: target.teamId ?? null, skillName: null }
    }

    const result: UnregisterTeamResult = {
      teamId: target.teamId ?? null,
      skillName,
    }

    if (platforms.includes('claude')) {
      result.claude = await unlinkClaudeSkill(skillName)
    }

    if (platforms.includes('codex')) {
      result.codex = await removeCodexSkill(skillName)
    }

    if (platforms.includes('antigravity')) {
      // agy 全域 skills 目錄移除（~/.gemini/antigravity-cli/skills/<skillName>）
      // 詳見 team-registration-agy-research-20260611
      result.agy = await removeAgySkill(skillName)
    }

    return result
  } catch (e) {
    // 頂層容錯
    const msg = e instanceof Error ? e.message : String(e)
    return {
      teamId: target.teamId ?? null,
      skillName: target.skillName ?? null,
      claude: { state: 'warning', skillName: target.skillName ?? '', message: `unregisterTeam 例外：${msg}` },
    }
  }
}
