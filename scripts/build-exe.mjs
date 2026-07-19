/**
 * Builds a standalone Windows executable.
 *
 * The whole client (dist/) is embedded into the binary as base64, so the .exe
 * has no files beside it — double-click, the server starts and a browser opens.
 *
 *   1. vite build            -> dist/
 *   2. this script           -> build/embedded-assets.cjs (client as base64)
 *                            -> build/gloworm.cjs         (bundled server)
 *   3. @yao-pkg/pkg          -> release/gloworm-windows-x64.exe
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const buildDir = join(root, 'build');
const releaseDir = join(root, 'release');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function collect(dir, into = {}) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, into);
    } else {
      const key = '/' + posix.join(...relative(distDir, full).split(/[\\/]/));
      into[key] = {
        type: MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
        body: readFileSync(full).toString('base64'),
      };
    }
  }
  return into;
}

console.log('> collecting client assets from dist/');
let assets;
try {
  assets = collect(distDir);
} catch {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}
const totalKb = Object.values(assets).reduce((n, a) => n + a.body.length, 0) / 1024;
console.log(`  ${Object.keys(assets).length} files, ${totalKb.toFixed(0)} KB base64`);

mkdirSync(buildDir, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

// Two modules on purpose: ESM evaluates imports in source order, so the
// globals are guaranteed to be in place before server.ts runs. Doing it in one
// file would need a top-level await, which the CJS output format forbids.
writeFileSync(
  join(buildDir, 'globals.mjs'),
  `import { exec } from 'node:child_process';
import { networkInterfaces } from 'node:os';

globalThis.__GLOWORM_ASSETS__ = ${JSON.stringify(assets)};

globalThis.__GLOWORM_ON_LISTENING__ = (port) => {
  const url = 'http://localhost:' + port;
  let lan = null;
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) { lan = net.address; break; }
    }
  }
  console.log('');
  console.log('  GLOWORM — Neon Arena');
  console.log('  ---------------------------------------------');
  console.log('  Playing at:  ' + url);
  if (lan) console.log('  On your LAN: http://' + lan + ':' + port + '   (share this)');
  console.log('');
  console.log('  Close this window to stop the server.');
  console.log('');
  // Open the default browser without blocking, and without a shell injection
  // surface (the URL is built from a numeric port).
  if (process.platform === 'win32') exec('start "" ' + url);
  else if (process.platform === 'darwin') exec('open ' + url);
  else exec('xdg-open ' + url);
};
`,
);

writeFileSync(
  join(buildDir, 'entry.mjs'),
  `import './globals.mjs';
import '../server.ts';
`,
);

console.log('> bundling server');
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(buildDir, 'entry.mjs'),
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    '--legal-comments=none',
    '--external:bufferutil',
    '--external:utf-8-validate',
    '--external:vite',
    `--define:import.meta.url="file:///gloworm"`,
    `--outfile=${join(buildDir, 'gloworm.cjs')}`,
  ],
  { stdio: 'inherit', cwd: root },
);

const bundleKb = statSync(join(buildDir, 'gloworm.cjs')).size / 1024;
console.log(`  bundle ${bundleKb.toFixed(0)} KB`);

// Node's built-in Single Executable Application support: it injects the bundle
// into a copy of the local node binary. No toolchain, no cross-compilation.
console.log('> preparing SEA blob');
writeFileSync(
  join(buildDir, 'sea-config.json'),
  JSON.stringify(
    {
      main: join(buildDir, 'gloworm.cjs'),
      output: join(buildDir, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ['--experimental-sea-config', join(buildDir, 'sea-config.json')], {
  stdio: 'inherit',
  cwd: root,
});

const exePath = join(releaseDir, 'gloworm-windows-x64.exe');
console.log('> injecting into a copy of the Node runtime');
copyFileSync(process.execPath, exePath);
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
    exePath,
    'NODE_SEA_BLOB',
    join(buildDir, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit', cwd: root },
);

const exeMb = statSync(join(releaseDir, 'gloworm-windows-x64.exe')).size / 1024 / 1024;
console.log(`\nDone: release/gloworm-windows-x64.exe (${exeMb.toFixed(1)} MB)`);
rmSync(join(buildDir, 'entry.mjs'), { force: true });
rmSync(join(buildDir, 'globals.mjs'), { force: true });
