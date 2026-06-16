import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'output/**', 'node_modules/**', '**/*.d.ts', '.abi-node-bsq3/**'] },
  {
    // 全局 linterOptions：
    // - noInlineConfig: 關閉 inline eslint-disable（避免既有 disable 行引用未載入插件的規則而報 error）
    // - reportUnusedInlineConfigs: 關閉「noInlineConfig 使 disable 無效」的 warning，保持輸出乾淨
    linterOptions: { noInlineConfig: true, reportUnusedInlineConfigs: 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // ── max-lines allowlist（ratchet 基線）──
    // 以下為截至 2026-06-10 已 >500 行的既有檔，暫予豁免；重構讓某檔降到 ≤500 後，從本清單移除即可。
    // 新檔 / 長大的檔不在此清單 → 一律被 max-lines 擋下。
    files: [
      'src/main/sync/syncEngine.ts',
      'src/main/monitor/MonitorController.ts',
      'src/main/sync/platformSeeds.data.ts',
      'src/main/db/migrateToSingleDb.ts',
      'src/main/worktime/claude/discover.ts',
      'src/main/sync/adapters/restAdapter.ts',
      'src/main/worktime/punchCore.ts',
      'src/main/sync/engine/resolvers.ts',
      'src/renderer/views/AgentTeams/AgentTeamsView.tsx',
      'src/renderer/views/AgentTeams/AgentOrgList.tsx',
      'src/main/monitor/punchExecutor.ts',
      'src/renderer/views/Session/ConversationPanel.tsx',
      'src/main/llm/claudeCliProvider.ts',
      'src/main/services/punchService.ts',
      'src/main/repo/sqlite/schema.ts',
      'src/main/services/teamRegistrationService.ts',
      'src/main/backend/services/agentTeamsService.ts',
      'src/renderer/views/Session/conversation/helpers.tsx',
      'src/renderer/views/AgentTeams/AgentDetailDrawer.tsx',
      'src/main/services/agentConversationService.ts',
    ],
    rules: { 'max-lines': 'off' },
  },
);
