import { z } from "zod";

// ---------------------------------------------------------------------------
// Team Registry — 團隊 claude skill 連結（team-registration-20260608）
// ---------------------------------------------------------------------------

/**
 * teamRegistry:register / unregister channel 常數。
 * REGISTER   — 把一個 team 的入口 skill junction 連結到 ~/.claude/skills。
 * UNREGISTER — 移除已連結的 skill（junction 或 codex 產生物）。
 */
export const TEAM_REGISTRY_CHANNELS = {
  REGISTER: "teamRegistry:register",
  UNREGISTER: "teamRegistry:unregister",
  /** 同步/更新：重跑 register 冪等邏輯（claude junction live，codex 比對覆寫）。 */
  SYNC: "teamRegistry:sync",
} as const;

/** teamRegistry:register 請求 payload schema。 */
export const RegisterTeamSchema = z.object({
  teamId: z.string().min(1),
  platforms: z.array(z.enum(["claude", "codex", "antigravity"])).optional(),
});
export type RegisterTeamPayload = z.infer<typeof RegisterTeamSchema>;

/** junction/symlink / codex skill 建立或移除的七態結果。 */
export type RegistrationState = "linked" | "skipped" | "warning" | "created" | "updated" | "unlinked" | "removed";

/** 單一平台的連結結果。 */
export interface PlatformResult {
  state: RegistrationState;
  skillName: string;
  /** state='warning' 時帶失敗或略過原因；linked/skipped 時省略。 */
  message?: string;
}

/**
 * registerTeam 回傳 DTO。
 * skillName=null 表示找不到此 team 的入口 skill；有值表示成功反查到 skill 目錄名。
 * claude: PlatformResult — platforms 包含 'claude' 時才有此欄。
 * codex: PlatformResult — platforms 包含 'codex' 時才有此欄。
 * agy: PlatformResult — platforms 包含 'antigravity' 時才有此欄。
 */
export interface RegisterTeamResult {
  teamId: string;
  skillName: string | null;
  claude?: PlatformResult;
  codex?: PlatformResult;
  agy?: PlatformResult;
}

/** teamRegistry:unregister 請求 payload schema。teamId 或 skillName 至少一個。 */
export const UnregisterTeamSchema = z
  .object({
    teamId: z.string().optional(),
    skillName: z.string().optional(),
    platforms: z.array(z.enum(["claude", "codex", "antigravity"])).optional(),
  })
  .refine((d) => !!(d.teamId || d.skillName), {
    message: "teamId 或 skillName 至少一個",
  });
export type UnregisterTeamPayload = z.infer<typeof UnregisterTeamSchema>;

/**
 * unregisterTeam 回傳 DTO。
 * skillName=null 表示無法反查到 skill。
 * claude/codex — platforms 對應欄位各自包含移除結果。
 * agy — platforms 包含 'antigravity' 時才有此欄。
 */
export interface UnregisterTeamResult {
  teamId: string | null;
  skillName: string | null;
  claude?: PlatformResult;
  codex?: PlatformResult;
  agy?: PlatformResult;
}
