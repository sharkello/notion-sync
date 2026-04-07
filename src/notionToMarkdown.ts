import type { NotionApiBlock, NotionBlockContent, NotionRichTextObject } from "./types";

/**
 * Converts Notion API block objects back into Obsidian-flavored Markdown.
 * Mirrors the logic of MarkdownParser in reverse.
 */
export class NotionToMarkdown {
  /**
   * Convert an array of Notion blocks to a markdown string.
   * Blocks that have no markdown representation are silently skipped.
   */
  convert(blocks: NotionApiBlock[], inListContext = false): string {
    const parts: string[] = [];
    let i = 0;

    while (i < blocks.length) {
      const block = blocks[i];
      const md = this.blockToMd(block, inListContext);
      if (md !== null && md !== "") {
        parts.push(md);
      }
      i++;
    }

    // Join with blank line between blocks, then normalise excess blank lines
    return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ── Block → Markdown ───────────────────────────────────────

  /**
   * @param inListContext – true when this block is a child of a list item.
   *   In this case quote/callout render as plain indented text instead of `>`.
   */
  private blockToMd(block: NotionApiBlock, inListContext = false): string | null {
    const data = (block[block.type] as NotionBlockContent) ?? {};

    switch (block.type) {
      case "paragraph":
        return this.richTextToMd(data.rich_text) || null;

      case "heading_1":
        return `# ${this.richTextToMd(data.rich_text)}`;

      case "heading_2":
        return `## ${this.richTextToMd(data.rich_text)}`;

      case "heading_3":
        return `### ${this.richTextToMd(data.rich_text)}`;

      case "bulleted_list_item": {
        const text = this.richTextToMd(data.rich_text);
        const children = this.convertListChildren(block._children);
        return `- ${text}${children}`;
      }

      case "numbered_list_item": {
        const text = this.richTextToMd(data.rich_text);
        const children = this.convertListChildren(block._children);
        return `1. ${text}${children}`;
      }

      case "to_do": {
        const checked = data.checked ? "x" : " ";
        const text = this.richTextToMd(data.rich_text);
        const children = this.convertListChildren(block._children);
        return `- [${checked}] ${text}${children}`;
      }

      case "code": {
        const lang = data.language === "plain text" ? "" : (data.language ?? "");
        const code = this.richTextToPlain(data.rich_text);
        return `\`\`\`${lang}\n${code}\n\`\`\``;
      }

      case "quote": {
        const text = this.richTextToMd(data.rich_text);
        // Inside a list item, render as plain text
        if (inListContext) return text || null;
        return text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
      }

      case "callout": {
        const text = this.richTextToPlain(data.rich_text);
        // Skip metadata callouts injected during push
        if (this.isMetadataCallout(text)) return null;
        // Inside a list item, render as plain text
        if (inListContext) return text || null;
        const lines = text.split("\n");
        const title = lines[0] ?? "";
        const body = lines.slice(1).join("\n");
        const icon = data.icon?.emoji ?? "";
        const noteType = this.emojiToCalloutType(icon);
        const result = `> [!${noteType}] ${title}`;
        if (body) {
          return (
            result +
            "\n" +
            body
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n")
          );
        }
        return result;
      }

      case "divider":
        return "---";

      case "image": {
        const url =
          data.type === "external"
            ? data.external?.url ?? ""
            : data.file?.url ?? "";
        const caption = this.richTextToPlain(data.caption);
        return `![${caption}](${url})`;
      }

      case "table":
        return this.tableToMd(block);

      case "bookmark": {
        const bookmarkData = (block.bookmark as NotionBlockContent) ?? {};
        const url = bookmarkData.url ?? "";
        const caption = this.richTextToPlain(bookmarkData.caption) || url;
        return `[${caption}](${url})`;
      }

      case "embed": {
        const embedData = block.embed as { url?: string } | undefined;
        const url = embedData?.url ?? "";
        return url ? `[${url}](${url})` : null;
      }

      case "video": {
        const videoData = (block.video as NotionBlockContent) ?? {};
        const url =
          videoData.type === "external"
            ? videoData.external?.url ?? ""
            : videoData.file?.url ?? "";
        return url ? `[Video](${url})` : null;
      }

      case "file": {
        const fileData = (block.file as NotionBlockContent) ?? {};
        const url =
          fileData.type === "external"
            ? fileData.external?.url ?? ""
            : fileData.file?.url ?? "";
        const name = this.richTextToPlain(fileData.caption) || "File";
        return url ? `[${name}](${url})` : null;
      }

      case "child_page":
        return null;

      case "column_list":
      case "column":
        if (block._children?.length) {
          return this.convert(block._children, inListContext);
        }
        return null;

      default:
        return null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Convert children of a list item. Passes inListContext=true so that
   * quote/callout children render as plain indented text.
   */
  private convertListChildren(children: NotionApiBlock[] | undefined): string {
    if (!children || children.length === 0) return "";
    const md = this.convert(children, true);
    if (!md) return "";
    return "\n" + md.split("\n").map((l) => `  ${l}`).join("\n");
  }

  private tableToMd(block: NotionApiBlock): string {
    const children: NotionApiBlock[] = block._children ?? [];
    if (children.length === 0) return "";

    const rows = children.map((row: NotionApiBlock) => {
      const rowData = row.table_row as { cells?: NotionRichTextObject[][] } | undefined;
      const cells: NotionRichTextObject[][] = rowData?.cells ?? [];
      return "| " + cells.map((cell) => this.richTextToMd(cell)).join(" | ") + " |";
    });

    const tableData = block.table as { table_width?: number } | undefined;
    const colCount = tableData?.table_width ?? (rows[0] ? rows[0].split("|").length - 2 : 1);
    const sep = "| " + Array(colCount).fill("---").join(" | ") + " |";

    return [rows[0], sep, ...rows.slice(1)].join("\n");
  }

  /** Convert rich_text array to markdown string with inline formatting */
  richTextToMd(richText: NotionRichTextObject[] | undefined): string {
    if (!richText || richText.length === 0) return "";
    return richText.map((rt) => this.segmentToMd(rt)).join("");
  }

  /** Convert rich_text array to plain string (no markdown) */
  private richTextToPlain(richText: NotionRichTextObject[] | undefined): string {
    if (!richText || richText.length === 0) return "";
    return richText.map((rt) => rt.plain_text ?? rt.text?.content ?? "").join("");
  }

  private segmentToMd(rt: NotionRichTextObject): string {
    let text = rt.plain_text ?? rt.text?.content ?? "";
    if (!text) return "";

    const a = rt.annotations ?? {};
    const link = rt.text?.link?.url ?? rt.href ?? undefined;

    if (link) {
      text = this.applyAnnotations(text, a);
      return `[${text}](${link})`;
    }

    return this.applyAnnotations(text, a);
  }

  private applyAnnotations(
    text: string,
    a: NonNullable<NotionRichTextObject["annotations"]>
  ): string {
    if (a.code) return `\`${text}\``;

    if (a.bold && a.italic) text = `***${text}***`;
    else if (a.bold) text = `**${text}**`;
    else if (a.italic) text = `*${text}*`;

    if (a.strikethrough) text = `~~${text}~~`;

    return text;
  }

  /**
   * Detect callouts we injected as metadata blocks during push.
   */
  private isMetadataCallout(text: string): boolean {
    const lines = text.trim().split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return false;
    return lines.every((l) => /^\w[\w\s]*:\s+\S/.test(l));
  }

  private emojiToCalloutType(emoji: string): string {
    const map: Record<string, string> = {
      "📝": "note",
      "💡": "tip",
      "❗": "important",
      "⚠️": "warning",
      "🔥": "caution",
      "ℹ️": "info",
      "📋": "abstract",
      "✅": "success",
      "❓": "question",
      "❌": "failure",
      "🐛": "bug",
      "📖": "example",
      "💬": "quote",
    };
    return map[emoji] ?? "note";
  }
}
