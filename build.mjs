import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/editor', { recursive: true });

const common = { bundle: true, logLevel: 'warning', sourcemap: false };

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/server/cli.ts'],
    outfile: 'dist/cli.js',
    platform: 'node',
    format: 'esm',
    target: 'node20',
  }),
  build({
    ...common,
    entryPoints: ['src/agent/index.ts'],
    outfile: 'dist/agent.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
  }),
  build({
    ...common,
    entryPoints: ['src/editor/main.tsx'],
    outfile: 'dist/editor/main.js',
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
]);

fs.copyFileSync('src/editor/index.html', 'dist/editor/index.html');
fs.copyFileSync('src/editor/styles.css', 'dist/editor/styles.css');
fs.chmodSync('dist/cli.js', 0o755);
console.log('built dist/');
