import type { StateManager } from "../stateManager";

/**
 * Converts Notion page URLs in pulled markdown back to Obsidian
 * [[wiki-links]] using the file mappings as a reverse index.
 *
 * Notion stores internal links as:
 *   [Page Title](https://www.notion.so/Title-339ee678f579814aa880dad31be33d8e)
 * or just:
 *   [Page Title](https://www.notion.so/339ee678f579814aa880dad31be33d8e)
 */
export class WikiLinkRestorer {
  constructor(private readonly stateManager: StateManager) {}

  restore(markdown: string): string {
    // Match [any text](https://www.notion.so/...ID) where ID is 32 hex chars at the end
    return markdown.replace(
      /\[([^\]]*)\]\(https:\/\/(?:www\.)?notion\.so\/[^\s)]*?([0-9a-f]{32})\)/gi,
      (_match: string, linkText: string, rawId: string) => {
        const filePath = this.stateManager.getFilePathByNotionId(rawId);
        if (!filePath) return _match; // not in our vault — keep as-is

        // Use just the filename without extension as the wiki-link target
        const fileName = filePath.split("/").pop()?.replace(/\.md$/, "") || linkText;

        // If the display text differs from the file name, add an alias: [[target|alias]]
        const cleanText = linkText.replace(/^[^\w]*/, "").trim(); // strip leading emoji/spaces
        if (cleanText && cleanText !== fileName) {
          return `[[${fileName}|${cleanText}]]`;
        }
        return `[[${fileName}]]`;
      }
    );
  }
}
