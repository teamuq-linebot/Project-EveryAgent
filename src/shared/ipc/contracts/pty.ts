import { z } from "zod";

export const PTY_CHANNELS = {
  SPAWN: "pty:spawn",
  WRITE: "pty:write",
  RESIZE: "pty:resize",
  KILL: "pty:kill",
  DATA: "pty:data",
  /** main → renderer：PTY 子行程結束（含正常結束 exitCode=0 與非零）。 */
  EXIT: "pty:exit",
} as const;

export const PtySpawnSchema = z.object({
  id: z.string().min(1),
  /** shell executable; defaults to OS-appropriate shell if omitted */
  shell: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  cols: z.number().int().positive().default(80),
  rows: z.number().int().positive().default(24),
});
export type PtySpawnPayload = z.infer<typeof PtySpawnSchema>;

export const PtyWriteSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});
export type PtyWritePayload = z.infer<typeof PtyWriteSchema>;

export const PtyResizeSchema = z.object({
  id: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type PtyResizePayload = z.infer<typeof PtyResizeSchema>;

export const PtyKillSchema = z.object({
  id: z.string().min(1),
});
export type PtyKillPayload = z.infer<typeof PtyKillSchema>;

export const PtyDataSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});
export type PtyDataPayload = z.infer<typeof PtyDataSchema>;

export const PtyExitSchema = z.object({
  id: z.string().min(1),
  exitCode: z.number().int(),
});
export type PtyExitPayload = z.infer<typeof PtyExitSchema>;
