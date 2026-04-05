/**
 * Converts Notion API block objects back into Obsidian-flavored Markdown.
 * Mirrors the logic of MarkdownParser in reverse.
 */
export class NotionToMarkdown {
  /**
   * Convert an array of Notion blocks to a markdown string.
   * Blocks that have no markdown representation are silently skipped.
   */
  convert(blocks: any[], inListContext = false): string {
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
   *   In this case quote/callout render as plain indented text instead of `>`,
   *   matching how Notion visually shows them (subtle indent, no border).
   */
  private blockToMd(block: any, inListContext = false): string | null {
    switch (block.type) {
      case "paragraph":
        return this.richTextToMd(block.paragraph?.rich_text) || null;

      case "heading_1":
        return `# ${this.richTextToMd(block.heading_1?.rich_text)}`;

      case "heading_2":
        return `## ${this.richTextToMd(block.heading_2?.rich_text)}`;

      case "heading_3":
        return `### ${this.richTextToMd(block.heading_3?.rich_text)}`;

      case "bulleted_list_item": {
        const text = this.richTextToMd(block.bulleted_list_item?.rich_text);
        const children = this.convertListChildren(block._children);
        return `- ${text}${children}`;
      }

      case "numbered_list_item": {
        const text = this.richTextToMd(block.numbered_list_item?.rich_text);
        const children = this.convertListChildren(block._children);
        return `1. ${text}${children}`;
      }

      case "to_do": {
        const checked = block.to_do?.checked ? "x" : " ";
        const text = this.richTextToMd(block.to_do?.rich_text);
        const children = this.convertListChildren(block._children);
        return `- [${checked}] ${text}${children}`;
      }

      case "code": {
        const lang = block.code?.language === "plain text" ? "" : (block.code?.language || "");
        const code = this.richTextToPlain(block.code?.rich_text);
        return `\`\`\`${lang}\n${code}\n\`\`\``;
      }

      case "quote": {
        const text = this.richTextToMd(block.quote?.rich_text);
        // Inside a list item, Notion quotes are just indented continuation text —
        // rendering them as `>` would produce an ugly blockquote border in Obsidian.
        if (inListContext) return text || null;
        return text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n");
      }

      case "callout": {
        const text = this.richTextToPlain(block.callout?.rich_text);
        // Skip metadata callouts we injected during push
        if (this.isMetadataCallout(text)) return null;
        // Inside a list item, render as plain text to avoid visual clutter
        if (inListContext) return text || null;
        const lines = text.split("\n");
        const title = lines[0] || "";
        const body = lines.slice(1).join("\n");
        const icon = block.callout?.icon?.emoji || "";
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
          block.image?.type === "external"
            ? block.image.external?.url
            : block.image?.file?.url || "";
        const caption = this.richTextToPlain(block.image?.caption);
        return `![${caption}](${url})`;
      }

      case "table":
        return this.tableToMd(block);

      case "bookmark": {
        const url = block.bookmark?.url || "";
        const caption = this.richTextToPlain(block.bookmark?.caption) || url;
        return `[${caption}](${url})`;
      }

      case "embed": {
        const url = block.embed?.url || "";
        return url ? `[${url}](${url})` : null;
      }

      case "video": {
        const url =
          block.video?.type === "external"
            ? block.video.external?.url
            : block.video?.file?.url || "";
        return url ? `[Video](${url})` : null;
      }

      case "file": {
        const url =
          block.file?.type === "external"
            ? block.file.external?.url
            : block.file?.file?.url || "";
        const name = this.richTextToPlain(block.file?.caption) || "File";
        return url ? `[${name}](${url})` : null;
      }

      case "child_page":
        // Represented as a reference link; can't pull recursively here
        return null;

      case "column_list":
      case "column":
        // Render column children inline (flatten), preserving context
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
   * Convert children of a list item (bulleted/numbered/to_do).
   * Passes inListContext=true so that quote/callout children render as
   * plain indented text instead of Obsidian blockquotes.
   */
  private convertListChildren(children: any[] | undefined): string {
    if (!children || children.length === 0) return "";
    const md = this.convert(children, true /* inListContext */);
    if (!md) return "";
    // Indent 2 spaces — makes child text visually nested in Obsidian
    return "\n" + md.split("\n").map((l) => `  ${l}`).join("\n");
  }

  /** Generic children (non-list context, e.g. column_list) */
  private convertChildren(children: any[] | undefined): string {
    if (!children || children.length === 0) return "";
    const md = this.convert(children, false);
    if (!md) return "";
    return "\n" + md.split("\n").map((l) => `  ${l}`).join("\n");
  }

  private tableToMd(block: any): string {
    const children: any[] = block._children || [];
    if (children.length === 0) return "";

    const rows = children.map((row: any) => {
      const cells: any[][] = row.table_row?.cells || [];
      return "| " + cells.map((cell) => this.richTextToMd(cell)).join(" | ") + " |";
    });

    const colCount = block.table?.table_width || (rows[0] ? rows[0].split("|").length - 2 : 1);
    const sep = "| " + Array(colCount).fill("---").join(" | ") + " |";

    return [rows[0], sep, ...rows.slice(1)].join("\n");
  }

  /** Convert rich_text array to markdown string with inline formatting */
  richTextToMd(richText: any[]): string {
    if (!richText || richText.length === 0) return "";
    return richText.map((rt) => this.segmentToMd(rt)).join("");
  }

  /** Convert rich_text array to plain string (no markdown) */
  private richTextToPlain(richText: any[]): string {
    if (!richText || richText.length === 0) return "";
    return richText.map((rt) => rt.plain_text || rt.text?.content || "").join("");
  }

  private segmentToMd(rt: any): string {
    let text = rt.plain_text || rt.text?.content || "";
    if (!text) return "";

    const a = rt.annotations || {};
    const link = rt.text?.link?.url || rt.href;

    if (link) {
      // Apply formatting inside the link text first
      text = this.applyAnnotations(text, a);
      return `[${text}](${link})`;
    }

    return this.applyAnnotations(text, a);
  }

  private applyAnnotations(
    text: string,
    a: Record<string, any>
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
   * Those have the pattern "key: value\nkey: value..."
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
    return map[emoji] || "note";
  }
}
