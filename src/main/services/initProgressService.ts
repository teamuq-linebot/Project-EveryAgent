import { INIT_PROGRESS_CHANNELS } from "../../shared/ipcContracts";
import type { InitProgressState, InitProgressStep } from "../../shared/ipcContracts";

// ⚠️ 為避免與 backend.ts 循環 import（backend 之後會 import 本 service），
//    這裡用最小本地 EmitFn 型別，不從 backend import：
type EmitFn = (channel: string, payload: unknown) => void;

let state: InitProgressState = { steps: [], current: null, done: false };
let emit: EmitFn | null = null;

function pushAndEmit(step: InitProgressStep): void {
  state.steps.push(step);
  state.current = step;
  try { emit?.(INIT_PROGRESS_CHANNELS.UPDATE, state); } catch { /* renderer 未訂閱/視窗未就緒，忽略；靠 get 補拉 */ }
}

export const initProgressService = {
  setEmit(e: EmitFn): void {
    emit = e;
    try { emit(INIT_PROGRESS_CHANNELS.UPDATE, state); } catch { /* best-effort 重放 */ }
  },
  report(phase: string, label: string, status: InitProgressStep["status"] = "running"): void {
    pushAndEmit({ phase, label, status });
  },
  markDone(label = "一切就緒"): void {
    state.done = true;
    pushAndEmit({ phase: "done", label, status: "done" });
  },
  getState(): InitProgressState {
    return state;
  },
};
