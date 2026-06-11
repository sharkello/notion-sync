export type ProgressCallback = (text: string, percent: number) => void;

/**
 * Fan-out point for sync progress. The UI registers a callback;
 * services report through this object without knowing about the UI.
 */
export class ProgressReporter {
  private callback: ProgressCallback | null = null;

  set(callback: ProgressCallback | null): void {
    this.callback = callback;
  }

  report(text: string, percent: number): void {
    this.callback?.(text, percent);
  }
}
