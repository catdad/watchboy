/* eslint-env mocha */
const path = require('path');
const fs = require('fs-extra');
const root = require('rootrequire');
const { expect } = require('chai');
const touch = async filepath => {
  const fd = await fs.open(filepath, 'a');
  const now = new Date();
  await fs.futimes(fd, now, now);
  await fs.close(fd);
};

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

  const take = async (emitter, name, count) => {
    return [
      await new Promise(r => emitter.once(name, a => r(a))),
      ...(count > 1 ? (await take(emitter, name, count - 1)) : [])
    ];
  };

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

  it('watches deep files', async () => {
    await Promise.all([
      file('a/b/c/d/e/seven.txt'),
      file('a/b/c/d/e/f/eight.txt'),
    ].map(f => fs.outputFile(f, '')));

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
      path.resolve(temp, 'a'),
      path.resolve(temp, 'a/b'),
      path.resolve(temp, 'a/b/c'),
      path.resolve(temp, 'a/b/c/d'),
      path.resolve(temp, 'a/b/c/d/e'),
      path.resolve(temp, 'a/b/c/d/e/f'),
    ].sort());

    expect(files.sort()).to.deep.equal([
      file('one.txt'),
      file('bananas/two.txt'),
      file('bananas/three.txt'),
      file('oranges/four.txt'),
      file('oranges/five.txt'),
      file('pineapples/six.txt'),
      file('a/b/c/d/e/seven.txt'),
      file('a/b/c/d/e/f/eight.txt'),
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

    const [addedFile, addedDirs] = await Promise.all([
      new Promise(r => {
        watcher.once('add', ({ path }) => r(path));
      }),
      take(watcher, 'addDir', 2).then(r => r.map(({ path }) => path)),
      fs.outputFile(testFile, '')
    ]);

    expect(addedFile).to.equal(testFile);
    expect(addedDirs.sort()).to.deep.equal([
      path.dirname(path.dirname(testFile)),
      path.dirname(testFile),
    ]);

    const [changedFile] = await Promise.all([
      new Promise(r => {
        watcher.once('change', ({ path }) => r(path));
      }),
      touch(testFile)
    ]);

    expect(changedFile).to.equal(testFile);
  });

  it('watches a nested pattern', async () => {
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

  describe('ignores', () => {
    const delay = func => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          func().then(resolve).catch(reject);
        }, 20);
      });
    };

    it('does not add files matching a negative pattern', async () => {
      await Promise.all([
        file('pineapples/seven.log'),
        file('oranges/eight.log'),
      ].map(f => fs.outputFile(f, '')));

      const dirs = [], files = [];

      await new Promise(r => {
        watcher = watchboy(['**/*', '!**/*.log'], { cwd: temp, persistent: false })
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
        file('pineapples/six.txt'),
      ].sort());
    });

    it('does not add directories and files in them matching a negative pattern', async () => {
      const dirs = [], files = [];

      await new Promise(r => {
        watcher = watchboy(['**/*', '!bananas'], { cwd: temp, persistent: false })
          .on('add', ({ path }) => files.push(path))
          .on('addDir', ({ path }) => dirs.push(path))
          .on('ready', () => r());
      });

      expect(dirs.sort()).to.deep.equal([
        path.resolve(temp),
        path.resolve(temp, 'oranges'),
        path.resolve(temp, 'pineapples'),
      ].sort());

      expect(files.sort()).to.deep.equal([
        file('one.txt'),
        file('oranges/four.txt'),
        file('oranges/five.txt'),
        file('pineapples/six.txt'),
      ].sort());
    });

    it('does not trigger change events for files matching a negative pattern', async () => {
      const negativeFile = file('oranges/seven.log');
      const positiveFile = file('oranges/eight.txt');
      await Promise.all([
        negativeFile,
        positiveFile,
      ].map(f => fs.outputFile(f, '')));

      await new Promise(r => {
        watcher = watchboy(['**/*', '!**/*.log'], { cwd: temp }).on('ready', () => r());
      });

      const [changedFile] = await Promise.all([
        new Promise(r => {
          watcher.once('change', ({ path }) => r(path));
        }),
        touch(negativeFile),
        delay(() => touch(positiveFile))
      ]);

      expect(changedFile).to.equal(positiveFile);
    });

    it('does not trigger events for directories matching a negative pattern', async () => {
      const negativeDir = file('kiwis');
      const positiveDir = file('limes');
      await Promise.all([
        negativeDir,
        positiveDir,
      ].map(f => fs.ensureDir(f)));

      await new Promise(r => {
        watcher = watchboy(['**/*', '!kiwis'], { cwd: temp }).on('ready', () => r());
      });

      const [unlinkedDir] = await Promise.all([
        new Promise(r => {
          watcher.once('unlinkDir', ({ path }) => r(path));
        }),
        fs.remove(negativeDir),
        delay(() => fs.remove(positiveDir))
      ]);

      expect(unlinkedDir).to.equal(positiveDir);
    });

    it('does not trigger events for files inside directories matching a negative pattern', async () => {
      const negativeFile = file('kiwis/seven.txt');
      const negativeDir = path.dirname(negativeFile);
      const positiveFile = file('limes/eight.txt');
      const positiveDir = path.dirname(positiveFile);
      await Promise.all([
        negativeFile,
        positiveFile,
      ].map(f => fs.outputFile(f, '')));

      await new Promise(r => {
        watcher = watchboy(['**/*', '!kiwis'], { cwd: temp }).on('ready', () => r());
      });

      const [unlinkedFile, unlinkedDir] = await Promise.all([
        new Promise(r => {
          watcher.once('unlink', ({ path }) => r(path));
        }),
        new Promise(r => {
          watcher.once('unlinkDir', ({ path }) => r(path));
        }),
        fs.remove(negativeDir),
        delay(() => fs.remove(positiveDir))
      ]);

      expect(unlinkedFile).to.equal(positiveFile);
      expect(unlinkedDir).to.equal(positiveDir);
    });

    it('does not trigger add for a new file matcing a negative pattern', async () => {
      const negativeFile = file('oranges/seven.log');
      const positiveFile = file('oranges/eight.txt');

      await new Promise(r => {
        watcher = watchboy(['**/*', '!**/*.log'], { cwd: temp }).on('ready', () => r());
      });

      const [addedFile] = await Promise.all([
        new Promise(r => {
          watcher.once('add', ({ path }) => r(path));
        }),
        fs.outputFile(negativeFile, ''),
        delay(() => fs.outputFile(positiveFile, ''))
      ]);

      expect(addedFile).to.equal(positiveFile);
    });

    // TODO: this test does not work yet
    it('does not trigger add for a new file in a directory matching a negative pattern', async () => {
      const negativeFile = file('kiwis/seven.txt');
      const positiveFile = file('limes/eight.txt');

      await new Promise(r => {
        watcher = watchboy(['**/*', '!kiwis/**'], { cwd: temp }).on('ready', () => r());
      });

      const [addedFile] = await Promise.all([
        new Promise(r => {
          watcher.once('add', ({ path }) => r(path));
        }),
        fs.outputFile(negativeFile, ''),
        delay(() => fs.outputFile(positiveFile, ''))
      ]);

      expect(addedFile).to.equal(positiveFile);
    });

    it('positive patters after an ignore add files back in', async () => {
      await Promise.all([
        file('bananas/sliced/seven.txt'),
        file('bananas/sliced/eight.txt'),
        file('bananas/mashed/nine.txt'),
      ].map(f => fs.outputFile(f, '')));

      const dirs = [], files = [];

      await new Promise(r => {
        watcher = watchboy(['**/*', '!bananas/**/*', 'bananas/sliced/**/*'], { cwd: temp, persistent: false })
          .on('add', ({ path }) => files.push(path))
          .on('addDir', ({ path }) => dirs.push(path))
          .on('ready', () => r());
      });

      expect(dirs.sort()).to.deep.equal([
        path.resolve(temp),
        path.resolve(temp, 'bananas'),
        path.resolve(temp, 'bananas/sliced'),
        path.resolve(temp, 'oranges'),
        path.resolve(temp, 'pineapples'),
      ].sort());

      expect(files.sort()).to.deep.equal([
        file('one.txt'),
        file('bananas/sliced/seven.txt'),
        file('bananas/sliced/eight.txt'),
        file('oranges/four.txt'),
        file('oranges/five.txt'),
        file('pineapples/six.txt'),
      ].sort());
    });
  });

  describe('close', () => {
    it('stops all listeners');
  });
});
