const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const diff = require('lodash.difference');
const unixify = require('unixify');
const dirGlob = require('dir-glob');
const micromatch = require('micromatch');
const pify = require('pify');
const hitime = require('hitime');

let watchTime = 0;
let readdirTime = 0;
let matchTime = 0;
let globdirTime = 0;
let globparseTime = 0;
let globdiffTime = 0;

let diffOne = 0;
let diffOneA = 0;
let diffTwo = 0;
let diffThree = 0;
let diffFour = 0;
let diffFive = 0;

const EV_DISCOVER = '_wb_discover';
const STATE = {
  STARTING: 'starting',
  READY: 'ready',
  CLOSED: 'closed'
};

const pReaddir = pify(fs.readdir);
const pStat = pify(fs.stat);

const stat = async (file) => {
  try {
    return await pStat(file);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null;
    }

    throw e;
  }
};

const readdir = async (dir) => {
  dir = dir.slice(-1) === '/' ? dir : `${dir}/`;

  let result;

  if (fs.Dirent) {
    result = await pReaddir(dir, { withFileTypes: true });
  } else {
    const list = await pReaddir(dir);
    result = [];

    for (let name of list) {
      result.push(Object.assign(await pStat(`${dir}${name}`), { name }));
    }
  }

  return result.map(dirent => {
    return dirent.isDirectory() ? `${dir}${dirent.name}/` : `${dir}${dirent.name}`;
    //    const value = dirent.isDirectory() ? `${dir}${dirent.name}/` : `${dir}${dirent.name}`;
    //    value.name = dirent.name;
    //    value.parent = dir;
    //
    //    return value;
  });
};

const isMatch = (input, patterns) => {
  let failed = false;

  for (let p of patterns) {
    failed = failed || !micromatch.isMatch(input, p);
  }

  return !failed;
};

const isParent = (input, patterns) => {
  for (let p of patterns) {
    if (p.indexOf(input) === 0) {
      return true;
    }
  }

  return false;
};

const globdir = async (dir, patterns) => {
  const run = async () => {
    const a = hitime();
    const entries = await readdir(dir);
    const b = hitime();
    const matches = entries.filter((e) => isMatch(e, patterns) || isParent(e, patterns));
    const c = hitime();

    readdirTime += b - a;
    matchTime += c - b;

    return matches;
  };

  if (fs.Dirent && process.platform !== 'darwin') {
    return await run();
  }

  // node 8 has this nasty habbit of returning 0 entries on a readdir
  // directly after a change even when there are entries, so we need
  // to confirm that two runs read the same amount of entries
  const one = await run();
  const two = await run();

  if (one.length === two.length) {
    return two;
  }

  return globdir(dir, patterns);
};

const exists = (abspath) => {
  return new Promise(r => fs.access(abspath, err => r(!err)));
};

const evMap = {
  change: 1,
  add: 2,
  addDir: 3,
  unlink: 4,
  unlinkDir: 5
};

const addDriveLetter = (basePath, str) => {
  const drive = (basePath.match(/^([a-z]:)\\/i) || [])[1];
  return drive ? `${drive}${str}` : str;
};

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  // support passing relative paths and '.'
  cwd = path.resolve(cwd);

  const resolvedPatterns = (Array.isArray(pattern) ? pattern : [pattern]).map(str => {
    const negative = str[0] === '!';

    if (negative) {
      str = str.slice(1);
    }

    const absPattern = addDriveLetter(cwd, path.posix.resolve(unixify(cwd), str));

    return negative ? `!${absPattern}` : absPattern;
  });
  let absolutePatterns;

  const events = new EventEmitter();
  const dirs = {};
  const files = new Map();
  const pending = {};
  let state = STATE.STARTING;

  const throttle = (abspath, evname, evarg) => {
    if (state === STATE.CLOSED) {
      return;
    }

    if (!pending[abspath]) {
      // save the first set of arguments
      pending[abspath] = { evname, evarg, priority: evMap[evname] || 0, timer: null };
    }

    if (evMap[evname] > pending[abspath].priority) {
      // this event takes precedence over the queued one
      pending[abspath].evname = evname;
      pending[abspath].evarg = evarg;
      pending[abspath].priority = evMap[evname] || 0;
    }

    if (pending[abspath].timer && pending[abspath].timer !== -1) {
      clearTimeout(pending[abspath].timer);
    }

    pending[abspath].timer = setTimeout(() => {
      if (state === STATE.CLOSED) {
        delete pending[abspath];
        return;
      }

      const { evname, evarg } = pending[abspath];

      if (evname !== 'change') {
        delete pending[abspath];
        return void events.emit(evname, evarg);
      }

      // prevent events queued after the original timeout fired
      // from scheduling another event
      pending[abspath].timer = -1;

      // always check that this file exists on a change event due to a bug
      // in node 12 that fires a delete as a change instead of rename
      // https://github.com/nodejs/node/issues/27869
      stat(abspath).then(stat => {
        if (state === STATE.CLOSED) {
          delete pending[abspath];
          return;
        }

        // it is possible file could have been deleted during the check
        const { evname, evarg } = pending[abspath];
        delete pending[abspath];

        // file no longer exists, should fire unlink
        if (stat === null || evname === 'unlink') {
          return void events.emit('unlink', evarg);
        }

        return void events.emit('change', evarg);
      }).catch(err => {
        error(err, abspath);
      });
    }, 50);
  };

  const error = (err, abspath) => {
    if (state === STATE.CLOSED) {
      return;
    }

    err.path = path.resolve(abspath);

    events.emit('error', err);
  };

  const removeFile = (abspath) => {
    if (files.has(abspath)) {
      files.delete(abspath);
      throttle(abspath, 'unlink', { path: path.resolve(abspath) });
    }
  };

  const removeDir = (abspath) => {
    const watcher = dirs[abspath];

    if (watcher) {
      watcher.close();
      delete dirs[abspath];
      throttle(abspath, 'unlinkDir', { path: path.resolve(abspath) });
    }
  };

  const addFile = (abspath) => {
    if (files.has(abspath)) {
      return;
    }

    files.set(abspath, path.posix.dirname(abspath));

    events.emit('add', { path: path.resolve(abspath) });
  };

  const onDirChange = (abspath) => async (type, name) => {
    // ignore all events before the app has finished starting
    // this is aprticularly an issue on MacOS
    if (type !== EV_DISCOVER && state === STATE.STARTING) {
      return;
    }

    const changepath = `${abspath}/${name}`;

    // this is a file change inside the directory
    if (type !== EV_DISCOVER && files.has(changepath)) {
      throttle(changepath, 'change', { path: path.resolve(changepath) });
      return;
    }

    try {
      const a = hitime();
      const paths = await globdir(abspath, absolutePatterns);
      const b = hitime();
      const [foundFiles, foundDirs] = paths.reduce(([files, dirs], file) => {
        if (/\/$/.test(file)) {
          dirs.push(file.slice(0, -1));
        } else {
          files.push(file);
        }

        return [files, dirs];
      }, [[], []]);
      const c = hitime();

      const one = hitime();
      const existingFiles = [];

      files.forEach((parent, file) => {
        if (parent === abspath) {
          existingFiles.push(file);
        }
      });
      // find only files that exist in this directory
//      const existingFilesKeys = Object.keys(files);
//      const oneA = hitime();
//      const existingFiles = existingFilesKeys.filter(file => files[file] === abspath);
//      const existingFiles = existingFilesKeys.filter(file => path.posix.dirname(file) === abspath);
      const two = hitime();
      // diff returns items in the first array that are not in the second
      diff(existingFiles, foundFiles).forEach(file => removeFile(file));
      const three = hitime();
      diff(foundFiles, existingFiles).forEach(file => addFile(file));
      const four = hitime();

      // now do the same thing for directories
      const existingDirs = Object.keys(dirs)
        .filter(dir => path.posix.dirname(dir) === abspath);
      const five = hitime();
      diff(existingDirs, foundDirs).forEach(dir => removeDir(dir));
      const d = hitime();

      diffOne += two - one;
      diffTwo += three - two;
      diffThree += four - three;
      diffFour += five - four;
      diffFive += d - five;

      globdirTime += b - a;
      globparseTime += c - b;
      globdiffTime += d - c;

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

  const watchDir = (abspath) => {
    if (dirs[abspath]) {
      return;
    }

    const a = hitime();
    dirs[abspath] = fs.watch(abspath, { persistent }, onDirChange(abspath));
    watchTime += hitime() - a;
    dirs[abspath].on('error', (/* err */) => {
      // TODO an EPERM error is fired when the directory is deleted
    });

    // check to see if we already have files in there that were
    // added during the initial glob
    return onDirChange(abspath)(EV_DISCOVER).then(() => {
      events.emit('addDir', { path: path.resolve(abspath) });
    });
  };

  dirGlob(resolvedPatterns, { cwd }).then((p) => {
    absolutePatterns = p;
  }).then(() => {
    const dir = addDriveLetter(cwd, unixify(cwd));
    return watchDir(dir);
  }).then(() => {
    // this is the most annoying part, but it seems that watching does not
    // occur immediately, yet there is no event for whenan fs watcher is
    // actually ready... some of the internal bits use process.nextTick,
    // so we'll wait a very random sad small amount of time here
    return new Promise(r => setTimeout(() => r(), 20));
  }).then(() => {
    state = STATE.READY;
    events.emit('ready');

//    console.log('total sync watch time', Math.round(watchTime), '~4.3s');
//    console.log('> total readdir time', Math.round(readdirTime), '~1.4s');
//    console.log('> total match time', Math.round(matchTime), '~0.5s');
//    console.log('total globdir time', Math.round(globdirTime), '~1.9s');
//    console.log('total globparse time', Math.round(globparseTime), '~0.03s');
//    console.log('total globdiff time', Math.round(globdiffTime), '~26s');
//
//    console.log('diff 1', Math.round(diffOne), '~17s');
//    console.log('diff 1a', Math.round(diffOneA), '~17s');
//    console.log('diff 2', Math.round(diffTwo));
//    console.log('diff 3', Math.round(diffThree));
//    console.log('diff 4', Math.round(diffFour), '~9s');
//    console.log('diff 5', Math.round(diffFive));
  }).catch(err => {
    events.emit('error', err);
  });

  events.close = () => {
    state = STATE.CLOSED;

    files.forEach((val, file) => removeFile(file));

    for (let dir in dirs) {
      removeDir(dir);
    }
  };

  return events;
};
