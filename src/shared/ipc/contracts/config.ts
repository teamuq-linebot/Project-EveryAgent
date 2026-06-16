import { z } from "zod";

export const CONFIG_CHANNELS = {
  GET_MILESTONE: "config:getMilestone",
  SET_MILESTONE: "config:setMilestone",
} as const;

export const ConfigGetMilestoneSchema = z.object({
  milestoneId: z.string().min(1),
});
export type ConfigGetMilestonePayload = z.infer<
  typeof ConfigGetMilestoneSchema
>;

export const ConfigSetMilestoneSchema = z.object({
  milestoneId: z.string().min(1),
  projectPath: z.string().nullable(),
  tool: z.string().min(1),
  customCommand: z.string().nullable().optional(),
});
export type ConfigSetMilestonePayload = z.infer<
  typeof ConfigSetMilestoneSchema
>;

// -- app_settings 通用 key-value（統一設定頁；外觀以外的偏好都走這條）----------
//
// settings:get（key → 該 key 的 JSON 物件 | null）/ settings:set（key + valueJson 字串 upsert）。
// SettingsGet/SetSchema 定義於下方「settings」段（與其他 channel schema 同處）。
// 後端對應 AppSettingsStore.getJson/setJson（teamuq.db `app_settings` 表，非機密、明文 JSON）。
// 已知 key 與形狀（呼叫端各自驗形 + clamp）：
//   - 'monitor_auto_recover' → { enabled: boolean }（預設 true；index.ts recoverMonitoring 前讀）
//   - 'kanban_poll_seconds'  → { seconds: number }（預設 15，clamp 5~120；App 看板輪詢）
//   - 'monitor_poll_seconds' → { seconds: number }（預設 2，clamp 1~30；MonitorController 掃描）
//   - 'cli_onboarding'       → { dismissed: boolean }（預設 false；首啟 CLI 引導一次性提示，dismissed=true 後不再彈）

/** 統一設定頁用的 app_settings key 常數（避免字面字串散落）。 */
export const APP_SETTINGS_KEYS = {
  MONITOR_AUTO_RECOVER: "monitor_auto_recover",
  KANBAN_POLL_SECONDS: "kanban_poll_seconds",
  MONITOR_POLL_SECONDS: "monitor_poll_seconds",
  CLI_ONBOARDING: "cli_onboarding",
} as const;

/** 預設值 + clamp 範圍（main 與 renderer 共用單一真相）。 */
export const APP_SETTINGS_DEFAULTS = {
  monitorAutoRecover: true,
  kanbanPollSeconds: 15,
  kanbanPollSecondsMin: 5,
  kanbanPollSecondsMax: 120,
  monitorPollSeconds: 2,
  monitorPollSecondsMin: 1,
  monitorPollSecondsMax: 30,
  cliOnboarding: { dismissed: false },
} as const;
