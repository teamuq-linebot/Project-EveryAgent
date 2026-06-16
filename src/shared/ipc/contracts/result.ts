// ---------------------------------------------------------------------------
// Type-safe IPC result wrapper
// ---------------------------------------------------------------------------

export interface IpcOk<T = void> {
  ok: true;
  data: T;
}
export interface IpcErr {
  ok: false;
  error: string;
}
export type IpcResult<T = void> = IpcOk<T> | IpcErr;
