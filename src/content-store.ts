import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';

import {FileHasher} from './hasher';
import {Entry, Entries, DirectoryEntry, isDirectory} from './entries';
import {cbToP1, cbToP2, cbToP3} from './promise-adapters';

function existsp(file: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    fs.exists(file, exists => {
      resolve(exists);
    });
  });
}

function copyFile(from: string, to: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let reader = fs.createReadStream(from);
    let writer = fs.createWriteStream(to);
    reader.on('end', resolve);
    reader.on('error', reject);
    writer.on('error', reject);
    reader.pipe(writer);
  });
}

let mkdirpp = cbToP1(mkdirp);
let writeFilep = cbToP2<string, any, void>(fs.writeFile);
let link = cbToP2<string, string, void>(fs.link);
let symlinkp = cbToP3<string, string, string, void>(fs.symlink);

export class ContentStore {
  private entering: {[name: string]: Promise<void>} = {};
  private hasher: FileHasher;
  
  /**
   * Construct a content store.
   * 
   * @param location directory to use for the content store. It will be creaed if it doesn't already exist.
   * @param hasher the algorithm or file hasher impelmentation to use to hash the content of the files.
   */
  constructor(private location: string, hasher: FileHasher | string) {
    if (typeof hasher === "string") {
      this.hasher = new FileHasher(hasher);
    } else {
      this.hasher = hasher;
    }
  }
  
  /**
   * Enter a file into the content store. First calculates the hash of the file then,
   * using the hash, copies the file into the content store (if it is not already there).
   * 
   * @param filename the file to enter into the content store.
   * @returns a promise for the hash of the file entered into the store.
   */
  async enterFile(filename: string): Promise<string> {
    let fullCacheName: string;
    let hash = await this.hasher.hashOf(filename);
    await this.enterHashedFile(filename, hash);
    return hash;
  }
  
  /**
   * Enter a directory into the content store. First calculates the hash of the 
   * content of the directory and then enters it into the store.
   * 
   * @param the directory to enter into the content store.
   * @returns a promise for the hash of the directory entered into the store.
   */
  async enterDirectory(directory: string): Promise<string> {
    let results = await this.hasher.hashDir(directory);
    let hash = this.hasher.hashEntries(results);
    await this.enterHashedDirectory(directory, results, hash);
    return hash;
  }
  
  /**
   * Create a file or directory, linked back into content store, at the given location.
   * 
   * @param location of the file or directory to link.
   * @returns a promise resolved when the file or directory is linked
   */
  async realize(location: string, hash: string): Promise<string> {
    const fullHashName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullHashName))) {
      throw new Error(`No cache entry for hash ${hash}`);
    }
    await link(fullHashName, location);
    return location;
  }
  
  /**
   * A virtual directory is a directory that might not have physically existed
   * but, rather, was produced via some kind of filter. All the files referenced are
   * assumed to already be entered in the cache but the directories might not be but 
   * can be manufactured by realizing the content of virtual directory.
   * 
   * @param location the location for the directory to be created.
   * @param entries the enteries to resolve.
   * @returns a promise for the hash of the realized directory.
   */
  realizeVirtualDirectory(location: string, entries: Entries): Promise<string> {
    const hash = this.hasher.hashEntries(entries);
    return this.realizeHashedVirtualDirectory(location, hash, entries);
  }
  
  private enterHashedVirtualDirectory(hash: string, entries: Entries): Promise<void> {
    if (this.entering[hash]) {
      return this.entering[hash];
    }
    return this.entering[hash] = this.enterHashVirtualDirectoryImpl(hash, entries);
  }
  
  private async enterHashVirtualDirectoryImpl(hash: string, entries: Entries): Promise<void> {
    const fullHashName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullHashName))) {
      await mkdirpp(fullHashName);
      await Promise.all(entries.map(entry => {
        if (isDirectory(entry)) {
          return this.realizeHashedVirtualDirectory(path.join(fullHashName, entry.name), entry.hash, entry.files);
        } else {
          return this.realize(path.join(fullHashName, entry.name), entry.hash);
        }
      }));
    }
  }

  private async realizeHashedVirtualDirectory(location: string, hash: string, entries: Entries): Promise<string> {
    const fullHashName = this.cacheNameOfHash(hash);
    await this.enterHashedVirtualDirectory(hash, entries);
    await link(fullHashName, location);
    return hash;
  }

  private ensureEntry(directory: string, entry: Entry): Promise<void> {
    if (this.entering[entry.hash]) {
      return this.entering[entry.hash];
    }
    if (isDirectory(entry)) {
      const fullDirectoryName = path.join(directory, entry.name);
      return this.enterHashedDirectory(fullDirectoryName, entry.files, entry.hash);
    } else {
      const fullFileName = path.join(directory, entry.name);
      return this.enterHashedFile(fullFileName, entry.hash);
    }
  }

  private enterHashedDirectory(directory: string, entries: Entries, hash: string): Promise<any> {
    // A directory entry in the cache is, itself, a directory with its entries realized.
    if (this.entering[hash]) {
      return this.entering[hash];
    }
    return this.entering[hash] = this.enterHashedDirectoryImpl(directory, entries, hash);
  }

  private async enterHashedDirectoryImpl(directory: string, entries: Entries, hash: string): Promise<any> {
    let fullDirectoryName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullDirectoryName))) {
      await Promise.all(entries.map(entry => this.ensureEntry(directory, entry)));
      await mkdirpp(fullDirectoryName);
      await Promise.all(entries.map(entry => {
        return this.realize(path.join(fullDirectoryName, entry.name), entry.hash);
      }));
    }
  }
  
  private enterHashedFile(filename: string, hash: string): Promise<void> {
    if (this.entering[hash]) {
      return this.entering[hash];
    }
    let fullCacheName = this.cacheNameOfHash(hash);
    let result = existsp(fullCacheName).then(exists => {
      if (!exists) {
        return mkdirpp(path.dirname(fullCacheName)).then(made => {
          return copyFile(filename, fullCacheName);
        });
      }
    });    
    this.entering[hash] = result;
    return result;
  }
  
  private async enterHashedFileImpl(filename: string, hash: string): Promise<void> {
    let fullCacheName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullCacheName))) {
      await mkdirpp(path.dirname(fullCacheName));
      await copyFile(filename, fullCacheName);
    }
  }

  private cacheNameOfHash(hash: string): string {
    return path.join(this.location, hash.substr(0, 2), hash.substr(2,2), hash.substr(4));
  }
}