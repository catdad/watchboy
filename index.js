const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');
const diff = require('lodash.difference');
const through = require('through2');

const readdir = (dir, pattern) => {
  return globby(pattern, {
    cwd: dir,
    deep: 1,
    onlyFiles: false,
    markDirectories: true
  });
};

const exists = (abspath) => {
  return new Promise(r => fs.access(abspath, err => r(!err)));
};

const iterateStream = (stream, iterate) => {
  return new Promise((resolve, reject) => {
    stream.on('error', err => reject(err));

    stream.pipe(through.obj((data, enc, cb) => {
      iterate(data).then(() => {
        cb();
      }).catch(err => {
        cb(err);
      });
    }))
      .on('data', () => {})
      .on('end', () => resolve())
      .on('error', err => reject(err));
  });
};

const evMap = {
  change: 1,
  add: 2,
  addDir: 3,
  unlink: 4,
  unlinkDir: 5
};

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};
  const pending = {};
  let closed = false;

  const throttle = (abspath, evname, evarg) => {
    if (closed) {
      return;
    }

    const funcKey = `func : ${abspath}`;

    if (pending[funcKey]) {
      clearTimeout(pending[funcKey]);
    } else {
      // save only the first set of arguments
      pending[abspath] = { evname, evarg, priority: evMap[evname] || 0 };
    }

    if (evMap[evname] > pending[abspath].priority) {
      // this event takes precedence over the queued one
      pending[abspath] = { evname, evarg, priority: evMap[evname] || 0 };
    }

    pending[funcKey] = setTimeout(() => {
      const { evname, evarg } = pending[abspath];
      events.emit(evname, evarg);

      delete pending[abspath];
      delete pending[funcKey];
    }, 50);
  };

  const error = (err, abspath) => {
    if (closed) {
      return;
    }

    err.path = abspath;

    events.emit('error', err);
  };

  const removeFile = (abspath) => {
    const watcher = files[abspath];

    if (watcher) {
      watcher.close();
      delete files[abspath];
      throttle(abspath, 'unlink', { path: abspath });
    }
  };

  const removeDir = (abspath) => {
    const watcher = dirs[abspath];

    if (watcher) {
      watcher.close();
      delete dirs[abspath];
      throttle(abspath, 'unlinkDir', { path: abspath });
    }
  };

  const onFileChange = (abspath) => (type) => {
    if (type === 'rename') {
      return removeFile(abspath);
    }

    throttle(abspath, 'change', { path: abspath });
  };

  const onDirChange = (abspath) => async () => {
    try {
      const paths = await readdir(abspath, pattern);
      const [foundFiles, foundDirs] = paths.reduce(([files, dirs], file) => {
        if (/\/$/.test(file)) {
          dirs.push(path.resolve(abspath, file));
        } else {
          files.push(path.resolve(abspath, file));
        }

        return [files, dirs];
      }, [[], []]);

      // find only files that exist in this directory
      const existingFiles = Object.keys(files)
        .filter(file => path.dirname(file) === abspath)
        .filter(file => !dirs[file]);
      // diff returns items in the first array that are not in the second
      diff(existingFiles, foundFiles).forEach(file => removeFile(file));
      diff(foundFiles, existingFiles).forEach(file => watchFile(file));

      // now do the same thing for directories
      const existingDirs = Object.keys(dirs)
        .filter(dir => path.dirname(dir) === abspath)
        .filter(dir => !files[dir]);

      diff(existingDirs, foundDirs).forEach(dir => removeDir(dir));

      for (let dir of diff(foundDirs, existingDirs)) {
        await watchDir(dir);
      }
    } catch (err) {
      try {
        if (await exists(abspath)) {
          error(err, abspath);
        }
      } catch (e) {
        if (dirs[abspath]) {
          error(err, abspath);
        }
      }
    }
  };

  const watch = (file, func) => fs.watch(file, { persistent }, func);

  const watchFile = (abspath) => {
    if (files[abspath]) {
      return;
    }

    files[abspath] = watch(abspath, onFileChange(abspath));
    files[abspath].on('error', (/* err */) => {
      // TODO what happens with this error?
    });

    events.emit('add', { path: abspath });
  };

  const watchDir = (abspath) => {
    if (dirs[abspath]) {
      return;
    }

    dirs[abspath] = watch(abspath, onDirChange(abspath));
    dirs[abspath].on('error', (/* err */) => {
      // TODO an EPERM error is fired when the directory is deleted
    });

    // check to see if we already have files in there that were
    // added during the initial glob
    return onDirChange(abspath)().then(() => {
      events.emit('addDir', { path: abspath });
    });
  };

  iterateStream(globby.stream(pattern, {
    onlyFiles: false,
    markDirectories: true,
    cwd,
    concurrency: 1
  }), async (file) => {
    const abspath = path.resolve(cwd, file);

    if (/\/$/.test(file)) {
      await watchDir(abspath);
    } else {
      await watchFile(abspath);
    }
  }).then(() => {
    return watchDir(cwd);
  }).then(() => {
    events.emit('ready');
  }).catch(err => {
    events.emit('error', err);
  });

  events.close = () => {
    closed = true;

    for (let file in files) {
      removeFile(file);
    }

    for (let dir in dirs) {
      removeDir(dir);
    }
  };

  return events;
};
