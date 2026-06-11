import type { App } from "obsidian";

/**
 * Produces collision-free file and attachment paths within the vault.
 */
export class VaultFileNamer {
  constructor(private readonly app: App) {}

  /** Find a unique file path by appending (1), (2) etc. */
  findUniquePath(filePath: string): string {
    const ext = filePath.includes(".") ? filePath.substring(filePath.lastIndexOf(".")) : "";
    const base = filePath.includes(".") ? filePath.substring(0, filePath.lastIndexOf(".")) : filePath;

    let candidate = filePath;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${base} (${n})${ext}`;
      n++;
    }
    return candidate;
  }

  /** Ensure a unique filename within the given folder */
  findUniqueAttachmentName(folder: string, fileName: string): string {
    const ext = fileName.includes(".") ? fileName.substring(fileName.lastIndexOf(".")) : "";
    const base = fileName.includes(".") ? fileName.substring(0, fileName.lastIndexOf(".")) : fileName;

    let candidate = fileName;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(`${folder}/${candidate}`)) {
      candidate = `${base} (${n})${ext}`;
      n++;
    }
    return candidate;
  }
}
