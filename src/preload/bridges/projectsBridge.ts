import { ipcRenderer } from "electron";
import {
  PROJECT_CHANNELS,
  ProjectsFindAllPayload,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ProjectsByFolderPayload,
  ProjectsByFolderResult,
  ProjectsFoldersByProjectPayload,
  ProjectsFoldersByProjectResult,
  ProjectsFindAllResult,
  ProjectDto,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.projects — 本地專案 CRUD（Phase 6.5 sidebar 管理 UI）
// ---------------------------------------------------------------------------

export const projects = {
  findAll(
    payload?: ProjectsFindAllPayload,
  ): Promise<IpcResult<ProjectsFindAllResult>> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.FIND_ALL, payload ?? {});
  },
  create(payload: ProjectCreatePayload): Promise<IpcResult<ProjectDto>> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.CREATE, payload);
  },
  update(payload: ProjectUpdatePayload): Promise<IpcResult<ProjectDto>> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.UPDATE, payload);
  },
  delete(localId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.DELETE, { localId });
  },
  // 團隊對話 session：專案↔資料夾多對多反查。
  byFolder(
    payload: ProjectsByFolderPayload,
  ): Promise<IpcResult<ProjectsByFolderResult>> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.BY_FOLDER, payload);
  },
  foldersByProject(
    payload: ProjectsFoldersByProjectPayload,
  ): Promise<IpcResult<ProjectsFoldersByProjectResult>> {
    return ipcRenderer.invoke(PROJECT_CHANNELS.FOLDERS_BY_PROJECT, payload);
  },
};
