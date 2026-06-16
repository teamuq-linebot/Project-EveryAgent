import { PtyManager } from "../pty/ptyManager";
import type { Backend } from "../backend";
import type { HandlerContext } from "./handlers/context";
import { ok, err } from "./handlers/result";
import { registerPtyHandlers } from "./handlers/ptyHandlers";
import { registerTaskHandlers } from "./handlers/taskHandlers";
import { registerSessionHandlers } from "./handlers/sessionHandlers";
import { registerMonitorHandlers } from "./handlers/monitorHandlers";
import { registerPunchHandlers } from "./handlers/punchHandlers";
import { registerConfigHandlers } from "./handlers/configHandlers";
import { registerProjectHandlers } from "./handlers/projectHandlers";
import { registerMilestoneHandlers } from "./handlers/milestoneHandlers";
import { registerDialogHandlers } from "./handlers/dialogHandlers";
import { registerClipboardHandlers } from "./handlers/clipboardHandlers";
import { registerAdminHandlers } from "./handlers/adminHandlers";
import { registerAgentOrgHandlers } from "./handlers/agentOrgHandlers";
import { registerCliHandlers } from "./handlers/cliHandlers";
import { registerTeamRegistryHandlers } from "./handlers/teamRegistryHandlers";
import { registerAgentConvHandlers } from "./handlers/agentConvHandlers";
import { registerAgentRegistryHandlers } from "./handlers/agentRegistryHandlers";
import { registerInitProgressHandlers } from "./handlers/initProgressHandlers";

// 零成本保險：歷史上 ok/err 定義於本檔；雖經 grep 確認無外部 consumer，
// 仍 re-export 以保留既有 import path（registerIpcHandlers 對外介面不受影響）。
export { ok, err };

export function registerIpcHandlers(
  ptyManager: PtyManager,
  backend: Backend,
): void {
  const ctx: HandlerContext = { ptyManager, backend };

  // 依原檔 ipcMain.handle 出現順序註冊各域 handler（嚴格 move-only，順序不變）。
  registerPtyHandlers(ctx);
  registerTaskHandlers(ctx);
  registerSessionHandlers(ctx);
  registerMonitorHandlers(ctx);
  registerPunchHandlers(ctx);
  registerConfigHandlers(ctx);
  registerProjectHandlers(ctx);
  registerMilestoneHandlers(ctx);
  registerDialogHandlers(ctx);
  registerClipboardHandlers(ctx);
  registerAdminHandlers(ctx);
  registerAgentOrgHandlers(ctx);
  registerCliHandlers(ctx);
  registerTeamRegistryHandlers(ctx);
  registerAgentConvHandlers(ctx);
  registerAgentRegistryHandlers(ctx);
  registerInitProgressHandlers(ctx);
}
