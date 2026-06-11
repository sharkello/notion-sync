import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { StateManager } from "../stateManager";
import { normalizeNotionId } from "../stateManager";
import type { NotionToMarkdown } from "../notionToMarkdown";
import type { ImportResult, NotionApi, SettingsProvider } from "./contracts";
import type { ImageDownloader } from "./imageDownloader";
import type { ProgressReporter } from "./progressReporter";
import type { StatePersister } from "./statePersister";
import type { SyncControl } from "./syncControl";
import type { VaultFileNamer } from "./vaultFileNamer";
import type { WikiLinkRestorer } from "./wikiLinkRestorer";
import { errMsg, hashContent, sanitizeFileName } from "../utils";

const MAX_TRAVERSAL_DEPTH = 20;

export interface NotionTreeImporterDeps {
  app: App;
  notion: NotionApi;
  stateManager: StateManager;
  n2md: NotionToMarkdown;
  wikiLinks: WikiLinkRestorer;
  images: ImageDownloader;
  namer: VaultFileNamer;
  progress: ProgressReporter;
  persister: StatePersister;
  settings: SettingsProvider;
  control: SyncControl;
}

/**
 * Walks the Notion page tree under the configured root and creates local
 * files for pages that are not yet mapped to any vault file.
 */
export class NotionTreeImporter {
  constructor(private readonly deps: NotionTreeImporterDeps) {}

  /**
   * Recursively traverse Notion pages under rootPageId and create local files
   * for pages not yet in any file mapping.
   */
  async importNewPages(): Promise<ImportResult> {
    const { stateManager } = this.deps;
    let created = 0;
    let errors = 0;

    try {
      stateManager.addLog("info", "Starting pull new pages from Notion");
      new Notice("Pulling new pages from Notion...");

      // Build set of all already-known Notion page IDs
      const knownIds = new Set<string>();
      for (const mapping of Object.values(stateManager.getAllFileMappings())) {
        knownIds.add(normalizeNotionId(mapping.notionPageId));
      }

      // Traverse recursively
      const result = await this.traverse(
        this.deps.settings().rootPageId,
        "",
        knownIds,
        0,
        created,
        errors
      );
      created = result.created;
      errors = result.errors;

      const msg = `Pull new pages complete: ${created} created, ${errors} errors`;
      stateManager.addLog("info", msg);
      new Notice(msg);
    } catch (e) {
      stateManager.addLog("error", `Pull new pages failed: ${errMsg(e)}`);
      new Notice(`Pull new pages failed: ${errMsg(e)}`);
    }

    return { created, errors };
  }

  /**
   * Recursively traverse child pages. For each unknown page, create a local file.
   */
  private async traverse(
    notionPageId: string,
    parentFolderPath: string,
    knownIds: Set<string>,
    depth: number,
    created: number,
    errors: number
  ): Promise<ImportResult> {
    const { app, notion, stateManager, control, progress } = this.deps;

    if (control.aborted || depth > MAX_TRAVERSAL_DEPTH) return { created, errors };

    let childPages: Array<{ id: string; title: string }>;
    try {
      childPages = await notion.getChildPages(notionPageId);
    } catch (e) {
      stateManager.addLog("warn", `Could not fetch children of ${notionPageId}: ${errMsg(e)}`);
      return { created, errors };
    }

    const folderMappings = stateManager.getAllFolderMappings();
    // Build reverse map: notionPageId -> folderPath
    const notionIdToFolder: Record<string, string> = {};
    for (const [folderPath, nId] of Object.entries(folderMappings)) {
      notionIdToFolder[normalizeNotionId(nId)] = folderPath;
    }

    // Determine the folder that corresponds to notionPageId
    let currentFolder = parentFolderPath;
    if (depth > 0) {
      const resolvedFolder = notionIdToFolder[normalizeNotionId(notionPageId)];
      if (resolvedFolder) {
        currentFolder = resolvedFolder;
      }
    }

    const total = childPages.length;

    for (let i = 0; i < childPages.length; i++) {
      if (control.aborted) break;

      const child = childPages[i];
      const normalizedId = normalizeNotionId(child.id);

      // Report progress
      if (total > 0) {
        const pct = Math.round((i / total) * 100);
        progress.report(`Checking pages... ${child.title}`, pct);
      }

      // Check if this page has further child pages (to decide folder mapping)
      let grandChildren: Array<{ id: string; title: string }> = [];
      try {
        grandChildren = await notion.getChildPages(child.id);
      } catch {
        // ignore
      }

      const hasChildren = grandChildren.length > 0;

      // If this page has children, register it as a folder mapping too
      if (hasChildren) {
        const safeFolderName = sanitizeFileName(child.title);
        const folderPath = currentFolder
          ? `${currentFolder}/${safeFolderName}`
          : safeFolderName;

        if (!stateManager.getFolderMapping(folderPath)) {
          stateManager.setFolderMapping(folderPath, child.id);
          // Ensure folder exists in vault
          try {
            const existing = app.vault.getAbstractFileByPath(folderPath);
            if (!existing) {
              await app.vault.createFolder(folderPath);
            }
          } catch {
            // folder may already exist
          }
        }
      }

      // Only create a file if this page is NOT already in our mappings
      if (!knownIds.has(normalizedId)) {
        try {
          // Fetch blocks and convert to markdown
          const blocks = await notion.getBlocksWithContent(child.id);
          const rawMarkdown = this.deps.n2md.convert(blocks);
          let markdown = this.deps.wikiLinks.restore(rawMarkdown);

          // Download images if enabled
          const safeTitle = sanitizeFileName(child.title);
          const tempFilePath = currentFolder
            ? `${currentFolder}/${safeTitle}.md`
            : `${safeTitle}.md`;
          markdown = await this.deps.images.process(markdown, tempFilePath);

          // Determine file path
          const filePath = this.deps.namer.findUniquePath(tempFilePath);

          // Ensure parent folder exists
          const parts = filePath.split("/");
          parts.pop();
          if (parts.length > 0) {
            const dir = parts.join("/");
            const existing = app.vault.getAbstractFileByPath(dir);
            if (!existing) {
              try {
                await app.vault.createFolder(dir);
              } catch {
                // may already exist
              }
            }
          }

          await app.vault.create(filePath, markdown);

          const hash = hashContent(markdown);
          stateManager.setFileMapping(filePath, {
            notionPageId: child.id,
            lastSyncedHash: hash,
            lastSyncedAt: Date.now(),
          });
          await this.deps.persister.persist();

          // Add to known IDs so we don't create it again
          knownIds.add(normalizedId);

          // Add history entry
          stateManager.addHistoryEntry({
            timestamp: Date.now(),
            operation: "pull-new",
            filePath,
            fileName: safeTitle,
          });

          stateManager.addLog("info", `Created from Notion: ${filePath}`, filePath);
          created++;
        } catch (e) {
          errors++;
          stateManager.addLog("error", `Failed to create page ${child.title}: ${errMsg(e)}`);
        }
      }

      // Recurse into child pages
      if (hasChildren) {
        const folderMappingsNow = stateManager.getAllFolderMappings();
        const notionIdToFolderNow: Record<string, string> = {};
        for (const [fp, nid] of Object.entries(folderMappingsNow)) {
          notionIdToFolderNow[normalizeNotionId(nid)] = fp;
        }
        const childFolder = notionIdToFolderNow[normalizeNotionId(child.id)] || currentFolder;

        const sub = await this.traverse(
          child.id,
          childFolder,
          knownIds,
          depth + 1,
          created,
          errors
        );
        created = sub.created;
        errors = sub.errors;
      }
    }

    return { created, errors };
  }
}
