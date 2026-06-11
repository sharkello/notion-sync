/**
 * Tracks whether a sync run is active and whether an abort was requested.
 * Exactly one run may hold the lock at a time; nested operations (e.g.
 * rebuild running a full sync) execute within the caller's run instead
 * of acquiring it again.
 */
export class SyncControl {
  private syncing = false;
  private abortRequested = false;

  get isSyncing(): boolean {
    return this.syncing;
  }

  get aborted(): boolean {
    return this.abortRequested;
  }

  /** Try to start a run. Returns false if one is already in progress. */
  begin(): boolean {
    if (this.syncing) return false;
    this.syncing = true;
    this.abortRequested = false;
    return true;
  }

  /** Mark the current run as finished. */
  end(): void {
    this.syncing = false;
  }

  /** Request that the current run stop at the next checkpoint. */
  abort(): void {
    this.abortRequested = true;
  }
}
