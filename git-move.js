const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const isTemplate = (file) => /\.(?:ftl|ftlh|ftlx)$/i.test(file);

function git(args, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

// Records moved templates in the git index like `git mv`, after they were moved on disk:
// the index entry moves to the new path, so git shows a rename and changes that were not
// staged stay unstaged. Templates that git does not track, and moves out of the repository,
// are left alone. `moves` are { oldPath, newPath } of files or folders.
async function stageMovedTemplates(moves) {
  for (const { oldPath, newPath } of moves) {
    let directory;
    try {
      directory = fs.statSync(newPath).isDirectory() ? newPath : path.dirname(newPath);
    } catch {
      continue;
    }
    let root;
    try {
      root = fs.realpathSync((await git(['rev-parse', '--show-toplevel'], directory)).trim());
    } catch {
      continue;
    }
    const relativeTo = (file) => {
      const resolved = path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
      return path.relative(root, resolved).split(path.sep).join('/');
    };
    let oldRelative;
    let newRelative;
    try {
      newRelative = relativeTo(newPath);
      // The old folder is gone; its parent is still there unless it moved too.
      oldRelative = relativeTo(oldPath);
    } catch {
      continue;
    }
    if (!oldRelative || !newRelative || [oldRelative, newRelative].some((file) => file.startsWith('../') || path.isAbsolute(file))) continue;

    const listing = await git(['ls-files', '-s', '-z', '--', oldRelative], root);
    const entries = listing.split('\0').filter(Boolean).map((line) => {
      const [info, file] = line.split('\t');
      const [mode, object, stage] = info.split(' ');
      return { mode, object, stage, file };
    }).filter(({ stage, file }) => stage === '0' && isTemplate(file)
      && (file === oldRelative || file.startsWith(`${oldRelative}/`)));
    if (!entries.length) continue;

    const lines = entries.flatMap(({ mode, object, file }) => [
      `0 ${'0'.repeat(object.length)}\t${file}`,
      `${mode} ${object}\t${newRelative}${file.slice(oldRelative.length)}`
    ]);
    await git(['update-index', '--index-info'], root, `${lines.join('\n')}\n`);
  }
}

module.exports = { stageMovedTemplates };
