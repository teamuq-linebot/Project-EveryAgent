import { ipcRenderer } from "electron";
import {
  INIT_PROGRESS_CHANNELS,
  InitProgressState,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.initProgress — 初始化逐步驟進度（init-progress-pipeline）
// GET：splash 掛載時補拉目前快照；onInitProgress：訂閱 main→renderer 全量推送。
// ---------------------------------------------------------------------------

export const initProgress = {
  get(): Promise<IpcResult<InitProgressState>> {
    return ipcRenderer.invoke(INIT_PROGRESS_CHANNELS.GET);
  },
};

export function onInitProgress(
  cb: (state: InitProgressState) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: InitProgressState,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(INIT_PROGRESS_CHANNELS.UPDATE, handler);
  return () => {
    ipcRenderer.removeListener(INIT_PROGRESS_CHANNELS.UPDATE, handler);
  };
}
