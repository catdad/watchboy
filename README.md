# watchboy

[![watchboy logo](https://cdn.jsdelivr.net/gh/catdad-experiments/catdad-experiments-org@7005ab/watchboy/logo.jpg)](https://github.com/catdad/watchboy/)

[![travis][travis.svg]][travis.link]
[![npm-downloads][npm-downloads.svg]][npm.link]
[![npm-version][npm-version.svg]][npm.link]
[![dm-david][dm-david.svg]][dm-david.link]

[travis.svg]: https://travis-ci.com/catdad/watchboy.svg?branch=master
[travis.link]: https://travis-ci.com/catdad/watchboy
[npm-downloads.svg]: https://img.shields.io/npm/dm/watchboy.svg
[npm.link]: https://www.npmjs.com/package/watchboy
[npm-version.svg]: https://img.shields.io/npm/v/watchboy.svg
[dm-david.svg]: https://david-dm.org/catdad/watchboy.svg
[dm-david.link]: https://david-dm.org/catdad/watchboy

Watch files and directories for changes. Fast. No hassle. No native dependencies. Works the same way on Windows, Linux, and MacOS. Low memory usage. Shows you a picture of a dog. It's everything you've ever wanted in a module!

## Install

```bash
npm install watchboy
```

## Example

```javascript
const watchboy = require('watchboy');

// watch all files in the current directory, except node modules and dotfiles
const watcher = watchboy(['**/*', '!node_modules/**', '!.*']);

watcher.on('add', ({ path }) => console.log('add:', path));
watcher.on('addDir', ({ path }) => console.log('addDir:', path));
watcher.on('change', ({ path }) => console.log('change:', path));
watcher.on('unlink', ({ path }) => console.log('unlink:', path));
watcher.on('unlinkDir', ({ path }) => console.log('unlinkDir:', path));

watcher.on('ready', () => console.log('all initial files and directories found'));
watcher.on('error', err => console.error('watcher error:', err));

// stop all watching
// watcher can no longer be used and it will no longer fire any events
watcher.close();
```

## API

### `watchboy(pattern, [options])` → [`EventEmitter`]

Watchboy is exposed as a function which returns an event emitter. It takes the following parameters:
* **`pattern`** _(`string|Array<string>`)_: A glob string or array of glob strings to watch, including positive and negative patterns. Directories are also expanded.
* **`[options]`** _(`Object`)_: An optional options object, which contains the following properties:
  * **`[cwd = process.cwd()]`** _(`string`)_: The root directory from which to glob.
  * **`[persistent = true]`** _(`boolean`)_: Whether the process should continue to run as long as files are being watched.

The following events are available on the watcher:

### `.on('add', ({ path }) => {})` → [`EventEmitter`]

Indicates that a new file was added. There is a single argument for this event, which has a `path` property containing the absolute path for the file that was added.

### `.on('addDir', ({ path }) => {})` → [`EventEmitter`]

Indicates that a new directory was added. There is a single argument for this event, which has a `path` property containing the absolute path for the directory that was added. Files in this new directory will also be watched according to the provided patterns.

### `.on('change', ({ path }) => {})` → [`EventEmitter`]

Indicates that a file has changed. There is a single argument for this event, which has a `path` property containing the absolute path for the file that has changed.

### `.on('unlink', ({ path }) => {})` → [`EventEmitter`]

Indicates that a watched file no longer exists. There is a single argument for this event, which has a `path` property containing the absolute path for the file that no longer exists.

### `.on('unlinkDir', ({ path }) => {})` → [`EventEmitter`]

Indicates that a watched directory no longer exists. There is a single argument for this event, which has a `path` property containing the absolute path for the directory that no longer exists.

### `.on('ready', () => {})` → [`EventEmitter`]

Indicates that all initial files and directories have been discovered. This even has no arguments. Note that new `add` and `addDir` events may fire after this, as new files and directories that match the patterns are created.

### `.on('error', (err) => {})` → [`EventEmitter`]

Indicates that an error has occurred. You must handle this event so that your application does not crash. This error has a single argument: an error which indicates what happened. Aside from standard error properties, there is an additional `path` property indicating the absolute path of the file or directory which triggered the error.

### `.close()`

Stop watching all files. After this method is called, the watcher can no longer be used and no more events will fire.

[`EventEmitter`]: https://nodejs.org/api/events.html#events_class_eventemitter

## Performance

Check out [this benchmark](https://github.com/catdad-experiments/filewatch-benchmarks) comparing `watchboy` to popular alternatives. Spoiler: it fares really well.
