import React, { useRef } from "react";
import type { Task, RunStateMap } from "../../hooks/useTasks";
import TaskCardPunches from "./TaskCardPunches";

interface Props {
  task: Task;
  runState: "none" | "idle" | "running" | "waiting" | "error" | "completed";
  /** task.platform_local_id 解析後的平台短名（U8 來源徽章；無則 undefined）。 */
  platformName?: string | null;
  /** task.platform_local_id 對應的帳號 user 短名（instanceMeta.accountEmail @ 前段；無則 undefined）。 */
  userShort?: string | null;
  onDoubleClick: (task: Task) => void;
  onDragStart: (task: Task, e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

function safeGet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: Record<string, any>,
  ...keys: string[]
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return "";
    cur = cur[k];
  }
  return typeof cur === "string" ? cur : cur != null ? String(cur) : "";
}

/** 將 ISO 日期字串或 ISO datetime 字串截取日期段（取前 10 碼 YYYY-MM-DD）。 */
function toDateOnly(s: string): string {
  if (!s) return "";
  return s.slice(0, 10);
}

function formatDates(start: string, end: string): string {
  const s = toDateOnly(start);
  const e = toDateOnly(end);
  const parts = [s, e].filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ~ ${parts[1]}`;
}

function TaskCard({
  task,
  runState,
  platformName,
  userShort,
  onDoubleClick,
  onDragStart,
  onDragEnd,
}: Props): React.JSX.Element {
  const raw = task.raw ?? {};
  const msName = safeGet(raw, "milestone", "name");
  const projName = safeGet(raw, "milestone", "project", "name");
  const typeName = safeGet(raw, "typeCategory", "name");
  const assignee = safeGet(raw, "assignee", "name");
  const startDate = safeGet(raw, "startDate") || String(raw.start_date ?? "");
  const endDate = safeGet(raw, "endDate") || String(raw.end_date ?? "");
  const dateText = formatDates(startDate, endDate);
  const msParts = [projName, msName].filter(Boolean).join(" · ");

  // 版本：milestone.order + task.order
  const msOrder =
    safeGet(raw, "milestone", "order") || safeGet(raw, "milestoneOrder");
  const taskOrder = String(raw.order ?? raw.taskOrder ?? "");
  const version = msOrder && taskOrder ? `v${msOrder}.${taskOrder}` : "";

  const titleRef = useRef<HTMLDivElement>(null);

  const tooltip =
    runState === "running"
      ? "正在執行…"
      : runState === "waiting"
        ? "等待你的決定…"
        : runState === "completed"
          ? "對話已完成"
          : runState === "idle"
            ? "session 開啟（閒置）"
            : runState === "error"
              ? "CLI 發生錯誤"
              : "";

  return (
    <div
      className={`task-card task-card--${runState}`}
      draggable
      title={tooltip}
      onDragStart={(e) => onDragStart(task, e)}
      onDragEnd={onDragEnd}
      onDoubleClick={() => onDoubleClick(task)}
    >
      <div className="task-card__header" ref={titleRef}>
        {runState === "completed" && (
          <span
            className="task-card__dot task-card__dot--completed"
            title="對話已完成"
            aria-label="對話已完成"
          />
        )}
        <span className="task-card__name">{task.name || "(未命名)"}</span>
        {version && <span className="task-card__version">{version}</span>}
      </div>
      {msParts && <div className="task-card__meta">🎯 {msParts}</div>}
      {typeName && <div className="task-card__meta">🏷 {typeName}</div>}
      {dateText && <div className="task-card__meta">🗓 {dateText}</div>}
      {assignee && <div className="task-card__meta">👤 {assignee}</div>}
      {/* 底部可收合「打卡紀錄」列表（預設收合；展開讀本任務打卡）。 */}
      <TaskCardPunches taskId={task.id} />
    </div>
  );
}

/**
 * React.memo 包裝：看板背景輪詢 / 父層 re-render 時，props 未變的卡片不重繪
 * （次要閃源消除）。runState / task / 回呼引用不變即跳過 render。
 */
export default React.memo(TaskCard);

export type { RunStateMap };
