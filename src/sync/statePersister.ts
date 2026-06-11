import type { StateManager } from "../stateManager";
import { errMsg } from "../utils";

export type PersistCallback = () => Promise<void>;

/**
 * Saves sync state to disk incrementally during a run. Without this,
 * an interrupted sync (crash, app quit) loses every mapping created so
 * far and the next sync re-creates the same pages in Notion.
 *
 * Persistence failures are logged but never abort a sync.
 */
export class StatePersister {
  private callback: PersistCallback | null = null;

  constructor(private readonly stateManager: StateManager) {}

  set(callback: PersistCallback | null): void {
    this.callback = callback;
  }

  async persist(): Promise<void> {
    try {
      await this.callback?.();
    } catch (e) {
      this.stateManager.addLog("warn", `Failed to persist state: ${errMsg(e)}`);
    }
  }
}
