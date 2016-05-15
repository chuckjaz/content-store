import * as fs from 'fs';
import * as stream from 'stream';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as crypto from 'crypto';
import * as tmp from 'tmp';

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

class HashTransformStream extends stream.Transform {
  private hasher: crypto.Hash;
  private result: string | null;

  constructor(algorithm: string, encoding?: string) {
    super();
    this.hasher = crypto.createHash(algorithm);
    this.result = null;
  }

  get hash( ){
    return this.result;
  }

  _transform(chunk: any, encoding: string, callback: Function): void {
    this.hasher.update(chunk);
    callback(null, chunk);

  }

  _flush(callback: Function): void {
    this.result = this.hasher.digest('hex');
    callback();
  }
};

function copyStream(reader: fs.ReadStream, writer: fs.WriteStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hasher = new HashTransformStream('sha1');
    reader.on('end', () => {
      setImmediate(() => {
        resolve(<string>hasher.hash);
      });
    });
    reader.on('error', reject);
    writer.on('error', reject);
    reader.pipe(hasher).pipe(writer);
  });
}

function copyFile(from: string, to: string): Promise<string> {
  return copyStream(
    fs.createReadStream(from),
    fs.createWriteStream(to)
  );
}

let mkdirpp = cbToP1(mkdirp);
let writeFilep = cbToP2<string, any, void>(fs.writeFile);
let link = cbToP2<string, string, void>(fs.link);
let unlink = cbToP1<string, void>(fs.unlink);
let symlinkp = cbToP3<string, string, string | undefined, void>(fs.symlink);
let statp = cbToP1<string, fs.Stats>(fs.stat);

async function tmpFileName(location: string): Promise<string> {
  while(true) {
    const candidateName = path.join(location, `tmp-${(Math.random() * 100000).toFixed(0).toString()}`);
    if (!(await existsp(candidateName))) {
      return candidateName;
    }
  }
}

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
  async enterFile(file: string | fs.ReadStream): Promise<string> {
    let fullCacheName: string;
    if (typeof file === "string") {
      let hash = await this.hasher.hashOf(file);
      await this.enterHashedFile(file, hash);
      return hash;
    } else {
      return await this.enterStream(file);
    }
  }

  /**
   * Enter a directory into the content store. First calculates the hash of the
   * content of the directory and then enters it into the store.
   *
   * @param the directory to enter into the content store.
   * @returns a promise for the hash and entries of the directory entered into the store.
   */
  async enterDirectory(directory: string): Promise<{ hash: string, entries: Entries }> {
    let results = await this.hasher.hashDir(directory);
    let hash = this.hasher.hashEntries(results);
    await this.enterHashedDirectory(directory, results, hash);
    return { hash, entries: results };
  }

  /**
   * Enter a virtual directory into the content store. The files referenced
   * by the virtual directory are already assumed to be in the content store.
   *
   * @param entries the virtual directory to enter.
   */
  async enterVirtualDirectory(entries: Entries): Promise<string> {
    let hash = this.hasher.hashEntries(entries);
    await this.enterHashedVirtualDirectory(hash, entries);
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
    let stat = await statp(fullHashName);
    if (stat.isDirectory()) {
      await symlinkp(fullHashName, location, undefined);
    } else {
      await link(fullHashName, location);
    }
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
    await symlinkp(fullHashName, location, undefined);
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
    return this.entering[hash] = this.enterHashedFileImpl(filename, hash);
  }

  private async enterHashedFileImpl(filename: string, hash: string): Promise<void> {
    let fullCacheName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullCacheName))) {
      await mkdirpp(path.dirname(fullCacheName));
      await copyFile(filename, fullCacheName);
    }
  }

  private async enterStream(stream: fs.ReadStream): Promise<string> {
    await mkdirpp(this.location);
    const tmpFile = await tmpFileName(this.location);
    const writeStream = fs.createWriteStream(tmpFile);
    const hash = await copyStream(stream, writeStream);
    if (this.entering[hash]) {
      await this.entering[hash];
    }
    else {
      await (this.entering[hash] = this.enterHashedStream(tmpFile, hash));
    }
    return hash;
  }

  private async enterHashedStream(tmpFile: string, hash: string): Promise<void> {
    let fullCacheName = this.cacheNameOfHash(hash);
    if (!(await existsp(fullCacheName))) {
      await mkdirpp(path.dirname(fullCacheName));
      await link(tmpFile, fullCacheName);
    }
    await unlink(tmpFile);
  }

  private cacheNameOfHash(hash: string): string {
    return path.join(this.location, hash.substr(0, 2), hash.substr(2,2), hash.substr(4));
  }
}