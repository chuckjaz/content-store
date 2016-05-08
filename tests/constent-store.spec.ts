import {FileHasher} from '../src/hasher';
import {isDirectory, isFile, Entries, FileEntry} from '../src/entries';
import {ContentStore} from '../src/content-store';
import {dirSync, setGracefulCleanup} from 'tmp';
import * as fs from 'fs';
import * as path from 'path';

let expect = require('expect');

import {setupData, SetupInfo} from './helpers';

function filter(entries: Entries, hasher: FileHasher, cb: (entry: FileEntry) => boolean): Entries {
  var newEntries = entries.map(entry => {
    if (isDirectory(entry)) {
      var newFiles = filter(entry.files, hasher, cb);
      var newHash = hasher.hashEntries(newFiles);
      return { name: entry.name, hash: newHash, files: newFiles };
    } else if (cb(entry)) {
      return entry;
    } else {
      return undefined;
    }
  }).filter(e => e !== undefined);
  return <Entries>newEntries;
}

describe('content-store', () => {
  let setupInfo: SetupInfo;
  let hasher: FileHasher;
  let contentStore: ContentStore;

  beforeEach(() => setupInfo = setupData());
  afterEach(() => setupInfo.cleanup());
  beforeEach(() => hasher = new FileHasher('sha1'));
  beforeEach(() => {
    let cacheName = path.join(setupInfo.name, 'cache');
    contentStore = new ContentStore(cacheName, hasher);
  });

  function tmpName(name: string): string {
    return path.join(setupInfo.name, name);
  }

  it('should be able to enter a file', () => {
    return contentStore.enterFile(tmpName('test/dir1/test1'));
  });

  it('should be able to enter a stream', () => {
    let fileName = tmpName('test/dir1/test1');
    let stream = fs.createReadStream(fileName);
    return contentStore.enterFile(stream);
  })

  it('should be able to enter a directory', () => {
    return contentStore.enterDirectory(tmpName('test/dir1'));
  });

  it('should be able to enter a tree', () => {
    return contentStore.enterDirectory(tmpName('test'));
  });

  it('should hash a stream the same as the equivlent file', async () => {
    let fileName = tmpName('test/dir1/test1');
    let fileHash = await hasher.hashOf(fileName);
    let stream = fs.createReadStream(fileName);
    let streamHash = await contentStore.enterFile(stream);
    expect(streamHash).toEqual(fileHash);
  });

  it('should be able to enter the same file 1000 time as a file and stream', async () => {
    let fileName = tmpName('test/dir1/test1');
    let expectedHash = await hasher.hashOf(fileName);
    await Promise.all(new Array(2000).map(async (_, i) => {
      let hash: string;
      if (i % 2 == 0)
        hash = await contentStore.enterFile(fileName);
      else {
        let stream = fs.createReadStream(fileName);
        hash = await contentStore.enterFile(stream);
      }
      expect(hash).toEqual(expectedHash);
    }));
  });

  it('should be able to enter and realize a tree', async () => {
    let original = tmpName('test');
    let realized = tmpName('realized');
    let hash = (await contentStore.enterDirectory(original)).hash;
 
    await contentStore.realize(realized, hash);
    let entries = await Promise.all([
      hasher.hashDir(original),
      hasher.hashDir(realized)
    ]);
    let originalEntries = entries[0], realizeEntries = entries[1];
    expect(realizeEntries).toEqual(originalEntries);
  });

  it('should be able to enter a virtual directory', async () => {
    let original = tmpName('test');
    await contentStore.enterDirectory(original);
    let entries = await hasher.hashDir(original);
    let virtual = filter(entries, hasher, file => file.name != 'test4');
    let hash = await contentStore.enterVirtualDirectory(virtual);
    expect(hash).toEqual('d5ad8dc0d2d9f69aa89dc610d22c1747fc608e93');
  });
  
  it('should be able to realize a virtual tree', () => {
    let original = tmpName('test');
    let realized = tmpName('realized');
    let newEntries: Entries;
    return contentStore.enterDirectory(original).then(hash => {
      let newEnteries: Entries;
      return hasher.hashDir(original);
    }).then(entries => {
      // Filter out test4 to produce a virtual directory without it.
      newEntries = filter(entries, hasher, file => file.name != 'test4');
      return contentStore.realizeVirtualDirectory(realized, newEntries);
    }).then(hash => {
      // Hash the realized directory
      return hasher.hashDir(realized);
    }).then(entries => {
      // Expect the virtual description and the actual hash of the
      // realized directory are the same.
      let newEntriesHash = hasher.hashEntries(newEntries);
      let resultEntriesHash = hasher.hashEntries(entries);

      expect(resultEntriesHash).toEqual(newEntriesHash);
    });
  });
});