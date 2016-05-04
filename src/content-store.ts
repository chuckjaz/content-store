import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as hasher from './hasher';

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
  
  constructor(private location: string, private hasher: hasher.FileHasher) { }
  
  /**
   * Enter a file into the content store. First calculates the hash of the file then,
   * using the hash, copies the file into the content store (if it is not already there).
   * 
   * @param filename the file to enter into the content store.
   * @returns a promise for the hash of the file entered into the store.
   */
  enterFile(filename: string): Promise<string> {
    let fullCacheName: string;
    return this.hasher.hashOf(filename).then(hash => {
      return this.enterHashedFile(filename, hash).then(() => hash);
    });
  }
  
  /**
   * Enter a directory into the content store. First calculates the hash of the 
   * content of the directory and then enters it into the store.
   * 
   * @param the directory to enter into the content store.
   * @returns a promise for the hash of the directory entered into the store.
   */
  enterDirectory(directory: string): Promise<string> {
    return this.hasher.hashDir(directory).then(results => {
      const hash = this.hasher.hashEntries(results)
      return this.enterHashedDirectory(directory, results, hash).then(() => hash);
    });
  }
  
  /**
   * Create a file or directory, linked back into content store, at the given location.
   * 
   * @param location of the file or directory to link.
   * @returns a promise resolved when the file or directory is linked
   */
  realize(location: string, hash: string): Promise<string> {
    const fullHashName = this.cacheNameOfHash(hash);
    return existsp(fullHashName).then(exists => {
      if (!exists) {
        throw new Error(`No cache entry for hash ${hash}`);
      }
      else {
        // Realize the entry by link'ing the cache entry to the
        // given name.
        // TODO: If this fails we should symlink instead.
        return link(fullHashName, location);
      }
    }).then(() => location);
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
    const fullHashName = this.cacheNameOfHash(hash);    
    let result = existsp(fullHashName).then(exists => {
      if (!exists) {
        // Create the directory
        return mkdirpp(fullHashName).then(() => {
          // Realize the enteries.
          return Promise.all(entries.map(entry => {
            if (isDirectory(entry)) {
               return this.realizeHashedVirtualDirectory(path.join(fullHashName, entry.directory), entry.hash, entry.files);  
            } else {
              return this.realize(path.join(fullHashName, entry.file), entry.hash);
            }
          }));
        });
      }
    }).then<void>();
    this.entering[hash] = result;
    return result;
  }
  
  private realizeHashedVirtualDirectory(location: string, hash: string, entries: Entries): Promise<string> {
    const fullHashName = this.cacheNameOfHash(hash);
    return this.enterHashedVirtualDirectory(hash, entries).then(() => {
      return link(fullHashName, location);
    }).then(() => hash);
  }

  private ensureEntry(directory: string, entry: Entry): Promise<void> {
    if (this.entering[entry.hash]) {
      return this.entering[entry.hash];
    }
    if (isDirectory(entry)) {
      const fullDirectoryName = path.join(directory, entry.directory);
      return this.enterHashedDirectory(fullDirectoryName, entry.files, entry.hash);
    } else {
      const fullFileName = path.join(directory, entry.file);
      return this.enterHashedFile(fullFileName, entry.hash);
    }
  }
    
  private enterHashedDirectory(directory: string, entries: Entries, hash: string): Promise<any> {
    // A directory entry in the cache is, itself, a directory with its entries realized.
    if (this.entering[hash]) {
      return this.entering[hash];
    }
    let fullDirectoryName: string;
    fullDirectoryName = this.cacheNameOfHash(hash);
    let result = existsp(fullDirectoryName).then(exists => {
      if (!exists) {
        // Ensure all the entries are in the cache.
        return Promise.all(entries.map(entry => this.ensureEntry(directory, entry))).then(() => {
          // Create a directory directory position.
          return mkdirpp(fullDirectoryName);
        }).then(() => {
          // Realize all the entries into the directory.
          return Promise.all(entries.map(entry => {
            let name: string;
            let hash: string;
            if (isDirectory(entry)) {
              name = entry.directory;
              hash = entry.hash;
            } else {
              name = entry.file;
              hash = entry.hash;
            }
            return  this.realize(path.join(fullDirectoryName, name), hash);
          }));
        });
      }
    }).then<void>();
    this.entering[hash] = result;
    return result;
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
  
  private cacheNameOfHash(hash: string): string {
    return path.join(this.location, hash.substr(0, 2), hash.substr(2,2), hash.substr(4));
  }
}