import { contextBridge, ipcRenderer } from "electron";

import { pty, onPtyData, onPtyExit } from "./bridges/ptyBridge";
import { tasks } from "./bridges/tasksBridge";
import { session } from "./bridges/sessionBridge";
import {
  monitor,
  onMonitorRender,
  onMonitorStatus,
  onCardRunState,
  onCardWorkflowProgress,
  onPromptAlert,
} from "./bridges/monitorBridge";
import { punches } from "./bridges/punchesBridge";
import { config } from "./bridges/configBridge";
import { settings } from "./bridges/settingsBridge";
import { projects } from "./bridges/projectsBridge";
import { milestones } from "./bridges/milestonesBridge";
import { dialogBridge, clipboardBridge, admin } from "./bridges/systemBridge";
import { agentOrg } from "./bridges/agentOrgBridge";
import { teamRegistry } from "./bridges/teamRegistryBridge";
import {
  agentConv,
  onAgentConvMessages,
  onAgentConvRaw,
  onAgentConvPromptState,
} from "./bridges/agentConvBridge";
import { cliBackend } from "./bridges/cliBackendBridge";
import { agentRegistry } from "./bridges/agentRegistryBridge";
import { initProgress, onInitProgress } from "./bridges/initProgressBridge";

// ---------------------------------------------------------------------------
// Event listeners — main → renderer (push)
// Returns a cleanup/unsubscribe function.
// ---------------------------------------------------------------------------

// 每個 SessionTab 各自訂閱 monitor:render / monitor:status / card:runState，
// 最多 ~50 個 session 同時 mount（display:none 常駐），每 channel 最多 50 listener。
// 預設上限 10 不夠；設 0 = unlimited 以避免 MaxListenersExceededWarning。
// cleanup 由呼叫端 useEffect return 呼叫 removeListener，不存在真洩漏。
ipcRenderer.setMaxListeners(0);

// ---------------------------------------------------------------------------
// Expose under window.tuq
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld("tuq", {
  tasks,
  session,
  monitor,
  punches,
  pty,
  config,
  settings,
  projects,
  milestones,
  dialog: dialogBridge,
  clipboard: clipboardBridge,
  admin,
  agentOrg,
  teamRegistry,
  agentConv,
  cliBackend,
  agentRegistry,
  initProgress,
  onInitProgress,
  onPtyData,
  onPtyExit,
  onMonitorRender,
  onMonitorStatus,
  onCardRunState,
  onCardWorkflowProgress,
  onPromptAlert,
  onAgentConvMessages,
  onAgentConvRaw,
  onAgentConvPromptState,
});
