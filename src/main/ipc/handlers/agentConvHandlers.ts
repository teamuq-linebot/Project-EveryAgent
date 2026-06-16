import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  AGENT_CONV_CHANNELS,
  AgentConvOpenSchema,
  AgentConvInputSchema,
  AgentConvResizeSchema,
  AgentConvCloseSchema,
  AgentConvHideSchema,
  AgentConvGetConversationWindowSchema,
  AgentConvGetSegmentsSchema,
  AgentConvGetSegmentMessagesSchema,
  type AgentConvSessionDto,
  IpcResult,
} from "../../../shared/ipcContracts";
import { z } from "zod";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";
import { buildAgentConvLaunchCommand } from "../../services/agentConvLaunch";

export function registerAgentConvHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // AgentConv handlers（AgentTeams 專屬對話；與 pty:*/session:* 完全平行）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_CONV_CHANNELS.OPEN,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<{ conversationId: string }> => {
      try {
        const p = AgentConvOpenSchema.parse(raw);
        const launchCommand = buildAgentConvLaunchCommand(p.cliId ?? 'claude', p.conversationId, p.resume);
        const id = backend.agentConv.open({
          conversationId: p.conversationId,
          cwd: p.cwd,
          launchCommand,
          initialPrompt: p.initialPrompt ?? null,
          label: p.label ?? null,
          initialSkill: p.initialSkill ?? null,
          cliId: p.cliId ?? 'claude',
          resume: p.resume ?? false,
        });
        return ok({ conversationId: id });
      } catch (e) {
        // main 端把真因 + stack 印出（renderer 只拿到攤平字串）。
        console.error("[router] agentConv:open failed:", e);
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.INPUT,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const p = AgentConvInputSchema.parse(raw);
        backend.agentConv.sendInput(p.conversationId, p.text);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.CLOSE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const p = AgentConvCloseSchema.parse(raw);
        backend.agentConv.close(p.conversationId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.HIDE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const p = AgentConvHideSchema.parse(raw);
        backend.agentConv.hide(p.conversationId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.BUFFER,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<{ buffer: string }> => {
      try {
        const p = z.object({ conversationId: z.string().uuid() }).parse(raw);
        const buffer = backend.agentConv.getBuffer(p.conversationId);
        return ok({ buffer });
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.LIST_SESSIONS,
    (): IpcResult<AgentConvSessionDto[]> => {
      try {
        const rows = backend.agentConv.listSessions(30).map((r) => ({
          conversationId: r.conversationId,
          label: r.label,
          cliId: r.cliId,
          cwd: r.cwd,
          initialPrompt: r.initialPrompt,
          initialSkill: r.skillName,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        return ok(rows);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.RESIZE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const p = AgentConvResizeSchema.parse(raw);
        backend.agentConv.resize(p.conversationId, p.cols, p.rows);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.GET_CONVERSATION_WINDOW,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const p = AgentConvGetConversationWindowSchema.parse(raw);
        return ok(backend.agentConv.getConversationWindow(p.conversationId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.GET_SEGMENTS,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const p = AgentConvGetSegmentsSchema.parse(raw);
        return ok(backend.agentConv.getSegments(p.conversationId));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_CONV_CHANNELS.GET_SEGMENT_MESSAGES,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const p = AgentConvGetSegmentMessagesSchema.parse(raw);
        return ok(
          backend.agentConv.getSegmentMessages(
            p.conversationId,
            p.startSeq,
            p.endSeq,
          ),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
