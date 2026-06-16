import type { PtyManager } from "../../pty/ptyManager";
import type { Backend } from "../../backend";

export interface HandlerContext {
  ptyManager: PtyManager;
  backend: Backend;
}
