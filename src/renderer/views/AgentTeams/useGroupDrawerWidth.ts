/**
 * useGroupDrawerWidth.ts — 分組設定抽屜可拖拉寬度（Batch 2）
 *
 * 仿 Management/projectManagement/useListLayout.ts 的拖拉骨架
 * （draggingRef/dragStartXRef/dragStartWidthRef/lastWidthRef + mousedown handler +
 * document mousemove/mouseup useEffect），差異：
 *   - 抽屜在右側：向左拖（負 delta）→ 增寬（delta = startX - clientX）
 *   - clamp：min 420px、max 視窗寬 80%（動態，依拖拉當下 window.innerWidth）
 *   - localStorage key：agentTeams.groupDrawerWidth；讀取時同樣 clamp 防壞值
 *
 * clamp / 讀取邏輯抽成純函式（clampGroupDrawerWidth / readStoredGroupDrawerWidth）
 * 供 vitest（node 環境，無 DOM）直接測試。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

export const GROUP_DRAWER_WIDTH_KEY = "agentTeams.groupDrawerWidth";
export const GROUP_DRAWER_MIN_W = 420;
export const GROUP_DRAWER_MAX_VIEWPORT_RATIO = 0.8;
export const GROUP_DRAWER_DEFAULT_W = 640;

/**
 * clamp 抽屜寬度：min 420、max = 視窗寬 80%（取整）。
 * 非有限數（NaN/Infinity）→ 回 clamp 後的預設寬 640。
 * 視窗極窄（80% < min）時 max 以 min 為下限，避免 min > max 反轉。
 */
export function clampGroupDrawerWidth(value: number, viewportWidth: number): number {
  const max = Math.max(
    GROUP_DRAWER_MIN_W,
    Math.round(viewportWidth * GROUP_DRAWER_MAX_VIEWPORT_RATIO),
  );
  if (!Number.isFinite(value)) return Math.min(GROUP_DRAWER_DEFAULT_W, max);
  return Math.min(max, Math.max(GROUP_DRAWER_MIN_W, value));
}

/**
 * 解析 localStorage 原始字串 → 寬度。
 * null / 空白字串（未存過）→ 預設 640（仍過 clamp）；壞值（NaN）→ 同預設。
 */
export function readStoredGroupDrawerWidth(raw: string | null, viewportWidth: number): number {
  if (raw === null || raw.trim() === "") {
    return clampGroupDrawerWidth(GROUP_DRAWER_DEFAULT_W, viewportWidth);
  }
  return clampGroupDrawerWidth(Number(raw), viewportWidth);
}

/**
 * useGroupDrawerWidth — 分組設定抽屜（右側 docked）寬度狀態 + 拖拉 handler。
 * 把手 mousedown 後跟隨 document mousemove 即時改寬；mouseup 寫回 localStorage。
 * 拖拉中設 body user-select:none / cursor:col-resize 防選字。
 */
export function useGroupDrawerWidth(): {
  width: number;
  handleResizeStart: (e: React.MouseEvent) => void;
} {
  const [width, setWidth] = useState<number>(() => {
    try {
      return readStoredGroupDrawerWidth(
        localStorage.getItem(GROUP_DRAWER_WIDTH_KEY),
        window.innerWidth,
      );
    } catch {
      return GROUP_DRAWER_DEFAULT_W;
    }
  });
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const lastWidthRef = useRef(width);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // 抽屜在右側：向左拖（clientX 變小）→ 增寬
      const delta = dragStartXRef.current - e.clientX;
      const next = clampGroupDrawerWidth(dragStartWidthRef.current + delta, window.innerWidth);
      lastWidthRef.current = next;
      setWidth(next);
    };
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        localStorage.setItem(GROUP_DRAWER_WIDTH_KEY, String(lastWidthRef.current));
      } catch {
        /* storage 不可寫：非致命 */
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // cleanup：意外 unmount 時恢復 body style
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return { width, handleResizeStart };
}
