/* eslint-env mocha */
describe('watchboy', () => {
  it('start watching expected files and directories');

  it('emits "ready" when all initial files are found');

  it('emits "add" when a new file is added');

  it('emits "addDir" when a new directory is added');

  it('emits "change" when a file changes');

  it('emits "unlink" when a watched file is deleted');

  it('emits "unlinkDir" when a watched directory is deleted');

  it('emits "add" when a new file is created inside a watched directory');

  it('emits "addDir" when a new directory is created inside a watched directory');
});
