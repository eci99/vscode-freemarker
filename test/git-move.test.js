const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stageMovedTemplates } = require('../git-move');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freemarker-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const move = async (from, to) => {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    fs.renameSync(path.join(root, from), path.join(root, to));
    await stageMovedTemplates([{ oldPath: path.join(root, from), newPath: path.join(root, to) }]);
  };
  const status = () => git('status', '--porcelain').split('\n').filter(Boolean).sort();
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write('pages/main.ftl', '<#include "../lib/a.ftl">\n');
    write('lib/a.ftl', 'a\n');
    write('lib/b.ftl', 'b\n');
    write('lib/notes.txt', 'notes\n');
    git('add', '.');
    git('commit', '-q', '-m', 'initial');

    // A renamed template is a rename in git; a change that was not staged stays unstaged.
    write('pages/main.ftl', '<#include "../lib/a.ftl">\nchanged\n');
    await move('pages/main.ftl', 'pages/index.ftl');
    assert.deepStrictEqual(status(), ['RM pages/main.ftl -> pages/index.ftl']);
    git('commit', '-q', '-a', '-m', 'rename');

    // A moved folder takes its tracked templates along; other files are left to the user.
    await move('lib', 'shared/lib');
    assert.deepStrictEqual(status(), [
      ' D lib/notes.txt',
      '?? shared/lib/notes.txt',
      'R  lib/a.ftl -> shared/lib/a.ftl',
      'R  lib/b.ftl -> shared/lib/b.ftl'
    ]);
    git('add', '-A');
    git('commit', '-q', '-m', 'move');

    // A template that git does not track stays untracked.
    write('new.ftl', 'new\n');
    await move('new.ftl', 'renamed.ftl');
    assert.deepStrictEqual(status(), ['?? renamed.ftl']);

    // Outside of a repository nothing happens.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'freemarker-nogit-'));
    fs.writeFileSync(path.join(outside, 'a.ftl'), 'a');
    fs.renameSync(path.join(outside, 'a.ftl'), path.join(outside, 'b.ftl'));
    await stageMovedTemplates([{ oldPath: path.join(outside, 'a.ftl'), newPath: path.join(outside, 'b.ftl') }]);
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Git move tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
