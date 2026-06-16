import { ipcRenderer } from "electron";
import {
  AGENT_CONV_CHANNELS,
  AgentConvOpenPayload,
  AgentConvMessagesPayload,
  AgentConvRawPayload,
  AgentConvPromptStatePayload,
  AgentConvSessionDto,
  ConversationMessage,
  ConversationWindowResult,
  SegmentListResult,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.agentConv — AgentTeams 專屬對話（agentteams-embedded-conversation；plan_v2 §4.1）
// 與 session 子系統完全平行；不沿用 pty:* channel。
// ---------------------------------------------------------------------------

export const agentConv = {
  open(payload: AgentConvOpenPayload): Promise<IpcResult<{ conversationId: string }>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.OPEN, payload);
  },
  sendInput(conversationId: string, text: string): Promise<IpcResult> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.INPUT, { conversationId, text });
  },
  resize(conversationId: string, cols: number, rows: number): Promise<IpcResult> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.RESIZE, {
      conversationId,
      cols,
      rows,
    });
  },
  close(conversationId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.CLOSE, { conversationId });
  },
  hide(conversationId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.HIDE, { conversationId });
  },
  getBuffer(conversationId: string): Promise<IpcResult<{ buffer: string }>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.BUFFER, { conversationId });
  },
  listSessions(): Promise<IpcResult<AgentConvSessionDto[]>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.LIST_SESSIONS);
  },
  getConversationWindow(
    conversationId: string,
  ): Promise<IpcResult<ConversationWindowResult>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.GET_CONVERSATION_WINDOW, {
      conversationId,
    });
  },
  getSegments(conversationId: string): Promise<IpcResult<SegmentListResult>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.GET_SEGMENTS, { conversationId });
  },
  getSegmentMessages(
    conversationId: string,
    startSeq: number,
    endSeq: number,
  ): Promise<IpcResult<{ ok: boolean; messages: ConversationMessage[] }>> {
    return ipcRenderer.invoke(AGENT_CONV_CHANNELS.GET_SEGMENT_MESSAGES, {
      conversationId,
      startSeq,
      endSeq,
    });
  },
};

export function onAgentConvMessages(
  cb: (payload: AgentConvMessagesPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: AgentConvMessagesPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(AGENT_CONV_CHANNELS.MESSAGES, handler);
  return () => {
    ipcRenderer.removeListener(AGENT_CONV_CHANNELS.MESSAGES, handler);
  };
}

export function onAgentConvRaw(
  cb: (payload: AgentConvRawPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: AgentConvRawPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(AGENT_CONV_CHANNELS.RAW, handler);
  return () => {
    ipcRenderer.removeListener(AGENT_CONV_CHANNELS.RAW, handler);
  };
}

export function onAgentConvPromptState(
  cb: (payload: AgentConvPromptStatePayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: AgentConvPromptStatePayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(AGENT_CONV_CHANNELS.PROMPT_STATE, handler);
  return () => {
    ipcRenderer.removeListener(AGENT_CONV_CHANNELS.PROMPT_STATE, handler);
  };
}
