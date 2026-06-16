import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  SESSION_CHANNELS,
  SessionOpenSchema,
  SessionCloseSchema,
  SessionListSchema,
  SessionRenameSchema,
  SessionGetConversationSchema,
  SessionSetProjectSchema,
  SessionListSkillsSchema,
  SessionGetSubagentConversationSchema,
  SessionGetWorkflowAgentConversationSchema,
  SessionGetConversationWindowSchema,
  SessionGetSegmentsSchema,
  SessionGetSegmentMessagesSchema,
  SessionGetRawLinesSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerSessionHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Session handlers
  // --------------------------------------------------------------------------

  ipcMain.handle(
    SESSION_CHANNELS.OPEN,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionOpenSchema.parse(raw);
        const info = backend.sessions.openSession({
          taskId: payload.taskId,
          projectPath: payload.projectPath,
          milestoneId: payload.milestoneId,
          tool: payload.tool,
          customCommand: payload.customCommand,
          forceNewSession: payload.forceNewSession,
        });
        return ok(info);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.CLOSE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = SessionCloseSchema.parse(raw);
        backend.sessions.closeSession(payload.sessionId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.LIST_ACTIVE,
    (_event: IpcMainInvokeEvent): IpcResult<unknown> => {
      try {
        // 無 payload：列 main 端「實際存在」的所有 session（含 headless 恢復的）。
        // renderer 啟動時據此 hydrate tab → 三者一致。
        return ok(backend.sessions.listActiveSessions());
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.LIST_SESSIONS,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionListSchema.parse(raw);
        return ok(backend.conversations.listProjectSessions(payload.sessionId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.RENAME,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<{ ok: boolean }> => {
      try {
        const payload = SessionRenameSchema.parse(raw);
        return ok({
          ok: backend.conversations.renameSession(payload.sessionId, payload.customTitle),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_CONVERSATION,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetConversationSchema.parse(raw);
        return ok(backend.conversations.getSessionConversation(payload.sessionId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.SET_PROJECT,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<unknown>> => {
      try {
        const payload = SessionSetProjectSchema.parse(raw);
        const result = await backend.sessions.setSessionProject(
          payload.sessionId,
          payload.projectPath,
          payload.tool,
        );
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.LIST_SKILLS,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionListSkillsSchema.parse(raw);
        return ok(backend.conversations.listSkills(payload.sessionId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_SUBAGENT_CONVERSATION,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetSubagentConversationSchema.parse(raw);
        return ok(
          backend.conversations.getSubagentConversation(payload.sessionId, payload.toolUseId),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_WORKFLOW_AGENT_CONVERSATION,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetWorkflowAgentConversationSchema.parse(raw);
        return ok(
          backend.getWorkflowAgentConversation(
            payload.sessionId,
            payload.runId,
            payload.agentId,
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_CONVERSATION_WINDOW,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetConversationWindowSchema.parse(raw);
        return ok(backend.conversations.getConversationWindow(payload.sessionId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_SEGMENTS,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetSegmentsSchema.parse(raw);
        return ok(backend.conversations.getSegments(payload.sessionId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_SEGMENT_MESSAGES,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetSegmentMessagesSchema.parse(raw);
        return ok(
          backend.conversations.getSegmentMessages(
            payload.sessionId,
            payload.startSeq,
            payload.endSeq,
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SESSION_CHANNELS.GET_RAW_LINES,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = SessionGetRawLinesSchema.parse(raw);
        return ok(
          backend.conversations.getRawLines(
            payload.sessionId,
            payload.startSeq,
            payload.endSeq,
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
