export const AGENT_CONV_DEFAULT_MODELS: Record<string, string> = {
  claude: 'sonnet',
  codex: 'gpt-5.4',
};

/**
 * AgentTeams 建團隊對話的 claude thinking effort（Claude Code 預設為 xhigh，偏高）。
 * 用 claude CLI 原生旗標 `--effort <low|medium|high|xhigh|max>` 調低。
 * 改 'low' 更省 / 'high' 更深；只影響 AgentTeams 嵌入式對話，不動 user-global CLI 預設。
 */
export const AGENT_CONV_CLAUDE_EFFORT = 'medium';

/**
 * AgentTeams embedded conversations use cheaper default models than user-global CLI defaults.
 *
 * resume=true（且 cliId === 'claude'）→ 以 `claude --resume <id>` 續接同一 session、保留 context，
 * 不重送 initialPrompt。codex / antigravity 的 AgentTeams 路徑連 --session-id 都沒有，本批不支援
 * resume：resume=true 但非 claude 時，退回原本的非 resume 指令（等同忽略 resume）。
 */
export function buildAgentConvLaunchCommand(
  cliId: string,
  conversationId: string,
  resume?: boolean,
): string {
  switch (cliId) {
    case 'codex':
      return `codex --model ${AGENT_CONV_DEFAULT_MODELS.codex}`;
    case 'antigravity':
      return 'agy';
    case 'claude':
    default:
      return resume
        ? `claude --model ${AGENT_CONV_DEFAULT_MODELS.claude} --effort ${AGENT_CONV_CLAUDE_EFFORT} --resume ${conversationId}`
        : `claude --model ${AGENT_CONV_DEFAULT_MODELS.claude} --effort ${AGENT_CONV_CLAUDE_EFFORT} --session-id ${conversationId}`;
  }
}
