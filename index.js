const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const diff = require('lodash.difference');
const unixify = require('unixify');
const micromatch = require('micromatch');
const pify = require('pify');

const isDarwin = process.platform === 'darwin';

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
  });
};

const isMatch = (input, patterns) => {
  let result = false;

  for (let p of patterns) {
    const isPositive = p[0] !== '!';
    const isMatch = micromatch.isMatch(input, p);

    if (isMatch && isPositive) {
      result = true;
    } else if (!isMatch && !isPositive) {
      result = false;
    }
  }

  return result;
};

const isParent = (input, patterns) => {
  for (let p of patterns) {
    if (p.indexOf(input) === 0) {
      return true;
    }
  }

  return false;
};

const shouldWatch = (input, patterns) => {
  return isMatch(input, patterns) || isParent(input, patterns);
};

const globdir = async (dir, patterns) => {
  const run = async () => {
    const entries = await readdir(dir);
    const matches = entries.filter((e) => shouldWatch(e, patterns));

    return matches;
  };

  if (fs.Dirent && !isDarwin) {
    return await run();
  }

  // node 8 has this nasty habbit of returning 0 entries on a readdir
  // directly after a change even when there are entries, so we need
  // to confirm that two runs read the same amount of entries
  const one = await run();

  if (one.length) {
    return one;
  }

  return await run();
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

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  let lastMtimeMs = Date.now();

  // support passing relative paths and '.'
  cwd = path.resolve(cwd);

  const unixifyAbs = str => {
    const relDrive = (str.match(/^([a-z]:)\\/i) || [])[1];
    const drive = relDrive || (cwd.match(/^([a-z]:)\\/i) || [])[1];
    const unix = unixify(path.resolve(cwd, str));
    return drive ? `${drive}${unix}` : unix;
  };

  const events = new EventEmitter();
  const dirs = new Map();
  const files = new Map();
  const pending = {};
  let state = STATE.STARTING;
  let absolutePatterns;

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

    const ref = pending[abspath];

    pending[abspath].timer = setTimeout(() => {
      if (state === STATE.CLOSED) {
        delete pending[abspath];
        return;
      }

      const { evname, evarg } = ref;

      if (evname !== 'change') {
        delete pending[abspath];
        return void events.emit(evname, evarg);
      }

      // prevent events queued after the original timeout fired
      // from scheduling another event
      if (ref.timer) {
        clearTimeout(ref.timer);
        ref.timer = -1;
      }
      if (pending[abspath]) {
        pending[abspath].timer = -1;
      }

      // always check that this file exists on a change event due to a bug
      // in node 12 that fires a delete as a change instead of rename
      // https://github.com/nodejs/node/issues/27869
      stat(abspath).then(stat => {
        if (state === STATE.CLOSED) {
          delete pending[abspath];
          return;
        }

        // it is possible file could have been deleted during the check
        const { evname, evarg } = ref;
        delete pending[abspath];

        // file no longer exists, should fire unlink
        if (stat === null || evname === 'unlink') {
          return void events.emit('unlink', evarg);
        }

        // MacOS does not have accurate mtime values, so always fire a change
        if (lastMtimeMs <= stat.mtimeMs || isDarwin) {
          events.emit('change', evarg);
        }

        lastMtimeMs = Math.max(stat.mtimeMs, lastMtimeMs);
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
    const watcher = dirs.get(abspath);

    if (watcher) {
      watcher.close();
      dirs.delete(abspath);
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

    const changepath = name ? `${abspath}/${unixify(name)}` : abspath;

    // this is a change for a known file, let throttle handle it
    if (type !== EV_DISCOVER && files.has(changepath)) {
      throttle(changepath, 'change', { path: path.resolve(changepath) });
      return;
    }

    const stats = await stat(changepath);

    // this is a known directory that no longer exists, remove it
    if (!stats && dirs.has(changepath)) {
      return removeDir(changepath);
    }

    // this is a new directory being discovered, so add it and move on
    if (stats && stats.isDirectory() && !dirs.has(changepath)) {
      return watchDir(changepath);
    }

    if (!stats) {
      // this can happen on Linux when a folder itself is changed
      // that is okay, because in those cases, we have a parent watcher
      // which will handle the change, so we can ignore it
      return;
    }

    const globpath = stats.isDirectory() ? changepath : path.posix.dirname(changepath);

    try {
      const paths = await globdir(globpath, absolutePatterns);
      const [foundFiles, foundDirs] = paths.reduce(([files, dirs], file) => {
        if (file.slice(-1) === '/') {
          dirs.push(file.slice(0, -1));
        } else {
          files.push(file);
        }

        return [files, dirs];
      }, [[], []]);

      // find only files that exist in this directory
      const existingFiles = [];

      files.forEach((parent, file) => {
        if (parent === globpath) {
          existingFiles.push(file);
        }
      });

      // diff returns items in the first array that are not in the second
      for (let file of diff(existingFiles, foundFiles)) removeFile(file);
      for (let file of diff(foundFiles, existingFiles)) addFile(file);

      // now do the same thing for directories
      const existingDirs = [];
      dirs.forEach((value, dir) => {
        if (value.parent === globpath) {
          existingDirs.push(dir);
        }
      });

      for (let dir of diff(existingDirs, foundDirs)) removeDir(dir);
      // TODO should we do these in parallel?
      for (let dir of diff(foundDirs, existingDirs)) await watchDir(dir);
    } catch (err) {
      // TODO I think this should use changepath or globpath
      try {
        if (await exists(globpath)) {
          error(err, globpath);
        }
      } catch (e) {
        if (dirs.has(globpath)) {
          error(err, globpath);
        }
      }
    }
  };

  const watchDir = (abspath, { isRoot = false } = {}) => {
    if (dirs.has(abspath)) {
      return;
    }

    if (!shouldWatch(abspath, absolutePatterns)) {
      return;
    }

    const recursive = ['win32', 'darwin'].includes(process.platform);
    const onChange = onDirChange(abspath, recursive);

    if (recursive === true && isRoot === false) {
      dirs.set(abspath, {
        close: () => {},
        parent: path.posix.dirname(abspath),
        placeholder: true
      });
    } else {
      const watcher = fs.watch(abspath, { persistent, recursive }, onChange);
      watcher.parent = path.posix.dirname(abspath);
      watcher.on('error', (/* err */) => {
        // TODO an EPERM error is fired when the directory is deleted
      });

      dirs.set(abspath, watcher);
    }

    // check to see if we already have files in there that were
    // added during the initial glob
    return onChange(EV_DISCOVER).then(() => {
      events.emit('addDir', { path: path.resolve(abspath) });
    });
  };

  Promise.resolve().then(async () => {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    absolutePatterns = [];

    for (let str of patterns) {
      const negative = str[0] === '!';

      if (negative) {
        str = str.slice(1);
      }

      let result = unixifyAbs(path.resolve(cwd, str));

      absolutePatterns.push(negative ? `!${result}` : result);
    }
  }).then(() => {
    const dir = unixifyAbs(cwd);
    return watchDir(dir, { isRoot: true });
  }).then(() => {
    // turns out time is linear (as least as we understand it now)
    // so we can keep track of a single mtimeMs to compare updates to
    lastMtimeMs = Date.now();

    // this is the most annoying part, but it seems that watching does not
    // occur immediately, yet there is no event for whenan fs watcher is
    // actually ready... some of the internal bits use process.nextTick,
    // so we'll wait a very random sad small amount of time here
    return new Promise(r => setTimeout(() => r(), 20));
  }).then(() => {
    state = STATE.READY;
    events.emit('ready');
  }).catch(err => {
    events.emit('error', err);
  });

  events.close = () => {
    state = STATE.CLOSED;

    files.forEach((val, file) => removeFile(file));
    dirs.forEach((val, dir) => removeDir(dir));
  };

  return events;
};
