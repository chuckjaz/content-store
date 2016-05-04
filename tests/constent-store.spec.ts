import {FileHasher} from '../src/hasher';
import {isDirectory, isFile, Entries, FileEntry} from '../src/entries';
import {ContentStore} from '../src/content-store';
import {dirSync, setGracefulCleanup} from 'tmp';
import * as fs from 'fs';
import * as path from 'path';

let expect = require('expect');

const FILES = {
  'test': {
    'dir1': {
      'test1': 'Some text',
      'test2': 'Some text',
      'test3': 'Some other text',
      'test4': 'Some other text'
    },
    'dir2': {
      'test1': 'Some text',
      'test2': 'Some text',
      'test3': 'Some other text',
      'test4': 'Some other text'
    }
  }
}

interface Data {
  [name: string]: string | Data;
}  

interface SetupInfo {
   name: string;
   cleanup: () => void;
}

function rmdirRecursiveSync(root: string) {
  var dirs = [root];

  do {
    var
      dir = dirs.pop(),
      deferred = false,
      files = fs.readdirSync(dir);

    for (var i = 0, length = files.length; i < length; i++) {
      var
        file = path.join(dir, files[i]),
        stat = fs.lstatSync(file); // lstat so we don't recurse into symlinked directories

      if (stat.isDirectory()) {
        if (!deferred) {
          deferred = true;
          dirs.push(dir);
        }  
        dirs.push(file);
      } else {
        fs.unlinkSync(file);
      }
    }

    if (!deferred) {
      fs.rmdirSync(dir);
    }
  } while (dirs.length !== 0);
}

function setupData(): SetupInfo {
  const tmpDirInfo = dirSync();
  
  function writeFile(filename: string, data: string) {
    fs.writeFileSync(filename, data, { encoding: 'utf8'});
  }
  
  function writeDirectory(directory: string, create: boolean, data: Data) {
    if (create)
      fs.mkdirSync(directory);
      
    for (let name in data) {
      let entry = data[name];
      let fullName = path.join(directory, name);
      if (typeof entry == 'string') {
        writeFile(fullName, entry);
      } else {
        writeDirectory(fullName, true, entry);
      }
    }
  }
  
  writeDirectory(tmpDirInfo.name, false, FILES);
  
  return { name: tmpDirInfo.name, cleanup:  () => rmdirRecursiveSync(tmpDirInfo.name) };
}

function filter(entries: Entries, hasher: FileHasher, cb: (entry: FileEntry) => boolean): Entries {
  var newEntries = entries.map(entry => {
    if (isDirectory(entry)) {
      var newFiles = filter(entry.files, hasher, cb);
      var newHash = hasher.hashEntries(newFiles);
      return { directory: entry.directory, hash: newHash, files: newFiles };
    } else if (cb(entry)) {
      return entry;
    } else {
      return undefined;
    }
  }).filter(e => e !== undefined);
  return newEntries;
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
  
  it('should be able to enter a directory', () => {
    return contentStore.enterDirectory(tmpName('test/dir1'));
  });
  
  it('should be able to enter a tree', () => {
    return contentStore.enterDirectory(tmpName('test'));
  });
  
  it('should be able to enter and realize a tree', () => {
    let original = tmpName('test');
    let realized = tmpName('realized');
    return contentStore.enterDirectory(original).then(hash => {
      return contentStore.realize(realized, hash);
    })
    .then(() => {
      return Promise.all([
        hasher.hashDir(original),
        hasher.hashDir(realized)  
      ])
      .then(hashes => {
        expect(hashes[0]).toEqual(hashes[1]);
      })
    });
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
      newEntries = filter(entries, hasher, file => file.file != 'test4');
      return contentStore.realizeVirtualDirectory(realized, newEntries);
    }).then(hash => {
      // Hash the realized directory
      return hasher.hashDir(realized);
    }).then(entries => {
      // Expect the virtual description and the actual hash of thte 
      // realized directory are the same.
      let newEntriesHash = hasher.hashEntries(newEntries);
      let resultEntriesHash = hasher.hashEntries(entries);
      
      expect(resultEntriesHash).toEqual(newEntriesHash);
    });
  });
});