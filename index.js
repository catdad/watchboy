const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');
const diff = require('lodash.difference');

const readdir = (dir, pattern) => {
  return globby(pattern, {
    cwd: dir,
    deep: 1
  }).then(paths => paths.map(f => path.resolve(dir, f)));
};

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};

  const removeFile = (abspath) => {
    const watcher = files[abspath];

    if (watcher) {
      watcher.close();
      delete files[abspath];
      events.emit('remove', { path: abspath });
    }
  };

  const onFileChange = abspath => (type) => {
    if (type === 'rename') {
      return removeFile(abspath);
    }

    events.emit('change', { path: abspath });
  };

  const onDirChange = abspath => () => {
    readdir(abspath, pattern).then(paths => {
      // find only files that exist in this directory
      // TODO filter out files that in subdirectories of this directory
      const existing = Object.keys(files).filter(file => file.slice(0, abspath.length) === abspath);
      // diff returns items in the first array that are not in the second
      const newFiles = diff(paths, existing);
      const removedFiles = diff(existing, paths);

      if (removedFiles.length) {
        removedFiles.forEach(file => removedFiles(file));
      }

      if (newFiles.length) {
        newFiles.forEach(file => watchFile(file));
      }
    });
  };

  const watchFile = abspath => {
    files[abspath] = watch(abspath, onFileChange(abspath));
    events.emit('add', { path: abspath });
  };

  const watchDir = abspath => {
    dirs[abspath] = watch(abspath, onDirChange(abspath));
    events.emit('addDir', { path: abspath });
  };

  const watch = (file, func) => fs.watch(file, { persistent }, func);
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
    events.emit('ready', {
      files: Object.keys(files),
      dirs: Object.keys(dirs)
    });
  }).on('error', err => {
    events.emit('error', err);
  });

  return events;
};
