const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');
const diff = require('lodash.difference');

const readdir = (dir, pattern) => {
  return globby(pattern, {
    cwd: dir,
    deep: 1,
    onlyFiles: false,
    markDirectories: true
  });
};

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};
  const pending = {};

  const throttle = (abspath, evname, evarg) => {
    const funcKey = `func : ${abspath}`;

    if (pending[funcKey]) {
      clearTimeout(pending[funcKey]);
    } else {
      // save only the first set of arguments
      pending[abspath] = [evname, evarg];
    }

    pending[funcKey] = setTimeout(() => {
      const [name, arg] = pending[abspath];
      events.emit(name, arg);
    }, 50);
  };

  const removeFile = (abspath) => {
    const watcher = files[abspath];

    if (watcher) {
      watcher.close();
      delete files[abspath];
      events.emit('unlink', { path: abspath });
    }
  };

  const removeDir = (abspath) => {
    const watcher = dirs[abspath];

    if (watcher) {
      watcher.close();
      delete dirs[abspath];
      events.emit('unlinkDir', { path: abspath });
    }
  };

  const onFileChange = abspath => (type) => {
    if (type === 'rename') {
      return removeFile(abspath);
    }

    throttle(abspath, 'change', { path: abspath });
  };

  const onDirChange = abspath => (...args) => {
    readdir(abspath, pattern).then(paths => {
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
      const newFiles = diff(foundFiles, existingFiles);
      const removedFiles = diff(existingFiles, foundFiles);

      if (removedFiles.length) {
        removedFiles.forEach(file => removeFile(file));
      }

      if (newFiles.length) {
        newFiles.forEach(file => watchFile(file));
      }

      // now do the same thing for directories
      const existingDirs = Object.keys(dirs)
        .filter(dir => path.dirname(dir) === abspath)
        .filter(dir => !files[dir]);

      const newDirs = diff(foundDirs, existingDirs);
      const removedDirs = diff(existingDirs, foundDirs);

      if (removedDirs.length) {
        removedDirs.forEach(dir => removeDir(dir));
      }

      if (newDirs.length) {
        newDirs.forEach(dir => watchDir(dir));
      }
    });
  };

  const watch = (file, func) => fs.watch(file, { persistent }, func);

  const watchFile = abspath => {
    if (files[abspath]) {
      return;
    }

    files[abspath] = watch(abspath, onFileChange(abspath));
    files[abspath].on('error', err => {});

    events.emit('add', { path: abspath });
  };

  const watchDir = abspath => {
    if (dirs[abspath]) {
      return;
    }

    dirs[abspath] = watch(abspath, onDirChange(abspath));
    dirs[abspath].on('error', err => {
      // TODO an EPERM error is fired when the directory is deleted
    });

    events.emit('addDir', { path: abspath });
  };

  globby.stream(pattern, {
    onlyFiles: false,
    markDirectories: true,
    cwd,
    concurrency: 1
  }).on('data', file => {
    const abspath = path.resolve(cwd, file);

    if (/\/$/.test(file)) {
      watchDir(abspath);
    } else {
      watchFile(abspath);
    }
  }).on('end', () => {
    watchDir(cwd);
    events.emit('ready');
  }).on('error', err => {
    events.emit('error', err);
  });

  return events;
};
