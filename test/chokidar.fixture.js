const { resolve } = require('path');
const EventEmitter = require('events');
const chokidar = require('chokidar');

module.exports = (patterns, opts = {}) => {
  const cwd = opts.cwd || process.cwd();
  opts.ignorePermissionErrors = true;

  const events = new EventEmitter();
  const watcher = chokidar.watch(patterns, opts);

  watcher.on('add', path => events.emit('add', { path: resolve(cwd, path) }));
  watcher.on('addDir', path => events.emit('addDir', { path: resolve(cwd, path) }));
  watcher.on('change', path => events.emit('change', { path: resolve(cwd, path) }));
  watcher.on('unlink', path => events.emit('unlink', { path: resolve(cwd, path) }));
  watcher.on('unlinkDir', path => events.emit('unlinkDir', { path: resolve(cwd, path) }));

  watcher.on('ready', () => {
    events.emit('addDir', { path: cwd });
    events.emit('ready');
  });

  events.close = () => watcher.close();

  return events;
};
