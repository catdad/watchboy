/* eslint-disable no-console */
process.title = 'watch harness';

const watchboy = require('../');
//const chokidar = require('./chokidar.fixture.js');

const patterns = process.argv.slice(2);
console.log('starting glob for:', patterns);

const files = [];
const dirs = [];
let ready = false;
const start = Date.now();

//const watcher = chokidar(patterns).on('add', ({ path }) => {
watchboy(patterns).on('add', ({ path }) => {
  if (ready) {
    return void console.log('add file after ready:', path);
  }
  files.push(path);
}).on('addDir', ({ path }) => {
  if (ready) {
    return void console.log('add dir after ready:', path);
  }
  dirs.push(path);
}).on('change', ({ path }) => {
  console.log('change:', path, Date.now());
}).on('unlink', ({ path }) => {
  console.log('unlink:', path);
}).on('unlinkDir', ({ path }) => {
  console.log('unlinkDir:', path);
}).on('ready', () => {
  console.log('ready in %sms', Date.now() - start);
  console.log('watching %s files', files.length);
  console.log('watching %s directories', dirs.length);

  ready = true;

//  console.log(files);
//  console.log(dirs);
});

// TODO:
// large file can wait for writes to finish before firing event
// handle errors on every watcher
// add `add` method to manually add more things to watch

// cd coverage
// node ..\test\harness.js "**/*" "!lcov-report"
