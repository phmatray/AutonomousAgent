#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

function isInstalled() {
  const result = spawnSync('cargo', ['llvm-cov', '--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

const shouldInstall = process.argv.includes('--install');

if (isInstalled()) {
  process.exit(0);
}

if (!shouldInstall) {
  console.error('cargo-llvm-cov is not installed.');
  console.error('Install it with: cargo install cargo-llvm-cov');
  console.error('Or run: npm run coverage:rust:setup');
  process.exit(1);
}

const installResult = run('cargo', ['install', 'cargo-llvm-cov']);
process.exit(installResult.status ?? 1);
