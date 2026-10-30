import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'waylovoice-pack-'));
const app = path.join(temp, 'example');

function pnpm(args, cwd) {
  execFileSync('pnpm', args, { cwd, stdio: 'inherit' });
}

try {
  pnpm(['pack:client', '--pack-destination', temp], root);
  const tarball = (await readdir(temp)).find(name => name.endsWith('.tgz'));

  for (const entry of ['src', 'tsconfig.json', 'package.json']) {
    await cp(path.join(root, 'example', entry), path.join(app, entry), { recursive: true });
  }

  await cp(path.join(root, 'tsconfig.base.json'), path.join(temp, 'tsconfig.base.json'));

  const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));

  manifest.dependencies['@waylovoice/client'] = `file:../${tarball}`;
  await writeFile(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2));

  // Same overrides and build settings; its package globs match nothing in the copy.
  await cp(path.join(root, 'pnpm-workspace.yaml'), path.join(app, 'pnpm-workspace.yaml'));

  pnpm(['install', '--no-frozen-lockfile', '--prefer-offline'], app);
  pnpm(['typecheck'], app);
  pnpm(['build'], app);
} finally {
  await rm(temp, { recursive: true, force: true });
}
