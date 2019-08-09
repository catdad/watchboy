const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');
const diff = require('lodash.difference');
const unixify = require('unixify');
const dirGlob = require('dir-glob');
const micromatch = require('micromatch');

//const readdirP = async (...args) => {
//  return await new Promise((r, j) => fs.readdir(...args, (err, res) => err ? j(err) : r(res)));
//};

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

const readdir = async (dir, patterns) => {
  const run = async () => {
    const entries = await globby('*', {
      cwd: dir,
      deep: 1,
      onlyFiles: false,
      markDirectories: true,
      absolute: true
    });

    const matches = entries.filter((e) => isMatch(e, patterns) || isParent(e, patterns));

    return matches;
  };

  if (fs.Dirent) {
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

  return readdir(dir, patterns);
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
  const files = {};
  const pending = {};
  let closed = false;

  const throttle = (abspath, evname, evarg) => {
    if (closed) {
      return;
    }

    if (!pending[abspath]) {
      pending[abspath] = {};
    }

    if (pending[abspath].timer) {
      clearTimeout(pending[abspath].timer);
    } else {
      // save only the first set of arguments
      pending[abspath].data = { evname, evarg };
      pending[abspath].priority = evMap[evname] || 0;
    }

    if (evMap[evname] > pending[abspath].priority) {
      // this event takes precedence over the queued one
      pending[abspath].data = { evname, evarg };
      pending[abspath].priority = evMap[evname] || 0;
    }

    pending[abspath].timer = setTimeout(() => {
      const { evname, evarg } = pending[abspath].data;

      if (evname !== 'change') {
        delete pending[abspath];
        return void events.emit(evname, evarg);
      }

      // always check that this file exists on a change event due to a bug
      // in node 12 that fires a delete as a change instead of rename
      // https://github.com/nodejs/node/issues/27869
      exists(abspath).then(yes => {
        // it is possible file could have been deleted during the check
        const { evname, evarg } = pending[abspath].data;
        delete pending[abspath];

        events.emit(yes ? evname : 'unlink', evarg);
      }).catch(err => {
        error(err, abspath);
      });
    }, 50);
  };

  const error = (err, abspath) => {
    if (closed) {
      return;
    }

    err.path = path.resolve(abspath);

    events.emit('error', err);
  };

  const removeFile = (abspath) => {
    const watcher = files[abspath];

    if (watcher) {
      watcher.close();
      delete files[abspath];
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

  const onFileChange = (abspath) => () => {
    throttle(abspath, 'change', { path: path.resolve(abspath) });
  };

  const onDirChange = (abspath) => async () => {
    try {
      const paths = await readdir(abspath, absolutePatterns);
      const [foundFiles, foundDirs] = paths.reduce(([files, dirs], file) => {
        if (/\/$/.test(file)) {
          dirs.push(file.slice(0, -1));
        } else {
          files.push(file);
        }

        return [files, dirs];
      }, [[], []]);

      // find only files that exist in this directory
      const existingFiles = Object.keys(files)
        .filter(file => path.posix.dirname(file) === abspath);
      // diff returns items in the first array that are not in the second
      diff(existingFiles, foundFiles).forEach(file => removeFile(file));
      diff(foundFiles, existingFiles).forEach(file => watchFile(file));

      // now do the same thing for directories
      const existingDirs = Object.keys(dirs)
        .filter(dir => path.posix.dirname(dir) === abspath);

      diff(existingDirs, foundDirs).forEach(dir => removeDir(dir));

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

  const watch = (file, func) => fs.watch(file, { persistent }, func);

  const watchFile = (abspath) => {
    if (files[abspath]) {
      return;
    }

    files[abspath] = watch(abspath, onFileChange(abspath));
    files[abspath].on('error', (/* err */) => {
      // TODO what happens with this error?
    });

    events.emit('add', { path: path.resolve(abspath) });
  };

  const watchDir = (abspath) => {
    if (dirs[abspath]) {
      return;
    }

    dirs[abspath] = watch(abspath, onDirChange(abspath));
    dirs[abspath].on('error', (/* err */) => {
      // TODO an EPERM error is fired when the directory is deleted
    });

    // check to see if we already have files in there that were
    // added during the initial glob
    return onDirChange(abspath)().then(() => {
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
    events.emit('ready');
  }).catch(err => {
    events.emit('error', err);
  });

  events.close = () => {
    closed = true;

    for (let file in files) {
      removeFile(file);
    }

    for (let dir in dirs) {
      removeDir(dir);
    }
  };

  return events;
};
