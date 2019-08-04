/* eslint-disable no-console */
process.title = 'watch harness';

const watchboy = require('./');

const pattern = process.argv[2];
console.log('starting glob for: "%s"', pattern);

const start = Date.now();

watchboy(pattern).on('ready', ({ files, dirs }) => {
  console.log('done in %sms', Date.now() - start);
  console.log('watching %s files', files.length);
  console.log('watching %s directories', dirs.length);
}).on('change', ({ entity, path, type, name }) => {
  console.log(entity, type, name, path, Date.now());
});
