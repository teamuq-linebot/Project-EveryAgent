import { describe, it, expect } from 'vitest'
import { buildLaunchCommand } from '../src/main/services/sessions'

describe('buildLaunchCommand (port of tools/sessions.py)', () => {
  it('claude resume → claude --resume {id}', () => {
    expect(buildLaunchCommand('claude', '/p', 'abc', null, 'resume')).toEqual({
      command: 'claude --resume abc',
      cwd: '/p',
    })
  })

  it('claude new_id → claude --session-id {id}', () => {
    expect(buildLaunchCommand('claude', '/p', 'xyz', null, 'new_id')).toEqual({
      command: 'claude --session-id xyz',
      cwd: '/p',
    })
  })

  it('claude no id → fresh launch (claude)', () => {
    expect(buildLaunchCommand('claude', '/p', null).command).toBe('claude')
  })

  it('codex resume → codex resume {id}', () => {
    expect(buildLaunchCommand('codex', '/p', 's1', null, 'resume').command).toBe(
      'codex resume s1',
    )
  })

  it('codex new_id falls back to fresh (no NEW_WITH_ID for codex)', () => {
    const cmd = buildLaunchCommand('codex', '/p', 's1', null, 'new_id').command
    expect(cmd).toBe('codex')
    // codex 無 --session-id 旗標：new_id 模式仍走全新啟動，指令不得帶 id 旗標
    expect(cmd).toContain('codex')
    expect(cmd).not.toContain('--session-id')
  })

  it('antigravity (agy) new_id falls back to fresh launch (agy)', () => {
    const cmd = buildLaunchCommand('antigravity', '/p', 's1', null, 'new_id').command
    // agy 無外部 id 旗標：new_id 不命中 NEW_WITH_ID_TMPL → 退回 LAUNCH_NEW.antigravity
    expect(cmd).toBe('agy')
    expect(cmd).not.toContain('--session-id')
  })

  it('antigravity (agy) no id → fresh launch (agy)', () => {
    expect(buildLaunchCommand('antigravity', '/p', null).command).toBe('agy')
  })

  it('vscode → code .', () => {
    expect(buildLaunchCommand('vscode', '/p', null).command).toBe('code .')
  })

  it('unknown tool with customCommand → customCommand', () => {
    expect(buildLaunchCommand('custom', '/p', null, 'my-cli --go').command).toBe(
      'my-cli --go',
    )
  })

  it('unknown tool, no customCommand → null', () => {
    expect(buildLaunchCommand('weird', '/p', null).command).toBeNull()
  })

  it('tool is case-insensitive + trimmed', () => {
    expect(buildLaunchCommand('  Claude ', '/p', 'a', null, 'resume').command).toBe(
      'claude --resume a',
    )
  })

  it('cwd is always projectPath', () => {
    expect(buildLaunchCommand('claude', '/some/dir', 'a').cwd).toBe('/some/dir')
  })
})
