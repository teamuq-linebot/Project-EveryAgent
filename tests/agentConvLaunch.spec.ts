import { describe, expect, it } from 'vitest';
import { buildAgentConvLaunchCommand } from '../src/main/services/agentConvLaunch';

describe('agentConv launch model defaults', () => {
  it('Claude embedded AgentTeams conversations default to sonnet with medium effort', () => {
    expect(buildAgentConvLaunchCommand('claude', '00000000-0000-0000-0000-000000000001')).toBe(
      'claude --model sonnet --effort medium --session-id 00000000-0000-0000-0000-000000000001',
    );
  });

  it('Claude resume keeps sonnet + medium effort and uses --resume', () => {
    expect(buildAgentConvLaunchCommand('claude', '00000000-0000-0000-0000-000000000001', true)).toBe(
      'claude --model sonnet --effort medium --resume 00000000-0000-0000-0000-000000000001',
    );
  });

  it('Codex embedded AgentTeams conversations default to gpt-5.4', () => {
    expect(buildAgentConvLaunchCommand('codex', '00000000-0000-0000-0000-000000000001')).toBe(
      'codex --model gpt-5.4',
    );
  });

  it('Antigravity keeps existing launch command', () => {
    expect(buildAgentConvLaunchCommand('antigravity', '00000000-0000-0000-0000-000000000001')).toBe('agy');
  });
});
