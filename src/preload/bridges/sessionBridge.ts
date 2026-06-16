import { ipcRenderer } from "electron";
import {
  SESSION_CHANNELS,
  SessionOpenPayload,
  SessionInfo,
  BindSessionItem,
  ConversationMessage,
  SessionProjectResult,
  SkillItem,
  SubagentConversationResult,
  ConversationWindowResult,
  SegmentListResult,
  RawLinesResult,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.session — session 開關
// ---------------------------------------------------------------------------

export const session = {
  open(payload: SessionOpenPayload): Promise<IpcResult<SessionInfo>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.OPEN, payload);
  },
  close(sessionId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(SESSION_CHANNELS.CLOSE, { sessionId });
  },
  /**
   * 列出 main 端「實際存在」的所有 session（含 app 重啟 headless recoverMonitoring 恢復的）。
   * renderer 啟動時 hydrate tab → 「card 閃 / 監測列表 / backend 監測集合」三者一致。
   */
  listActive(): Promise<IpcResult<SessionInfo[]>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.LIST_ACTIVE);
  },
  listSessions(sessionId: string): Promise<IpcResult<BindSessionItem[]>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.LIST_SESSIONS, { sessionId });
  },
  rename(
    sessionId: string,
    customTitle: string,
  ): Promise<IpcResult<{ ok: boolean }>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.RENAME, {
      sessionId,
      customTitle,
    });
  },
  getConversation(
    sessionId: string,
  ): Promise<IpcResult<ConversationMessage[]>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_CONVERSATION, { sessionId });
  },
  setProject(
    sessionId: string,
    projectPath: string,
    tool?: string,
  ): Promise<IpcResult<SessionProjectResult>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.SET_PROJECT, {
      sessionId,
      projectPath,
      tool,
    });
  },
  listSkills(sessionId: string): Promise<IpcResult<SkillItem[]>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.LIST_SKILLS, { sessionId });
  },
  getSubagentConversation(
    sessionId: string,
    toolUseId: string,
  ): Promise<IpcResult<SubagentConversationResult>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_SUBAGENT_CONVERSATION, {
      sessionId,
      toolUseId,
    });
  },
  getWorkflowAgentConversation(
    sessionId: string,
    runId: string,
    agentId: string,
  ): Promise<IpcResult<SubagentConversationResult>> {
    return ipcRenderer.invoke(
      SESSION_CHANNELS.GET_WORKFLOW_AGENT_CONVERSATION,
      { sessionId, runId, agentId },
    );
  },
  getConversationWindow(
    sessionId: string,
  ): Promise<IpcResult<ConversationWindowResult>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_CONVERSATION_WINDOW, {
      sessionId,
    });
  },
  getSegments(sessionId: string): Promise<IpcResult<SegmentListResult>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_SEGMENTS, { sessionId });
  },
  getSegmentMessages(
    sessionId: string,
    startSeq: number,
    endSeq: number,
  ): Promise<IpcResult<{ ok: boolean; messages: ConversationMessage[] }>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_SEGMENT_MESSAGES, {
      sessionId,
      startSeq,
      endSeq,
    });
  },
  getRawLines(
    sessionId: string,
    startSeq: number,
    endSeq: number,
  ): Promise<IpcResult<RawLinesResult>> {
    return ipcRenderer.invoke(SESSION_CHANNELS.GET_RAW_LINES, {
      sessionId,
      startSeq,
      endSeq,
    });
  },
};
