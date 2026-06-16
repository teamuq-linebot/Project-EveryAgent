/**
 * skillsList.spec.ts — listSkillCommands 掃描器驗證
 *
 * 分兩部分：
 *   1. fixture 測試：可重跑、有斷言，使用 os.tmpdir() 臨時目錄
 *   2. smoke 測試：真實環境掃描 ~/.claude/skills，只斷言回傳 Array，輸出證據
 *
 * 注意：listSkillCommands 的全域層寫死掃 os.homedir()，無法在測試中覆蓋。
 * 因此 fixture 測試只測「projectPath」層（第二個掃描層）。
 * 全域層以真實環境 smoke test（Part 2）覆蓋。
 */

import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { listSkillCommands } from '../src/main/services/skillsList'

// ---------------------------------------------------------------------------
// Part 1 — fixture 測試（projectPath 層）
// ---------------------------------------------------------------------------

/** 建臨時 fixture 目錄，回傳根路徑。由 afterAll 清除。 */
let fixtureRoot: string

function setupFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-spec-'))
  const skillsDir = path.join(root, '.claude', 'skills')

  // foo — 有合法 SKILL.md（含 frontmatter description）
  const fooDir = path.join(skillsDir, 'foo')
  fs.mkdirSync(fooDir, { recursive: true })
  fs.writeFileSync(
    path.join(fooDir, 'SKILL.md'),
    [
      '---',
      'name: foo',
      'description: Foo 工具的說明文字',
      '---',
      '',
      '# Foo Skill',
    ].join('\n'),
    'utf-8',
  )

  // bar — 目錄存在但沒有 SKILL.md（應被略過）
  const barDir = path.join(skillsDir, 'bar')
  fs.mkdirSync(barDir, { recursive: true })
  fs.writeFileSync(path.join(barDir, 'README.md'), '# Bar\n', 'utf-8')

  // baz — 有 SKILL.md 但 frontmatter 無 description
  const bazDir = path.join(skillsDir, 'baz')
  fs.mkdirSync(bazDir, { recursive: true })
  fs.writeFileSync(
    path.join(bazDir, 'SKILL.md'),
    ['---', 'name: baz', '---', '', '# Baz Skill'].join('\n'),
    'utf-8',
  )

  // alpha — 有 SKILL.md，名稱排序最前面（驗證排序）
  const alphaDir = path.join(skillsDir, 'alpha')
  fs.mkdirSync(alphaDir, { recursive: true })
  fs.writeFileSync(
    path.join(alphaDir, 'SKILL.md'),
    ['---', 'name: alpha', "description: 'Alpha 引號包圍的說明'", '---'].join('\n'),
    'utf-8',
  )

  return root
}

fixtureRoot = setupFixture()

afterAll(() => {
  // 清理臨時 fixture
  try {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  } catch {
    // 忽略清理失敗
  }
})

describe('Part 1 — fixture：projectPath 層掃描', () => {
  it('回傳 Array', () => {
    const result = listSkillCommands(fixtureRoot)
    expect(Array.isArray(result)).toBe(true)
  })

  it('有 SKILL.md 的目錄被列入（foo, baz, alpha）', () => {
    const result = listSkillCommands(fixtureRoot)
    const names = result.map((s) => s.name)
    expect(names).toContain('foo')
    expect(names).toContain('baz')
    expect(names).toContain('alpha')
  })

  it('沒有 SKILL.md 的目錄被略過（bar 不在清單）', () => {
    const result = listSkillCommands(fixtureRoot)
    const names = result.map((s) => s.name)
    expect(names).not.toContain('bar')
  })

  it('description 正確解析 frontmatter（foo）', () => {
    const result = listSkillCommands(fixtureRoot)
    const foo = result.find((s) => s.name === 'foo')
    expect(foo).toBeDefined()
    expect(foo!.description).toBe('Foo 工具的說明文字')
  })

  it('description 正確解析帶引號的 frontmatter（alpha）', () => {
    const result = listSkillCommands(fixtureRoot)
    const alpha = result.find((s) => s.name === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha!.description).toBe('Alpha 引號包圍的說明')
  })

  it('無 description 欄位時回傳 null（baz）', () => {
    const result = listSkillCommands(fixtureRoot)
    const baz = result.find((s) => s.name === 'baz')
    expect(baz).toBeDefined()
    expect(baz!.description).toBeNull()
  })

  it('結果依名稱字母排序', () => {
    const result = listSkillCommands(fixtureRoot)
    const names = result.map((s) => s.name)
    // 只取 fixture 層新增的項目（filter 出已知的三個）
    const fixtureNames = names.filter((n) => ['alpha', 'baz', 'foo'].includes(n))
    expect(fixtureNames).toEqual(['alpha', 'baz', 'foo'])
  })

  it('projectPath 同名覆蓋全域（foo 只出現一次）', () => {
    const result = listSkillCommands(fixtureRoot)
    const foos = result.filter((s) => s.name === 'foo')
    expect(foos).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Part 2 — 真實環境 smoke（~/.claude/skills，含 symlink）
// ---------------------------------------------------------------------------

describe('Part 2 — smoke：真實 ~/.claude/skills 掃描', () => {
  it('listSkillCommands(null) 回傳 Array（含 symlink skill）', () => {
    const result = listSkillCommands(null)

    // 完整輸出供佐證
    console.log('=== SMOKE: real ~/.claude/skills scan ===')
    console.log(`總數：${result.length} 個 skill`)
    for (const s of result) {
      const desc = s.description ? s.description.slice(0, 40) : '(null)'
      console.log(`  ${s.name}: ${desc}`)
    }
    console.log('=== END SMOKE ===')

    expect(Array.isArray(result)).toBe(true)
  })
})
