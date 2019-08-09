/* eslint-env mocha */
const { promisify } = require('util');
const path = require('path');
const fs = require('fs-extra');
const root = require('rootrequire');
const { expect } = require('chai');
const touch = promisify(require('touch'));

const log = (...args) => {
  if (process.env.TEST_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

const watchboy = (() => {
  const lib = require(root);

  return (...args) => {
    const watcher = lib(...args);

    watcher.on('add', ({ path }) => log('add:', path));
    watcher.on('addDir', ({ path }) => log('addDir:', path));
    watcher.on('change', ({ path }) => log('change:', path));
    watcher.on('unlink', ({ path }) => log('unlink:', path));
    watcher.on('unlinkDir', ({ path }) => log('unlinkDir:', path));
    watcher.on('ready', () => log('ready'));
    watcher.on('error', err => log('watcher error:', err.message));

    return watcher;
  };
})();

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
    ].map(f => fs.outputFile(f, '')));
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

  it('emits "unlink" when a watched file is deleted', async () => {
    const testFile = file('oranges/five.txt');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [unlinkedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('unlink', ({ path }) => r(path));
      }),
      fs.remove(testFile)
    ]);

    expect(unlinkedFile).to.equal(testFile);
  });

  it('emits "unlinkDir" when a watched directory is deleted', async () => {
    const testDir = file('oranges');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [unlinkedDir] = await Promise.all([
      new Promise(r => {
        watcher.once('unlinkDir', ({ path }) => r(path));
      }),
      fs.remove(testDir)
    ]);

    expect(unlinkedDir).to.equal(testDir);
  });

  it('emits "add" when a new file is created inside a watched directory', async () => {
    const testFile = file('pineapples/seven.txt');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [addedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      fs.outputFile(testFile, '')
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

  it('emits an "add" and "addDir" when a new file is added to a new directory in an already watched directory', async () => {
    const testFile = file('pineapple/wedges/seven.txt');

    await new Promise(r => {
      watcher = watchboy('**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const [addedFile, addedDir] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      new Promise(r => {
        watcher.once('addDir', ({ path }) => r(path));
      }),
      fs.outputFile(testFile, '')
    ]);

    expect(addedFile).to.equal(testFile);
    expect(addedDir).to.equal(path.dirname(testFile));

    const [changedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('change', ({ path }) => r(path));
      }),
      touch(testFile)
    ]);

    expect(changedFile).to.equal(testFile);
  });

  it.skip('watches a nested pattern', async () => {
    await new Promise(r => {
      watcher = watchboy('pineapples/**/*', { cwd: temp, persistent: false }).on('ready', () => r());
    });

    const actualAddedFile = file('pineapples/seven.txt');
    const [addedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      fs.outputFile(actualAddedFile, '')
    ]);

    expect(addedFile).to.equal(actualAddedFile);

    const actualChangedFile = file('pineapples/six.txt');
    const [changedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('change', ({ path }) => r(path));
      }),
      touch(actualChangedFile)
    ]);

    expect(changedFile).to.equal(actualChangedFile);

    const actualAddedDir = file('pineapples/slices');
    const [addedDir] = await Promise.all([
      new Promise(r => {
        watcher.once('addDir', ({ path }) => r(path));
      }),
      fs.ensureDir(actualAddedDir)
    ]);

    expect(addedDir).to.equal(actualAddedDir);

    const actualNestedFile = file('pineapples/slices/eight.txt');
    const [nestedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      fs.outputFile(actualNestedFile, '')
    ]);

    expect(nestedFile).to.equal(actualNestedFile);
  });

  describe('close', () => {
    it('stops all listeners');
  });
});
