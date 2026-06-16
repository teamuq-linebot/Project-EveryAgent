import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  PROJECT_CHANNELS,
  ProjectsFindAllSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectDeleteSchema,
  ProjectsByFolderSchema,
  ProjectsFoldersByProjectSchema,
  ProjectsFindAllResult,
  ProjectsByFolderResult,
  ProjectsFoldersByProjectResult,
  ProjectDto,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerProjectHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Project handlers（本地專案 CRUD；Phase 6.5 sidebar 管理 UI，§2.6 / §4c）
  // 走本地 repo（backend.findAll/create/update/deleteProject），免登入全功能（§3）。
  // --------------------------------------------------------------------------

  ipcMain.handle(
    PROJECT_CHANNELS.FIND_ALL,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<ProjectsFindAllResult> => {
      try {
        const payload = ProjectsFindAllSchema.parse(raw ?? {});
        return ok<ProjectsFindAllResult>(
          backend.projects.findAllProjects({
            search: payload?.search ?? null,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PROJECT_CHANNELS.CREATE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<ProjectDto> => {
      try {
        const payload = ProjectCreateSchema.parse(raw);
        return ok<ProjectDto>(
          backend.projects.createProject({
            name: payload.name,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PROJECT_CHANNELS.UPDATE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<ProjectDto> => {
      try {
        const payload = ProjectUpdateSchema.parse(raw);
        return ok<ProjectDto>(
          backend.projects.updateProject({
            localId: payload.localId,
            name: payload.name,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PROJECT_CHANNELS.DELETE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = ProjectDeleteSchema.parse(raw);
        backend.projects.deleteProject(payload.localId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  // 團隊對話 session：專案↔資料夾多對多反查（路徑逐字相等比對）。
  ipcMain.handle(
    PROJECT_CHANNELS.BY_FOLDER,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<ProjectsByFolderResult> => {
      try {
        const payload = ProjectsByFolderSchema.parse(raw);
        return ok<ProjectsByFolderResult>(
          backend.projects.findProjectsByFolder(payload.folderPath),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PROJECT_CHANNELS.FOLDERS_BY_PROJECT,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<ProjectsFoldersByProjectResult> => {
      try {
        const payload = ProjectsFoldersByProjectSchema.parse(raw);
        return ok<ProjectsFoldersByProjectResult>(
          backend.projects.findFoldersByProject(payload.projectLocalId),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
