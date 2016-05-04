# Content Store

The content store is a package that allows storing and retrieving files and directories
by the content. It also allows realizing (linking, copying, whatever...) the content to
arbitrary locations.

# Classes

## `ContentStore`

This is the central class of this package allowing you to create a local content based
file store. When a file is entered into the content store the file copied to the cache
directory and indexed by its hash code. If a diretory is entered, each sub-directory and
file is recusively entered into the content store. When entering a file or directory 
returns a promise for the hash of the file or directory. The hash can then, later, be
used to realize the cache entry into a file location. Realizing a file or directory is
fast because it uses `fs.link` to realize the file into the destination location.

### `constructor(private location: string, hasher: FileHasher | string)`

Construct a content store that will store the content at the given directory. If the
location doesn't exist it will be created when the first content is added.

### `enterFile(filename: string): Promise<string>`

Enter a file into the content store. First calculates the hash of the file then,
using the hash, copies the file into the content store (if it is not already there).

### `enterDirectory(directory: string): Promise<string>`

Enter a directory into the content store. First calculates the hash of the 
content of the directory and then enters it into the store.

### `realize(location: string, hash: string): Promise<string>`

Create a file or directory, linked back into content store, at the given location.

### `realizeVirtualDirectory(location: string, entries: Entries): Promise<string>`

A virtual directory is a directory that might not have physically existed
but, rather, was produced via some kind of filter. All the files referenced are
assumed to already be entered in the cache but the directories might not be but 
can be manufactured by realizing the content of virtual directory.

## `FileHasher`

### `constructor(algorithm: string)`

Construct a file hasher using the given algorithm as expected by `crypto`.

### `hashOf(filename: string): Promise<string>`

Returns the hash of a file as hex string.

### `hashDir(directory: string): Promise<Entries>`

Returns Entries for a directory.

### `hashEntries(entries: Entries): string`

Return the hash code the entries.

# Types

## `Entry`

```typescript
export type Entry = DirectoryEntry | FileEntry;
```

## `Entries`
```
export type Entries = Entry[];
```

## `DirectoryEntry`
```typescript
export interface DirectoryEntry {
  directory: string;
  hash: string;
  files: Entries;
}
```

## `FileEntry`
```typescript
export interface FileEntry {
  file: string;
  hash: string;
}
```