/* eslint-disable no-console */
process.title = 'watch harness';

const watchboy = require('./');
//const chokidar = require('./test/chokidar.fixture.js');

const patterns = process.argv.slice(2);
console.log('starting glob for:', patterns);

const files = [];
const dirs = [];
let ready = false;
const start = Date.now();

//const watcher = chokidar(patterns).on('add', ({ path }) => {
const watcher = watchboy(patterns).on('add', ({ path }) => {
  if (ready) return;
  files.push(path);
}).on('addDir', ({ path }) => {
  if (ready) return;
  dirs.push(path);
}).on('ready', () => {
  console.log('ready in %sms', Date.now() - start);
  console.log('watching %s files', files.length);
  console.log('watching %s directories', dirs.length);

  ready = true;

//  console.log(files);
//  console.log(dirs);

  watcher.on('add', ({ path }) => {
    console.log('add file after ready:', path);
  }).on('addDir', ({ path }) => {
    console.log('add dir after ready:', path);
  });
}).on('change', ({ path }) => {
  console.log('change:', path, Date.now());
}).on('unlink', ({ path }) => {
  console.log('unlink:', path);
}).on('unlinkDir', ({ path }) => {
  console.log('unlinkDir:', path);
});

// TODO:
// large file can wait for writes to finish before firing event
// handle errors on every watcher
// add `close` method to stop the whole thing
// add `add` method to manually add more things to watch

// DONE
// changed file fires an event
// new file created in watched directory fires an event
// when a file is deleted a remove event fires
//  * rename event is not propagated
// when a directory is deleted, a remove event fires
// events are throttled to handle duplicates
// new directory created in watched directory fires an event
//  * new files in directory are watched
//  * new subdirectories are watched
//  * new files in new subdirectories are watched
