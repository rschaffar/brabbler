import { getFileDirectory } from "./file-paths";

export function hasFileDrag(data: Pick<DataTransfer, "types" | "items">): boolean {
  return Array.from(data.types).includes("Files") || Array.from(data.items).some((item) => item.kind === "file");
}

/** Read synchronously inside the drop handler: browsers protect transfer items
 * after dispatch. Directories are destinations, never recursive upload inputs. */
export function readDroppedFiles(data: DataTransfer): { files: File[]; folders: string[]; unsupported: boolean } {
  const files: File[] = [];
  const folders: string[] = [];
  let unsupported = false;
  const add = (file: File) => {
    if (file.webkitRelativePath) { folders.push(file.webkitRelativePath.split("/")[0]); return; }
    files.push(file);
  };
  const items = Array.from(data.items).filter((item) => item.kind === "file");
  if (items.length) {
    for (const item of items) {
      try {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) { folders.push(entry.name); continue; }
        const file = item.getAsFile();
        if (file) add(file); else unsupported = true;
      } catch { unsupported = true; }
    }
  } else for (const file of Array.from(data.files)) add(file);
  return { files, folders: [...new Set(folders)], unsupported };
}

export function uploadDirectoryForNode(node: { fullPath: string; isDir: boolean }, cwd: string): string {
  return node.isDir ? node.fullPath : getFileDirectory(node.fullPath) || cwd;
}
