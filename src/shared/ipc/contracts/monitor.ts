import { z } from "zod";
import type { PunchRow } from "./punch";

export const MONITOR_CHANNELS = {
  START: "monitor:start",
  STOP: "monitor:stop",
  RENDER: "monitor:render",
  STATUS: "monitor:status",
  REBIND: "monitor:rebind",
} as const;

export const MonitorStartSchema = z.object({
  sessionId: z.string().min(1),
  taskId: z.string().min(1),
  projectPath: z.string(),
  milestoneId: z.string().nullish(),
  sinceMs: z.number().optional(),
});
export type MonitorStartPayload = z.infer<typeof MonitorStartSchema>;

export const MonitorStopSchema = z.object({
  sessionId: z.string().min(1),
});
export type MonitorStopPayload = z.infer<typeof MonitorStopSchema>;

export const MonitorRebindSchema = z.object({
  sessionId: z.string().min(1),
  /** 要改綁的真實 claude session uuid；null = 新開一個 session（生成新 uuid）。 */
  claudeSessionId: z.string().nullable(),
});
export type MonitorRebindPayload = z.infer<typeof MonitorRebindSchema>;

/** monitor:render payload pushed from main → renderer. */
export interface MonitorRenderPayload {
  sessionId: string;
  rows: PunchRow[];
  canPunch: boolean;
}

/** monitor:status payload pushed from main → renderer. */
export interface MonitorStatusPayload {
  sessionId: string;
  text: string;
}
