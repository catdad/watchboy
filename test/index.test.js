const { promisify } = require('util');
const path = require('path');
const fs = require('fs-extra');
const root = require('rootrequire');
const { expect } = require('chai');
const touch = promisify(require('touch'));

const watchboy = require(root);

/* eslint-env mocha */
describe('watchboy', () => {
  const temp = path.resolve(root, 'temp');
  const file = relpath => path.resolve(temp, relpath);
  let watcher;

  beforeEach(async () => {
    await fs.remove(temp);
    await Promise.all([
      file('one.txt'),
      file('bananas/two.txt'),
      file('bananas/three.txt'),
      file('oranges/four.txt'),
      file('oranges/five.txt'),
      file('pineapples/six.txt'),
    ].map(f => fs.outputFile(f, Math.random().toString(36))));
  });
  afterEach(async () => {
    if (watcher) {
      watcher.close();
    }
    await fs.remove(temp);
  });

  it('watches expected files and directories after "ready" event', async () => {
    const dirs = [], files = [];

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false })
        .on('add', ({ path }) => files.push(path))
        .on('addDir', ({ path }) => dirs.push(path))
        .on('ready', () => r());
    });

    expect(dirs.sort()).to.deep.equal([
      path.resolve(temp),
      path.resolve(temp, 'bananas'),
      path.resolve(temp, 'oranges'),
      path.resolve(temp, 'pineapples'),
    ].sort());

    expect(files.sort()).to.deep.equal([
      file('one.txt'),
      file('bananas/two.txt'),
      file('bananas/three.txt'),
      file('oranges/four.txt'),
      file('oranges/five.txt'),
      file('pineapples/six.txt')
    ].sort());
  });

  it('emits "change" when a file changes', async () => {
    const testFile = file('pineapples/six.txt');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [changedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('change', ({ path }) => r(path));
      }),
      touch(testFile)
    ]);

    expect(changedFile).to.equal(testFile);
  });

  it('emits "unlink" when a watched file is deleted');

  it('emits "unlinkDir" when a watched directory is deleted');

  it('emits "add" when a new file is created inside a watched directory', async () => {
    const testFile = file('pineapples/seven.txt');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [addedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      fs.outputFile(testFile, Math.random().toString(36))
    ]);

    expect(addedFile).to.equal(testFile);
  });

  it('emits "addDir" when a new directory is created inside a watched directory', async () => {
    const testDir = file('pineapples/chunks');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [addedDir] = await Promise.all([
      new Promise(r => {
        watcher.once('addDir', ({ path }) => r(path));
      }),
      fs.ensureDir(testDir)
    ]);

    expect(addedDir).to.equal(testDir);
  });

  describe('close', () => {
    it('stops all listeners');
  });
});
