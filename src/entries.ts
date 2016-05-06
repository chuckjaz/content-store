export type Entry = DirectoryEntry | FileEntry;
export type Entries = Entry[];

export interface DirectoryEntry {
  name: string;
  hash: string;
  files: Entries;
}

export interface FileEntry {
  name: string;
  hash: string;
}

export function isDirectory(entry: Entry): entry is DirectoryEntry {
  return !!(<DirectoryEntry>entry).files;
}

export function isFile(entry: Entry): entry is FileEntry {
  return !(<DirectoryEntry>entry).files;
}

