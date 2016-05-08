import * as fs from 'fs';
import * as path from 'path';

import {dirSync} from 'tmp';

export const FILES = {
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

export interface Data {
  [name: string]: string | Data;
}

export interface SetupInfo {
   name: string;
   cleanup: () => void;
}

export function rmdirRecursiveSync(root: string) {
  var dirs = [root];

  do {
    var
      dir = <string>dirs.pop(),
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

export function setupData(): SetupInfo {
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