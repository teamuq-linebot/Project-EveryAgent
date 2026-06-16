/**
 * teamRelocationService.ts — 單隊「實體搬移」服務（plan_v2 §2「行為乙」）
 *
 * 純 node:fs / node:path + 委派 teamRegistrationService（不碰 DB / better-sqlite3）。
 * DB rekey / settings 改寫由上層 AgentTeamsService 串接（本服務只負責「檔案搬移 + skill 重建編排」）。
 *
 * 嚴格時序（plan_v2 §2.3，避免毀資料）：
 *   precheck（反查 skillName + 目標衝突偵測）
 *     → unlink 舊三平台（趁舊檔在、反查得到 skillName）
 *     → copyVerify 搬 agents 團隊資料夾 <fromSourceRoot>/<teamPath>
 *     → copyVerify 搬 claude 入口 skill 目錄 <fromSourceRoot>/../.claude/skills/<skillName>
 *     → registerTeam 在新來源重建三平台
 *     → cleanup 刪舊來源 skill（安全版：刪前再反查確認無他隊命中此 skillName）
 *
 * 回滾（plan_v2 §5.1）：
 *   - precheck 失敗：未動任何檔/連結 → 直接失敗。
 *   - copy/verify 失敗：刪半拷目標（agents + skill）+ 重新 register 舊來源恢復原狀。
 *   - register（新來源）部分平台失敗：不回滾檔案（已安全在新來源）→ 仍算搬移成功、帶 warning。
 *   - cleanup 失敗：不回滾（搬移已成功）→ warning。
 *
 * ⚠️ 禁 lazy require / 動態 import：所有 import 一律頂層（esbuild 不打包 → runtime 缺模組）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  RegisterTeamResult,
  UnregisterTeamResult,
} from '../../shared/ipcContracts'
import {
  registerTeam as defaultRegisterTeam,
  unregisterTeam as defaultUnregisterTeam,
  resolveEntrySkill as defaultResolveEntrySkill,
} from './teamRegistrationService'
import {
  copyVerify,
  copyVerifyKeepSource,
  pathExists,
  rmQuiet,
  verifyTreesMatch,
} from './fsMoveHelpers'

type Platform = 'claude' | 'codex' | 'antigravity'

// ---------------------------------------------------------------------------
// 公開型別（plan_v2 §2.1，逐字照設計）
// ---------------------------------------------------------------------------

export interface RelocateTeamInput {
  /** 純團隊路徑（teamPathPart，可含 '/' 子團隊）。 */
  teamPath: string
  /** 舊來源 agents 根（含尾段 agents）。 */
  fromSourceRoot: string
  /** 新來源 agents 根（含尾段 agents）。 */
  toSourceRoot: string
  platforms: Platform[]
}

export interface RelocateTeamResult {
  teamPath: string
  ok: boolean
  phase: 'precheck' | 'unlink' | 'copy' | 'verify' | 'register' | 'cleanup' | 'done'
  /** 白話失敗/警告原因（呼叫端轉 UI）。 */
  message?: string
  /** 反查到的入口 skillName（cleanup/register 用；null=該來源無入口 skill）。 */
  skillName: string | null
  /** 是否已完成檔案搬移（用於回滾/冪等判定）。 */
  filesMoved: boolean
}

/**
 * 可注入依賴（預設用真 teamRegistrationService）。
 * 測試注入 stub 以驗「嚴格時序 + 回滾路徑」而不碰 ~/.claude 真實檔。
 */
export interface RelocationDeps {
  resolveEntrySkill: typeof defaultResolveEntrySkill
  registerTeam: typeof defaultRegisterTeam
  unregisterTeam: typeof defaultUnregisterTeam
}

const REAL_DEPS: RelocationDeps = {
  resolveEntrySkill: defaultResolveEntrySkill,
  registerTeam: defaultRegisterTeam,
  unregisterTeam: defaultUnregisterTeam,
}

// ---------------------------------------------------------------------------
// 路徑推導 helper
// ---------------------------------------------------------------------------

/** agents 根（含尾段 agents）去掉尾段 → agentOrgRoot（與 registerTeam 內部去尾規則一致）。 */
function agentOrgRootOf(sourceRoot: string): string {
  return sourceRoot.replace(/[/\\]agents[/\\]?$/, '')
}

/** 團隊 agents 資料夾：<sourceRoot>/<teamPath>（teamPath 可含 '/' 子團隊）。 */
function teamAgentsDir(sourceRoot: string, teamPath: string): string {
  return path.join(sourceRoot, ...teamPath.split('/').filter(Boolean))
}

/** claude 入口 skill 目錄：<agentOrgRoot>/.claude/skills/<skillName>（與 agents 同層、不在 teamPath 下）。 */
function claudeSkillDir(sourceRoot: string, skillName: string): string {
  return path.join(agentOrgRootOf(sourceRoot), '.claude', 'skills', skillName)
}

// ---------------------------------------------------------------------------
// relocateTeam — 單隊原子搬移（plan_v2 §2.3 嚴格時序）
// ---------------------------------------------------------------------------

/**
 * 把單一團隊從 fromSourceRoot 實體搬到 toSourceRoot（含 agents 夾 + claude 入口 skill）並重建三平台連結。
 *
 * @param input  RelocateTeamInput（teamPath / from / to / platforms）
 * @param deps   可注入依賴（預設真 teamRegistrationService）；測試注入 stub。
 * @returns RelocateTeamResult；ok:true 代表「檔案已安全在新來源」（含部分平台未連的情形）。
 */
export async function relocateTeam(
  input: RelocateTeamInput,
  deps: RelocationDeps = REAL_DEPS,
): Promise<RelocateTeamResult> {
  const { teamPath, fromSourceRoot, toSourceRoot, platforms } = input

  // agent-ops 保守早退（上層應已排除；落點寫死 .teamuq，永不搬）。
  if (teamPath === 'agent-ops') {
    return {
      teamPath,
      ok: false,
      phase: 'precheck',
      message: '系統內建團隊（agent-ops）不可搬移',
      skillName: null,
      filesMoved: false,
    }
  }

  const fromAgentOrgRoot = agentOrgRootOf(fromSourceRoot)
  const srcAgentsDir = teamAgentsDir(fromSourceRoot, teamPath)
  const dstAgentsDir = teamAgentsDir(toSourceRoot, teamPath)

  // ===== Phase precheck =====
  // 0. 反查舊來源入口 skillName（趁舊檔還在）。null → 仍可搬 agents 檔，register 階段略過 skill。
  let skillName: string | null = null
  try {
    const resolved = await deps.resolveEntrySkill(fromAgentOrgRoot, teamPath)
    skillName = resolved?.skillName ?? null
  } catch {
    skillName = null
  }

  // 1. 目標衝突偵測：目標 agents 夾已存在 → 直接失敗，不動任何東西（plan_v2 §4 雙保險之一）。
  if (await pathExists(dstAgentsDir)) {
    return {
      teamPath,
      ok: false,
      phase: 'precheck',
      message: `目標來源已存在同名團隊「${teamPath.split('/').pop()}」，為避免覆蓋，未搬移此團隊`,
      skillName,
      filesMoved: false,
    }
  }

  // ===== Phase unlink（先斷舊平台連結，趁舊檔還在、反查得到 skillName） =====
  if (skillName !== null) {
    let unlinkResult: UnregisterTeamResult | null = null
    try {
      unlinkResult = await deps.unregisterTeam(
        fromSourceRoot,
        { teamId: teamPath, skillName },
        platforms,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        teamPath,
        ok: false,
        phase: 'unlink',
        message: `移除舊平台連結失敗：${msg}`,
        skillName,
        filesMoved: false,
      }
    }
    void unlinkResult // unlink 為冪等可重建，部分 warning 不阻斷搬移
  }

  // ===== Phase copy + verify（搬 agents 團隊資料夾） =====
  const copyAgents = await copyVerify(srcAgentsDir, dstAgentsDir)
  if (!copyAgents.ok) {
    // 回滾：刪半拷目標 agents + 重新 register 舊來源（把剛 unlink 的連回去，恢復原狀）。
    await rmQuiet(dstAgentsDir)
    await reRegisterOldSource(deps, fromSourceRoot, teamPath, skillName, platforms)
    return {
      teamPath,
      ok: false,
      phase: copyAgents.phase === 'copy' ? 'copy' : 'verify',
      message: copyAgents.message,
      skillName,
      filesMoved: false,
    }
  }
  // copyAgents.ok 且 phase==='cleanup' 代表 agents 已搬到目標但舊位置殘留 → 仍續行（資料已安全）。

  // ===== Phase copy-skill（搬 claude 入口 skill 來源檔目錄） =====
  if (skillName !== null) {
    const srcSkillDir = claudeSkillDir(fromSourceRoot, skillName)
    const dstSkillDir = claudeSkillDir(toSourceRoot, skillName)

    const srcSkillExists = await pathExists(srcSkillDir)
    const dstSkillExists = await pathExists(dstSkillDir)

    if (srcSkillExists && !dstSkillExists) {
      // 用 keep-source 版：skill 先複製到新來源（不刪舊），刪舊延到 cleanup 階段做 R4 安全檢查。
      const copySkill = await copyVerifyKeepSource(srcSkillDir, dstSkillDir)
      if (!copySkill.ok) {
        // 回滾：刪目標 agents + 刪半拷目標 skill + 重新 register 舊來源。
        await rmQuiet(dstAgentsDir)
        await rmQuiet(dstSkillDir)
        await reRegisterOldSource(deps, fromSourceRoot, teamPath, skillName, platforms)
        return {
          teamPath,
          ok: false,
          phase: copySkill.phase === 'copy' ? 'copy' : 'verify',
          message: copySkill.message,
          skillName,
          filesMoved: false,
        }
      }
    }
    // 新來源已有同名 skill 目錄（別隊共用 skillName）→ skip copy，用新來源既有那份（register 會直連）。
  }

  // === checkpoint：到此 agents 夾 + claude skill 已在新來源（filesMoved=true）。後續失敗不回滾檔案。===

  // ===== Phase register（在新來源重建三平台連結） =====
  let registerResult: RegisterTeamResult | null = null
  try {
    registerResult = await deps.registerTeam(toSourceRoot, teamPath, platforms)
  } catch (e) {
    // 檔案已安全在新來源 → 不回滾檔案；記 warning（UI 提示「到詳情重裝平台」）。
    const msg = e instanceof Error ? e.message : String(e)
    return {
      teamPath,
      ok: true,
      phase: 'register',
      message: `檔案已搬移成功，但平台連結重建失敗（請到團隊詳情重新安裝）：${msg}`,
      skillName,
      filesMoved: true,
    }
  }
  const registerWarning = collectRegisterWarning(registerResult)

  // ===== Phase cleanup（清舊來源 skill 殘留，安全版） =====
  let cleanupWarning: string | undefined
  if (skillName !== null) {
    cleanupWarning = await cleanupOldSourceSkill(deps, fromSourceRoot, teamPath, skillName)
  }

  // ===== Phase done =====
  const warning = registerWarning ?? cleanupWarning
  return {
    teamPath,
    ok: true,
    phase: warning ? (registerWarning ? 'register' : 'cleanup') : 'done',
    message: warning,
    skillName,
    filesMoved: true,
  }
}

// ---------------------------------------------------------------------------
// 內部 helper：回滾、register warning 蒐集、cleanup
// ---------------------------------------------------------------------------

/** 回滾用：把剛 unlink 掉的舊來源連結重新 register 回去（best-effort，永不 throw）。 */
async function reRegisterOldSource(
  deps: RelocationDeps,
  fromSourceRoot: string,
  teamPath: string,
  skillName: string | null,
  platforms: Platform[],
): Promise<void> {
  if (skillName === null) return
  try {
    await deps.registerTeam(fromSourceRoot, teamPath, platforms)
  } catch {
    /* 回滾恢復 best-effort；連結是冪等可重建的，恢復失敗不再升級 */
  }
}

/** 蒐集 register 結果裡任一平台的 warning（有 → 回白話訊息；全成功 → undefined）。 */
function collectRegisterWarning(r: RegisterTeamResult): string | undefined {
  if (r.skillName === null) {
    return '新來源找不到入口指令，三平台未連結（可到團隊詳情「建立入口指令」）'
  }
  const warned: Platform[] = []
  if (r.claude?.state === 'warning') warned.push('claude')
  if (r.codex?.state === 'warning') warned.push('codex')
  if (r.agy?.state === 'warning') warned.push('antigravity')
  if (warned.length === 0) return undefined
  return `部分平台連結未完成（${warned.join('、')}），請到團隊詳情重新安裝`
}

/**
 * cleanup 舊來源 skill（plan_v2 §2.3 step6 + §8 R4 安全版）。
 *
 * R4 風險：兩隊末段相同（如 `a/ops` 與 `b/ops` 都 → skillName `tuq-ops`），
 * 若無腦刪舊來源 `.claude/skills/<skillName>` 會誤刪他隊入口。
 *
 * 安全做法（窮舉確認，命中任一即不刪、回 warning）：
 *   1. 本隊 agents 夾仍在舊來源 → 搬移未真正脫離舊來源 → 保守不刪。
 *   2. 舊來源 skill 目錄的 SKILL.md 內 needle 指向的 teamPath 仍有 agents 夾存在
 *      → 該 skill 屬「仍在舊來源的某隊」（可能就是 R4 共用末段的別隊）→ 不刪。
 *   皆未命中（本隊已搬走、無別隊 agents 對應此 skill needle）→ 安全刪除舊 skill 目錄。
 */
async function cleanupOldSourceSkill(
  deps: RelocationDeps,
  fromSourceRoot: string,
  teamPath: string,
  skillName: string,
): Promise<string | undefined> {
  try {
    const fromAgentOrgRoot = agentOrgRootOf(fromSourceRoot)
    const oldSkillDir = claudeSkillDir(fromSourceRoot, skillName)

    if (!(await pathExists(oldSkillDir))) {
      // 舊 skill 已不在（如 copyVerify delete 已連同搬走）→ 無需 cleanup。
      return undefined
    }

    // 1. 本隊 agents 夾還在舊來源 → 搬移未脫離 → 保守不刪。
    if (await pathExists(teamAgentsDir(fromSourceRoot, teamPath))) {
      return '舊資料夾仍有殘留，未清除舊入口指令（可稍後手動處理）'
    }

    // 2. 舊 skill 的 needle 仍指向「舊來源尚存的某隊 agents」→ 不刪（避免 R4 誤刪共用末段的別隊）。
    const ownerTeamPath = await needleTeamPathOf(oldSkillDir)
    if (ownerTeamPath !== null && (await pathExists(teamAgentsDir(fromSourceRoot, ownerTeamPath)))) {
      // 再以 resolveEntrySkill 二次確認該隊確實反查到同一 skillName（與反查 needle 規則一致）。
      const resolved = await deps.resolveEntrySkill(fromAgentOrgRoot, ownerTeamPath)
      if (resolved?.skillName === skillName) {
        return '偵測到舊資料夾仍有團隊使用此入口指令，未清除（避免影響其他團隊）'
      }
    }

    await rmQuiet(oldSkillDir)
    return undefined
  } catch {
    return '舊入口指令未清除（可稍後手動刪除）'
  }
}

/**
 * 從 skill 目錄的 SKILL.md body 反推它指向的 teamPath（needle `agents/<teamPath>/manager`）。
 * 讀不到 / 抓不到 needle → 回 null。供 cleanup R4 安全確認用（teamPath 一律 `/` 分隔）。
 */
async function needleTeamPathOf(skillDir: string): Promise<string | null> {
  try {
    const body = await fs.promises.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
    const normalized = body.replace(/\\/g, '/')
    // needle 形如 `agents/<teamPath>/manager` 且其後接硬邊界（行尾/空白/引號等，非 `/`）。
    // 非貪婪 + 硬邊界 lookahead 對齊 teamRegistrationService.skillBodyMatchesNeedle 的 (b) 規則。
    const m = normalized.match(/agents\/(.+?)\/manager(?=$|[\s'"`)\]、])/m)
    return m && m[1] ? m[1] : null
  } catch {
    return null
  }
}

// 重新匯出純檔案 helper，方便上層/測試從單一入口取用。
export { copyVerify, verifyTreesMatch }
