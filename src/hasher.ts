import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {Entry, Entries, isDirectory} from './entries';

export class FileHasher {
  constructor(private algorithm: string) {}
  
  /**
   * Returns the hash of a file as hex string.
   * 
   * @param filename the name of the file to hash.
   * @returns a Promise for the hash of the file.
   */
  hashOf(filename: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      var hash = crypto.createHash(this.algorithm);
      var stream = fs.createReadStream(filename);

      stream.on('data', (data: any) => {
          hash.update(data);
      });

      stream.on('error', function (error: Error) {
        reject(error);
      });

      stream.on('end', function () {
        resolve(hash.digest('hex'));
      });     
   })
 }
 
 /**
  * Returns Entries for a directory.
  * 
  * @param directory the name of the directory.
  * @returns a Promise for the Entries.
  */
 hashDir(directory: string): Promise<Entries> {
   let failed = false;
   return new Promise<Entries>((resolve, reject) => {
    function reportError(err: any) {
      reject(err);
      failed = true;
    }
    fs.readdir(directory,  (err, files) => {
      if (err) {
        return reportError(err);
      }

      var result: Entries = [];
      var expected = files.length;
      if (expected == 0) {
        return resolve(result);
      }
      files = files.sort();
      files.map((file, i) => {
        var fullPath = path.join(directory, file);
        function report(info: Entry) {
          result[i] = info;
          if (--expected == 0) {
            resolve(result);
          }
        }
        fs.stat(fullPath, (err, pathStat) => {
          if (failed) return;
          if (err) {
            if (err.code == 'ENOENT') {
              // Probably a symbolic link to a deleted or moved file.
              return report({file: file, hash: 'missing'});
            } else {
              return reportError(err);
            }
          }
          if (pathStat.isFile()) {
            this.hashOf(fullPath).then(hash => {
              if (failed) return;
              report({ file: file, hash: hash });
            });
          } else {
            this.hashDir(fullPath).then(result =>  {
              if (failed) return;
              report({directory: file, hash: this.hashEntries(result), files: result});
            });
          }
        });
      });
    });    
   });     
  }
  
  /**
   * Return the hash code the entries.
   * 
   * @param entries entries to hash
   * @returns hash code of the entries
   */
  hashEntries(entries: Entries): string {
    let hash = crypto.createHash(this.algorithm);
    hash.update(JSON.stringify(entries.map(data => {
      if (isDirectory(data)) {
        // Exclude the files from a directory as the file hashes are already part of the directory hash.
        return { dirctory: data.directory, hash: data.hash };
      }
      return data;
    })));
    return hash.digest('hex');
  }
} 
