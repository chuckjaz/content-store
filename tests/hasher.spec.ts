import {FileHasher} from '../src/hasher';
import {isDirectory, isFile} from '../src/entries';
import * as mock from 'mock-fs';
let expect = require('expect');

const MOCK_FILES = {
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

describe('hasher', () => {
  
  beforeEach(() => mock(
    MOCK_FILES
  ));
  
  afterEach(mock.restore);

  let hasher: FileHasher;
  
  beforeEach(() => hasher = new FileHasher('sha1'));
      
  it('should be able to hash a file', () => {
    return hasher.hashOf('test/dir1/test1').then(hash => {
      expect(hash).toEqual('02d92c580d4ede6c80a878bdd9f3142d8f757be8');
    });
  });
  
  it('should be able to hash a directory', () => {
    return hasher.hashDir('test/dir1').then(result => {
      expect(result).toEqual([
        {
          "file": "test1",
          "hash": "02d92c580d4ede6c80a878bdd9f3142d8f757be8"
        },
        {
          "file": "test2",
          "hash": "02d92c580d4ede6c80a878bdd9f3142d8f757be8"
        },
        {
          "file": "test3",
          "hash": "b437a399457d2752b876cc70d06ed5251015b064"
        },
        {
          "file": "test4",
          "hash": "b437a399457d2752b876cc70d06ed5251015b064"
        }]);
    });
  });
  
  it('should hash equivilent files equivilently', () => {
    return Promise.all([
      hasher.hashOf('test/dir1/test1'),
      hasher.hashOf('test/dir1/test2')
    ]).then(hashes => {
      expect(hashes[0]).toEqual(hashes[1]);
    });
  });
  
  it('should hash equivilent directories equivilently', () => {
    return Promise.all([
      hasher.hashDir('test/dir1'),
      hasher.hashDir('test/dir2')
    ]).then(results => {
      expect(results[0]).toEqual(results[1]);
    });
  });
  
  it('should be able to hash equivilent sub-directories', () => {
    return hasher.hashDir('test').then(result => {
      expect(result.length).toEqual(2);
      let directory1 = result[0];
      let directory2 = result[1];
      expect(isDirectory(directory1)).toBeTruthy();
      expect(isDirectory(directory2)).toBeTruthy();
      if (isDirectory(directory1) && isDirectory(directory2)) {
        expect(directory1.hash).toEqual(directory2.hash);
      }
    });
  });
});


