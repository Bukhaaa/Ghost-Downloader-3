import {fileExtension, visualKindOf} from "../shared/utils";

// Sorting by type sends each task with its type's folder as `path`; the desktop saves there,
// creating the folder, instead of in its own download folder.
export type FolderCategory = "video" | "music" | "pictures" | "pdf" | "documents" | "compressed" | "programs" | "other";

export const FOLDER_CATEGORIES: ReadonlyArray<FolderCategory> = [
  "video", "music", "pictures", "pdf", "documents", "compressed", "programs", "other",
];

export const DEFAULT_TYPE_FOLDERS: Readonly<Record<FolderCategory, string>> = {
  video: "Video",
  music: "Music",
  pictures: "Pictures",
  pdf: "PDF",
  documents: "Documents",
  compressed: "Compressed",
  programs: "Programs",
  other: "Other",
};

const PROGRAM_EXTENSIONS = new Set(["exe", "msi", "msix", "appx", "apk", "xapk", "dmg", "pkg", "deb", "rpm", "appimage"]);

// Page media and merges end up as video files; anything else goes by its file name.
export function folderCategoryOf(source: string, filename: string): FolderCategory {
  if (source === "page_media" || source === "resource_merge") { return "video"; }
  const extension = fileExtension(filename);
  const parserHint = extension === "m3u8" || extension === "mpd" ? "m3u8" : undefined;
  switch (visualKindOf({ extension, parserHint })) {
    case "video":
    case "stream":
      return "video";
    case "audio":
      return "music";
    case "image":
      return "pictures";
    case "pdf":
      return "pdf";
    case "document":
    case "spreadsheet":
      return "documents";
    case "archive":
      return "compressed";
    default:
      return PROGRAM_EXTENSIONS.has(extension) ? "programs" : "other";
  }
}

// A full path stands alone; a name is a folder inside the main one. "" leaves the task to the
// desktop's own download folder.
export function buildFolderPath(mainFolder: string, folder: string): string {
  const name = folder.trim();
  if (/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(name)) { return name; }
  const main = mainFolder.trim().replace(/[\\/]+$/, "");
  if (!main || !name) { return main; }
  return `${main}${main.includes("\\") ? "\\" : "/"}${name}`;
}
