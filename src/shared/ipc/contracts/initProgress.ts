/**
 * 初始化逐步驟進度通道（init-progress-pipeline）。
 * main 端在啟動各步驟回報白話進度，透過 IPC 推給 renderer 的開機畫面（boot splash）逐步顯示。
 *   UPDATE — main→renderer push（全量快照；每次推送都是目前完整 InitProgressState）
 *   GET    — renderer→main invoke（無入參，回 InitProgressState；供 splash 掛載時補拉）
 */
export const INIT_PROGRESS_CHANNELS = {
  UPDATE: "init:progress",       // main→renderer push（全量快照）
  GET: "init:progress:get",      // renderer→main invoke（無入參，回 InitProgressState）
} as const;

export type InitProgressStatus = "running" | "done" | "error";

export interface InitProgressStep {
  phase: string;        // 穩定機器 key（renderer 不顯示，僅去重/排序）
  label: string;        // 白話文案（直接塞進 splash 狀態列）
  status: InitProgressStatus;
}

export interface InitProgressState {
  steps: InitProgressStep[];
  current: InitProgressStep | null;  // 便利欄＝最後一筆
  done: boolean;                     // 整體初始化是否全部完成（splash 淡出總閘門）
}
