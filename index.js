const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');

module.exports = (pattern, { persistent = true } = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};

  const watch = (file, func) => fs.watch(file, { persistent }, func);

  globby.stream(pattern, { onlyFiles: false, markDirectories: true })
    .on('data', file => {
      if (/\/$/.test(file)) {
        dirs[file] = watch(file, (type, name) => {
          events.emit('change', {
            path: file,
            type, name,
            entity: 'directory'
          });
        });
      } else {
        files[file] = watch(file, (type, name) => {
          events.emit('change', {
            path: file,
            type, name,
            entity: 'file'
          });
        });
      }
    })
    .on('end', () => {
      events.emit('ready', {
        files: Object.keys(files),
        dirs: Object.keys(dirs)
      });
    })
    .on('error', err => {
      events.emit('error', err);
    });

  return events;
};
