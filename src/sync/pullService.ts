import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import type { StateManager } from "../stateManager";
import type { NotionToMarkdown } from "../notionToMarkdown";
import type { NotionApi, PullFileResult, PullResult } from "./contracts";
import type { ImageDownloader } from "./imageDownloader";
import type { ProgressReporter } from "./progressReporter";
import type { SyncControl } from "./syncControl";
import type { WikiLinkRestorer } from "./wikiLinkRestorer";
import { errMsg, hashContent } from "../utils";

export interface PullServiceDeps {
  app: App;
  notion: NotionApi;
  stateManager: StateManager;
  n2md: NotionToMarkdown;
  wikiLinks: WikiLinkRestorer;
  images: ImageDownloader;
  progress: ProgressReporter;
  control: SyncControl;
}

/**
 * Pulls mapped pages from Notion back into the vault, overwriting local
 * files. Notion is the source of truth when pulling — no conflict checks.
 */
export class PullService {
  constructor(private readonly deps: PullServiceDeps) {}

  /**
   * Pull a single file from Notion → always overwrites the local file.
   *
   * 'pulled'     – file overwritten from Notion
   * 'no_change'  – Notion hasn't changed since last sync
   * 'not_mapped' – no Notion page mapped for this file
   */
  async pullFile(file: TFile): Promise<PullFileResult> {
    const { app, notion, stateManager } = this.deps;

    const mapping = stateManager.getFileMapping(file.path);
    if (!mapping) return "not_mapped";

    const page = await notion.getPage(mapping.notionPageId);
    if (!page || page.archived) return "not_mapped";

    // Save snapshot before overwriting
    const snapshot = await app.vault.cachedRead(file);
    stateManager.addHistoryEntry({
      timestamp: Date.now(),
      operation: "pull",
      filePath: file.path,
      fileName: file.basename,
      snapshot,
    });

    // Always fetch and overwrite — no conflict check
    const blocks = await notion.getBlocksWithContent(mapping.notionPageId);
    const rawMarkdown = this.deps.n2md.convert(blocks);
    // Convert Notion page URLs back to Obsidian [[wiki-links]]
    let markdown = this.deps.wikiLinks.restore(rawMarkdown);

    // Download images if setting is enabled
    markdown = await this.deps.images.process(markdown, file.path);

    await app.vault.modify(file, markdown);

    const newHash = hashContent(markdown);
    stateManager.setFileMapping(file.path, {
      ...mapping,
      lastSyncedHash: newHash,
      lastSyncedAt: Date.now(),
    });

    stateManager.addLog("info", `Pulled from Notion: ${file.path}`, file.path);
    return "pulled";
  }

  /**
   * Pull all mapped files from Notion — always overwrites local files.
   */
  async pullAll(): Promise<PullResult> {
    const { app, stateManager, control, progress } = this.deps;
    let pulled = 0, skipped = 0, errors = 0;

    try {
      stateManager.addLog("info", "Starting pull from Notion");
      new Notice("Pulling from Notion...");

      const allMappings = stateManager.getAllFileMappings();
      const entries = Object.entries(allMappings);
      const total = entries.length;

      for (let i = 0; i < entries.length; i++) {
        if (control.aborted) break;

        const [filePath] = entries[i];
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
          skipped++;
          continue;
        }

        try {
          const result = await this.pullFile(file);
          if (result === "pulled") pulled++;
          else skipped++;

          if ((i + 1) % 5 === 0 || i === entries.length - 1) {
            const pct = Math.round(((i + 1) / total) * 100);
            progress.report(`Pulling ${i + 1}/${total}...`, pct);
          }
        } catch (e) {
          errors++;
          stateManager.addLog("error", `Pull failed: ${errMsg(e)}`, filePath);
        }
      }

      const msg = `Pull complete: ${pulled} updated, ${errors} errors`;
      stateManager.addLog("info", msg);
      new Notice(msg);
    } catch (e) {
      stateManager.addLog("error", `Pull failed: ${errMsg(e)}`);
      new Notice(`Pull failed: ${errMsg(e)}`);
    }

    return { pulled, skipped, errors };
  }
}
