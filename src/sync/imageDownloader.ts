import type { App } from "obsidian";
import { requestUrl } from "obsidian";
import type { StateManager } from "../stateManager";
import type { SettingsProvider } from "./contracts";
import type { VaultFileNamer } from "./vaultFileNamer";
import { errMsg } from "../utils";

export interface ImageDownloaderDeps {
  app: App;
  stateManager: StateManager;
  namer: VaultFileNamer;
  settings: SettingsProvider;
}

/**
 * Downloads Notion-hosted images referenced in pulled markdown into a
 * local _attachments folder and rewrites the links to Obsidian embeds.
 * No-op when the downloadImages setting is disabled.
 */
export class ImageDownloader {
  constructor(private readonly deps: ImageDownloaderDeps) {}

  /**
   * Find all Notion/S3 image URLs in markdown, download them to the vault,
   * and replace with Obsidian ![[filename]] embeds.
   */
  async process(markdown: string, filePath: string): Promise<string> {
    if (!this.deps.settings().downloadImages) return markdown;

    // Match ![caption](url) where url starts with https:// and contains notion.so or amazonaws.com
    const imageRegex = /!\[([^\]]*)\]\((https:\/\/[^)]*(?:notion\.so|amazonaws\.com)[^)]*)\)/g;

    const matches: Array<{ full: string; caption: string; url: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = imageRegex.exec(markdown)) !== null) {
      matches.push({ full: m[0], caption: m[1], url: m[2] });
    }

    if (matches.length === 0) return markdown;

    // Determine attachment folder
    const fileDir = filePath.includes("/")
      ? filePath.substring(0, filePath.lastIndexOf("/"))
      : "";
    const attachmentFolder = fileDir
      ? `${fileDir}/_attachments`
      : "_attachments";

    // Ensure attachment folder exists
    const existingFolder = this.deps.app.vault.getAbstractFileByPath(attachmentFolder);
    if (!existingFolder) {
      try {
        await this.deps.app.vault.createFolder(attachmentFolder);
      } catch {
        // may already exist
      }
    }

    let result = markdown;

    for (const { full, url } of matches) {
      try {
        // Extract filename from URL
        let fileName = this.extractFileNameFromUrl(url);
        if (!fileName) continue;

        // Ensure unique filename in attachment folder
        fileName = this.deps.namer.findUniqueAttachmentName(attachmentFolder, fileName);
        const attachmentPath = `${attachmentFolder}/${fileName}`;

        // Download the image
        const resp = await requestUrl({ url, method: "GET", throw: false });
        if (resp.status < 200 || resp.status >= 300) {
          this.deps.stateManager.addLog("warn", `Failed to download image: ${url} (status ${resp.status})`);
          continue;
        }

        // Check if file already exists before creating
        const existingFile = this.deps.app.vault.getAbstractFileByPath(attachmentPath);
        if (!existingFile) {
          await this.deps.app.vault.createBinary(attachmentPath, resp.arrayBuffer);
        }

        // Replace URL with Obsidian embed
        result = result.replace(full, `![[${fileName}]]`);
      } catch (e) {
        this.deps.stateManager.addLog("warn", `Image download failed: ${errMsg(e)}`);
      }
    }

    return result;
  }

  /** Extract a sanitized filename from a URL */
  private extractFileNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split("/");
      let name = pathParts[pathParts.length - 1] || "image";
      // Remove query params from name
      name = name.split("?")[0];
      // Sanitize
      name = name.replace(/[^\w.-]/g, "_");
      // Ensure it has an extension
      if (!name.includes(".")) {
        name += ".png";
      }
      // Truncate if too long
      if (name.length > 64) {
        const ext = name.substring(name.lastIndexOf("."));
        name = name.substring(0, 60 - ext.length) + ext;
      }
      return name;
    } catch {
      return "image.png";
    }
  }
}
