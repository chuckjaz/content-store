export type Entry = DirectoryEntry | FileEntry;
export type Entries = Entry[];

export interface DirectoryEntry {
  directory: string;
  hash: string;
  files: Entries;
}

export interface FileEntry {
  file: string;
  hash: string;
}

export function isDirectory(entry: Entry): entry is DirectoryEntry {
  return !!(<DirectoryEntry>entry).directory;
}

export function isFile(entry: Entry): entry is FileEntry {
  return !!(<FileEntry>entry).file;
}

