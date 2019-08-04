const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};

  const watch = (file, func) => fs.watch(file, { persistent }, func);
  globby.stream(pattern, {
    onlyFiles: false,
    markDirectories: true,
    cwd,
    concurrency: 1
  }).on('data', file => {
    const abspath = path.resolve(cwd, file);

    if (/\/$/.test(file)) {
      dirs[abspath] = watch(file, (type, name) => {
        events.emit('change', {
          path: abspath,
          type, name,
          entity: 'directory'
        });
      });
      events.emit('addDir', { path: file });
    } else {
      files[abspath] = watch(file, (type, name) => {
        events.emit('change', {
          path: abspath,
          type, name,
          entity: 'file'
        });
      });
      events.emit('add', { path: file });
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
