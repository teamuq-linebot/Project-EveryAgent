import type { IpcResult } from "../../../shared/ipcContracts";

export function ok<T = void>(data?: T): IpcResult<T> {
  return { ok: true, data: data as T };
}
export function err<T = void>(error: unknown): IpcResult<T> {
  const msg = error instanceof Error ? error.message : String(error);
  return { ok: false, error: msg };
}
