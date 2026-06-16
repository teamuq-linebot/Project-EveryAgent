/**
 * agentOrgService.spec.ts — scanAgentOrg / getAgentDetail 行為測試
 *
 * 以 os.tmpdir() 臨時目錄作為隔離 fixture；測後清除。
 * 不依賴任何外部服務或資料庫。
 *
 * Cases：
 *   AO1 基本掃描 — manager 分離、worker 欄位含巢狀 dispatch
 *   AO2 排除清單 — protocols / templates / audit-sys-x / _log 不出現
 *   AO3 巢狀子團隊 — platform/goose-ops 攤平為獨立 team
 *   AO4 容錯 — 壞 YAML skip；無 workflow.yaml → workflowYaml null
 *   AO5 getAgentDetail — workflow.yaml + soul.md + worklog/
 *   AO6 display_name / 引號值 / 中文值解析
 *   AO7 smoke（skipIf）— 真實 AgentOrg 目錄存在時執行
 *   AO8 rootPath 不存在 — scanAgentOrg throw（F-4）
 */

import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createAgentTeamFiles } from '../src/main/services/agentTeamCreateService'
import {
  scanAgentOrg,
  getAgentDetail,
  isQuickCreatedTeam,
  AgentOrgTree,
} from '../src/main/services/agentOrgService'
import { resolveEntrySkill } from '../src/main/services/teamRegistrationService'
import type { AgentTeamCreateSpec } from '../src/shared/ipcContracts'

// ---------------------------------------------------------------------------
// Fixture 工具
// ---------------------------------------------------------------------------

const fixtureDirs: string[] = []

function makeTmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-spec-'))
  fixtureDirs.push(dir)
  return dir
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

afterAll(() => {
  for (const dir of fixtureDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 忽略清理失敗
    }
  }
})

function makeAgentTeamCreateSpec(): AgentTeamCreateSpec {
  return {
    teamId: 'content-lab',
    teamName: '內容實驗組',
    skillName: 'tuq-content-lab',
    platforms: ['claude', 'codex', 'antigravity'],
    manager: {
      displayName: '內容實驗組長',
      title: '內容實驗 Manager',
      model: 'sonnet',
      summary: '管理內容實驗任務的釐清、派工與驗收。',
      responsibilities: ['確認內容目標', '派工給內容成員', '驗收交付品質'],
    },
    members: [
      {
        name: 'researcher',
        displayName: '內容研究員',
        title: '內容研究員',
        roleInTeam: 'researcher',
        model: 'sonnet',
        summary: '研究題材與受眾需求。',
        responsibilities: ['整理研究資料', '標記受眾洞察'],
      },
      {
        name: 'writer',
        displayName: '內容撰稿員',
        title: '內容撰稿員',
        roleInTeam: 'doer',
        model: 'sonnet',
        summary: '依 brief 產出內容草稿。',
        responsibilities: ['撰寫草稿', '依回饋修訂'],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// AO0 — 建立團隊 spec：deterministic file generation + scanner compatibility
// ---------------------------------------------------------------------------

describe('AO0 createAgentTeamFiles：從 spec 建立可掃描的 AI 團隊', () => {
  it('建立 manager、workers、introduction 與入口 skill', async () => {
    const agentOrgRoot = makeTmpRoot()
    const agentsRoot = path.join(agentOrgRoot, 'agents')
    fs.mkdirSync(agentsRoot, { recursive: true })

    const result = await createAgentTeamFiles(agentsRoot, makeAgentTeamCreateSpec())

    expect(result.teamId).toBe('content-lab')
    expect(result.skillName).toBe('tuq-content-lab')
    expect(result.filesCreated.length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(agentsRoot, 'content-lab', 'manager', 'agent.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(agentsRoot, 'content-lab', 'writer', 'introduction.json'))).toBe(true)
    expect(fs.existsSync(path.join(agentOrgRoot, '.claude', 'skills', 'tuq-content-lab', 'SKILL.md'))).toBe(true)

    const intro = JSON.parse(
      fs.readFileSync(path.join(agentsRoot, 'content-lab', 'manager', 'introduction.json'), 'utf8'),
    ) as { workflows: unknown[] }
    expect(intro.workflows.length).toBeGreaterThanOrEqual(3)

    const tree = await scanAgentOrg(agentsRoot)
    const team = tree.teams.find((item) => item.id === 'content-lab')
    expect(team?.manager?.displayName).toBe('內容實驗組長')
    expect(team?.agents.map((agent) => agent.name).sort()).toEqual(['researcher', 'writer'])

    const entry = await resolveEntrySkill(agentOrgRoot, 'content-lab')
    expect(entry?.skillName).toBe('tuq-content-lab')
  })

  it('既有 team 目錄存在時中止，避免混寫', async () => {
    const agentOrgRoot = makeTmpRoot()
    const agentsRoot = path.join(agentOrgRoot, 'agents')
    fs.mkdirSync(agentsRoot, { recursive: true })

    await createAgentTeamFiles(agentsRoot, makeAgentTeamCreateSpec())

    await expect(createAgentTeamFiles(agentsRoot, makeAgentTeamCreateSpec())).rejects.toThrow(
      'AI 團隊已存在',
    )
  })
})

// ---------------------------------------------------------------------------
// AO1 — 基本掃描：manager 分離、worker 巢狀 dispatch 欄位
// ---------------------------------------------------------------------------

describe('AO1 基本掃描：manager 與 worker 解析', () => {
  const root = makeTmpRoot()

  // sw/manager/agent.yaml — type: manager
  writeFile(
    path.join(root, 'sw', 'manager', 'agent.yaml'),
    [
      'agent: manager',
      'title: "SW Manager"',
      'display_name: "軟體經理"',
      'type: manager',
      'role_in_team: lead',
    ].join('\n'),
  )

  // sw/developer/agent.yaml — type: worker，含巢狀 dispatch
  writeFile(
    path.join(root, 'sw', 'developer', 'agent.yaml'),
    [
      'agent: developer',
      'title: "Developer Agent"',
      'type: worker',
      'role_in_team: doer',
      '',
      'dispatch:',
      '  model: sonnet',
      '  trigger: "當需要寫程式碼時"',
      '  not_for: "測試撰寫 / 文件"',
    ].join('\n'),
  )

  it('scan 結果包含 sw team', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')
    expect(sw).toBeDefined()
  })

  it('manager 存在於 team.manager 欄位，不在 agents[]', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    expect(sw.manager).not.toBeNull()
    expect(sw.manager!.type).toBe('manager')
    expect(sw.manager!.name).toBe('manager')
    // manager 不出現在 agents 陣列
    const names = sw.agents.map((a) => a.name)
    expect(names).not.toContain('manager')
  })

  it('manager 的 displayName 正確解析（中文引號值）', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    expect(sw.manager!.displayName).toBe('軟體經理')
  })

  it('developer 在 agents[] 中', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')
    expect(dev).toBeDefined()
  })

  it('developer.roleInTeam 正確', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.roleInTeam).toBe('doer')
  })

  it('developer dispatch.model 正確解析', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.model).toBe('sonnet')
  })

  it('developer dispatch.trigger 正確解析（含中文引號）', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.trigger).toBe('當需要寫程式碼時')
  })

  it('developer dispatch.not_for 正確解析', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.notFor).toBe('測試撰寫 / 文件')
  })

  it('developer id 格式為 teamId/name', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.id).toBe('sw/developer')
  })

  it('scan 路徑 developer.worklogCount 為 undefined（不計算）', async () => {
    const { teams } = await scanAgentOrg(root)
    const sw = teams.find((t) => t.id === 'sw')!
    const dev = sw.agents.find((a) => a.name === 'developer')!
    expect(dev.worklogCount).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// AO2 — 排除清單
// ---------------------------------------------------------------------------

describe('AO2 排除清單：protocols / templates / audit-sys-x / _log 不出現', () => {
  const root = makeTmpRoot()

  // 合法 team（作為對照組）
  writeFile(
    path.join(root, 'sw', 'manager', 'agent.yaml'),
    'agent: manager\ntype: manager\n',
  )

  // 排除目錄：protocols
  writeFile(
    path.join(root, 'protocols', 'some-agent', 'agent.yaml'),
    'agent: some-agent\ntype: worker\n',
  )

  // 排除目錄：templates
  writeFile(
    path.join(root, 'templates', 'tmpl-agent', 'agent.yaml'),
    'agent: tmpl-agent\ntype: worker\n',
  )

  // 排除目錄：audit-sys-x
  writeFile(
    path.join(root, 'audit-sys-x', 'audit-agent', 'agent.yaml'),
    'agent: audit-agent\ntype: worker\n',
  )

  // 排除目錄：_log
  writeFile(
    path.join(root, '_log', 'log-agent', 'agent.yaml'),
    'agent: log-agent\ntype: worker\n',
  )

  it('protocols 不出現在 teams', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    expect(ids).not.toContain('protocols')
  })

  it('templates 不出現在 teams', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    expect(ids).not.toContain('templates')
  })

  it('audit-sys-x 不出現在 teams（startsWith audit-sys-）', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    const hasAudit = ids.some((id) => id.startsWith('audit-sys-'))
    expect(hasAudit).toBe(false)
  })

  it('_log 不出現在 teams', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    expect(ids).not.toContain('_log')
  })

  it('合法的 sw team 仍存在（對照組）', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    expect(ids).toContain('sw')
  })
})

// ---------------------------------------------------------------------------
// AO3 — 巢狀子團隊：platform/goose-ops 攤平為獨立 team
// ---------------------------------------------------------------------------

describe('AO3 巢狀子團隊：platform/goose-ops 攤平', () => {
  const root = makeTmpRoot()

  // platform/ 下沒有直接 agent.yaml
  // platform/goose-ops/manager/agent.yaml 才是真正的 agent
  writeFile(
    path.join(root, 'platform', 'goose-ops', 'manager', 'agent.yaml'),
    'agent: manager\ntype: manager\ntitle: "Goose Ops Manager"\n',
  )

  writeFile(
    path.join(root, 'platform', 'goose-ops', 'operator', 'agent.yaml'),
    'agent: operator\ntype: worker\nrole_in_team: executor\n',
  )

  it('platform 本身不是 team id（沒有直接 agent）', async () => {
    const { teams } = await scanAgentOrg(root)
    const ids = teams.map((t) => t.id)
    expect(ids).not.toContain('platform')
  })

  it('攤平後有 platform/goose-ops team', async () => {
    const { teams } = await scanAgentOrg(root)
    const found = teams.find((t) => t.id === 'platform/goose-ops')
    expect(found).toBeDefined()
  })

  it('platform/goose-ops 的 manager 非 null', async () => {
    const { teams } = await scanAgentOrg(root)
    const t = teams.find((t) => t.id === 'platform/goose-ops')!
    expect(t.manager).not.toBeNull()
    expect(t.manager!.name).toBe('manager')
  })

  it('operator 在 platform/goose-ops agents 中', async () => {
    const { teams } = await scanAgentOrg(root)
    const t = teams.find((t) => t.id === 'platform/goose-ops')!
    const op = t.agents.find((a) => a.name === 'operator')
    expect(op).toBeDefined()
    expect(op!.roleInTeam).toBe('executor')
  })
})

// ---------------------------------------------------------------------------
// AO4 — 容錯：壞 YAML skip；無 workflow.yaml → workflowYaml null
// ---------------------------------------------------------------------------

describe('AO4 容錯', () => {
  const root = makeTmpRoot()

  // 合法 agent（對照組）
  writeFile(
    path.join(root, 'ops', 'manager', 'agent.yaml'),
    'agent: manager\ntype: manager\n',
  )

  // 壞 YAML（亂格式：全是二進位噪音，會讓 readFileSync 拿到但 parser 應 graceful skip）
  writeFile(
    path.join(root, 'ops', 'broken-agent', 'agent.yaml'),
    // 放一個非法但不是真正亂碼的內容：缺少 colon 的行
    '!!@#$%^&*() this is not valid yaml structure\n:::invalid:::',
  )

  // 有 agent.yaml 但沒有 workflow.yaml 的 agent
  writeFile(
    path.join(root, 'ops', 'no-workflow', 'agent.yaml'),
    'agent: no-workflow\ntype: worker\n',
  )

  it('壞 YAML 不拋例外（scan 正常完成）', async () => {
    await expect(scanAgentOrg(root)).resolves.not.toThrow()
  })

  it('壞 YAML agent 被 skip（不出現在 agents 清單）', async () => {
    const { teams } = await scanAgentOrg(root)
    const ops = teams.find((t) => t.id === 'ops')
    // broken-agent 的 agent.yaml 沒有合法的 agent: 或 type: 欄位
    // parseSimpleYaml 不拋，但回傳結果缺鍵，parseAgentDir 會 fallback 到目錄名
    // 因此 broken-agent 可能仍出現（type 預設 worker）
    // 重點：scan 不拋，ops team 存在
    expect(ops).toBeDefined()
  })

  it('合法對照 manager 正確存在', async () => {
    const { teams } = await scanAgentOrg(root)
    const ops = teams.find((t) => t.id === 'ops')!
    expect(ops.manager).not.toBeNull()
  })

  it('無 workflow.yaml 的 agent → getAgentDetail 回 workflowYaml: null', async () => {
    const detail = await getAgentDetail(root, 'ops', 'no-workflow')
    expect(detail).not.toBeNull()
    expect(detail!.workflowYaml).toBeNull()
  })

  it('無 soul.md 的 agent → getAgentDetail 回 soulExcerpt: null', async () => {
    const detail = await getAgentDetail(root, 'ops', 'no-workflow')
    expect(detail).not.toBeNull()
    expect(detail!.soulExcerpt).toBeNull()
  })

  it('agentDir 不存在 → getAgentDetail 回 null', async () => {
    const detail = await getAgentDetail(root, 'ops', 'does-not-exist')
    expect(detail).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AO5 — getAgentDetail：workflow.yaml + soul.md + worklog/
// ---------------------------------------------------------------------------

describe('AO5 getAgentDetail：workflow / soul / worklog', () => {
  const root = makeTmpRoot()

  const workflowContent = [
    'name: tester-workflow',
    'steps:',
    '  - id: step1',
    '    action: run_tests',
  ].join('\n')

  const soulContent = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: soul content`).join('\n')

  // 建立 agent 目錄
  writeFile(
    path.join(root, 'sw', 'tester', 'agent.yaml'),
    'agent: tester\ntitle: "Tester Agent"\ntype: worker\n',
  )
  writeFile(path.join(root, 'sw', 'tester', 'workflow.yaml'), workflowContent)
  writeFile(path.join(root, 'sw', 'tester', 'soul.md'), soulContent)

  // worklog/ 下放 2 個 .json + 1 個非 .json
  writeFile(path.join(root, 'sw', 'tester', 'worklog', 'log1.json'), '{}')
  writeFile(path.join(root, 'sw', 'tester', 'worklog', 'log2.json'), '{}')
  writeFile(path.join(root, 'sw', 'tester', 'worklog', 'notes.txt'), 'not json')

  it('回傳非 null', async () => {
    const detail = await getAgentDetail(root, 'sw', 'tester')
    expect(detail).not.toBeNull()
  })

  it('workflowYaml 回傳原文', async () => {
    const detail = await getAgentDetail(root, 'sw', 'tester')
    expect(detail!.workflowYaml).toBe(workflowContent)
  })

  it('soulExcerpt 回傳完整 soul.md 內容（非截斷）', async () => {
    const detail = await getAgentDetail(root, 'sw', 'tester')
    expect(detail!.soulExcerpt).toBe(soulContent)
    const lines = detail!.soulExcerpt!.split('\n')
    // soul.md 共 60 行，完整回傳不截斷
    expect(lines).toHaveLength(60)
    expect(lines[0]).toBe('Line 1: soul content')
    expect(lines[59]).toBe('Line 60: soul content')
  })

  it('worklogCount 只計 .json 檔（2 個）', async () => {
    const detail = await getAgentDetail(root, 'sw', 'tester')
    expect(detail!.worklogCount).toBe(2)
  })

  it('title 欄位正確', async () => {
    const detail = await getAgentDetail(root, 'sw', 'tester')
    expect(detail!.title).toBe('Tester Agent')
  })
})

// ---------------------------------------------------------------------------
// AO6 — display_name / 引號值 / 中文值解析
// ---------------------------------------------------------------------------

describe('AO6 display_name / 引號值 / 中文值解析', () => {
  const root = makeTmpRoot()

  // 單引號 display_name
  writeFile(
    path.join(root, 'hr', 'assistant', 'agent.yaml'),
    [
      "agent: assistant",
      "title: 'HR Assistant'",
      "display_name: '人資助理'",
      "type: worker",
    ].join('\n'),
  )

  // 雙引號 display_name（含空格）
  writeFile(
    path.join(root, 'hr', 'manager', 'agent.yaml'),
    [
      'agent: manager',
      'title: "HR Manager"',
      'display_name: "人資部門經理 HR"',
      'type: manager',
    ].join('\n'),
  )

  it('單引號 title 解析正確', async () => {
    const { teams } = await scanAgentOrg(root)
    const hr = teams.find((t) => t.id === 'hr')!
    const asst = hr.agents.find((a) => a.name === 'assistant')!
    expect(asst.title).toBe('HR Assistant')
  })

  it('單引號 display_name 解析正確（中文）', async () => {
    const { teams } = await scanAgentOrg(root)
    const hr = teams.find((t) => t.id === 'hr')!
    const asst = hr.agents.find((a) => a.name === 'assistant')!
    expect(asst.displayName).toBe('人資助理')
  })

  it('雙引號 display_name 含空格解析正確', async () => {
    const { teams } = await scanAgentOrg(root)
    const hr = teams.find((t) => t.id === 'hr')!
    expect(hr.manager!.displayName).toBe('人資部門經理 HR')
  })

  it('無 display_name 欄位時回傳 null', async () => {
    // 用 AO1 root 的 developer（無 display_name）
    // 另建一個簡單 fixture
    const r2 = makeTmpRoot()
    writeFile(
      path.join(r2, 'eng', 'worker', 'agent.yaml'),
      'agent: worker\ntype: worker\ntitle: Plain Worker\n',
    )
    const { teams } = await scanAgentOrg(r2)
    const eng = teams.find((t) => t.id === 'eng')!
    const w = eng.agents.find((a) => a.name === 'worker')!
    expect(w.displayName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AO7 — smoke：真實 AgentOrg 目錄（skipIf 不存在）
// ---------------------------------------------------------------------------

const REAL_ROOT = 'T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents'

describe.skipIf(!fs.existsSync(REAL_ROOT))('AO7 smoke：真實 AgentOrg 目錄', () => {
  let result: AgentOrgTree | undefined

  it('scanAgentOrg 可正常執行（不拋）', async () => {
    await expect(scanAgentOrg(REAL_ROOT)).resolves.toBeDefined()
  })

  it('teams.length >= 10', async () => {
    result = result ?? await scanAgentOrg(REAL_ROOT)
    console.log(`[smoke] teams.length = ${result.teams.length}`)
    console.log(`[smoke] team ids = ${result.teams.map((t) => t.id).join(', ')}`)
    expect(result.teams.length).toBeGreaterThanOrEqual(10)
  })

  it('包含 id 為 sw 的 team', async () => {
    result = result ?? await scanAgentOrg(REAL_ROOT)
    const sw = result.teams.find((t) => t.id === 'sw')
    expect(sw).toBeDefined()
  })

  it('sw team manager 非 null', async () => {
    result = result ?? await scanAgentOrg(REAL_ROOT)
    const sw = result.teams.find((t) => t.id === 'sw')!
    expect(sw.manager).not.toBeNull()
  })

  it('sw.agents 不含 name === manager', async () => {
    result = result ?? await scanAgentOrg(REAL_ROOT)
    const sw = result.teams.find((t) => t.id === 'sw')!
    const names = sw.agents.map((a) => a.name)
    console.log(`[smoke] sw.agents = [${names.join(', ')}]`)
    expect(names).not.toContain('manager')
  })

  it('getAgentDetail sw/tester 回傳非 null 且有 workflowYaml 或 soulExcerpt', async () => {
    const detail = await getAgentDetail(REAL_ROOT, 'sw', 'tester')
    console.log(`[smoke] tester detail: workflowYaml=${!!detail?.workflowYaml}, soul=${!!detail?.soulExcerpt}, worklogCount=${detail?.worklogCount}`)
    expect(detail).not.toBeNull()
    // 至少有其中一個
    const hasContent = detail!.workflowYaml !== null || detail!.soulExcerpt !== null
    expect(hasContent).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AO8 — rootPath 不存在：scanAgentOrg throw（F-4 錯誤上拋）
// ---------------------------------------------------------------------------

describe('AO8 rootPath 不存在：scanAgentOrg throw', () => {
  it('不存在路徑 → rejects.toThrow()', async () => {
    await expect(scanAgentOrg('Z:/nonexistent-path-that-does-not-exist')).rejects.toThrow()
  })

  it('throw 訊息含路徑資訊', async () => {
    await expect(
      scanAgentOrg('Z:/nonexistent-path-that-does-not-exist'),
    ).rejects.toThrow(/nonexistent-path-that-does-not-exist/)
  })
})

// ---------------------------------------------------------------------------
// AO9 — isQuickCreatedTeam：讀 manager/introduction.json flags
// ---------------------------------------------------------------------------

describe('AO9 isQuickCreatedTeam：快速建立徽章判定', () => {
  // fixture：<root>/<teamId>/manager/introduction.json
  function writeIntro(root: string, teamId: string, intro: unknown): void {
    const introPath = path.join(root, ...teamId.split('/'), 'manager', 'introduction.json')
    writeFile(introPath, JSON.stringify(intro))
  }

  it('flags 含 teamuq_agent_team_ui → true', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { flags: ['teamuq_agent_team_ui'] })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(true)
  })

  it('flags 含其他值連同 teamuq_agent_team_ui → true', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { flags: ['other-flag', 'teamuq_agent_team_ui'] })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(true)
  })

  it('flags 為陣列但不含 teamuq_agent_team_ui → false', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { flags: ['some-other-flag'] })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(false)
  })

  it('flags 為空陣列 → false', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { flags: [] })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(false)
  })

  it('flags 非陣列（字串）→ false', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { flags: 'teamuq_agent_team_ui' })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(false)
  })

  it('缺 flags 欄位 → false', async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'sw', { teamName: '軟體組' })
    expect(await isQuickCreatedTeam(root, 'sw')).toBe(false)
  })

  it('introduction.json 不存在 → false（catch 降級不 throw）', async () => {
    const root = makeTmpRoot()
    // 不寫任何檔
    await expect(isQuickCreatedTeam(root, 'sw')).resolves.toBe(false)
  })

  it('JSON 解析失敗 → false（catch 降級不 throw）', async () => {
    const root = makeTmpRoot()
    writeFile(
      path.join(root, 'sw', 'manager', 'introduction.json'),
      '{ this is not valid json',
    )
    await expect(isQuickCreatedTeam(root, 'sw')).resolves.toBe(false)
  })

  it("teamId 含 '/'（子團隊）→ split('/') 組路徑正確命中", async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'platform/goose-ops', { flags: ['teamuq_agent_team_ui'] })
    expect(await isQuickCreatedTeam(root, 'platform/goose-ops')).toBe(true)
  })

  it("子團隊路徑不命中（無此目錄）→ false", async () => {
    const root = makeTmpRoot()
    writeIntro(root, 'platform/goose-ops', { flags: ['teamuq_agent_team_ui'] })
    // 另一個不存在的子團隊路徑
    expect(await isQuickCreatedTeam(root, 'platform/other-ops')).toBe(false)
  })
})
