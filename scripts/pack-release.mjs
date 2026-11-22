#!/usr/bin/env node
/**
 * agy-monitor 一键打包分发脚本。
 *
 * 功能：
 * 1. 自动收集项目分发所需的全部核心文件（排除 .git、dist、node_modules 与临时文件）。
 * 2. 自动规范化脚本换行符（*.sh 为 LF，*.bat / *.ps1 为 CRLF），确保发给 Windows / macOS / Linux 用户均零报错。
 * 3. 打包输出为 dist/agy-monitor-v<version>.zip（压缩包内含顶层 agy-monitor/ 目录），可直接发给他人解压一键部署。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 分发包白名单（只打包干净的发布文件）
const RELEASE_ITEMS = [
  'install.bat',
  'uninstall.bat',
  'install.sh',
  'uninstall.sh',
  'README.md',
  'LICENSE',
  'package.json',
  'plugin.json',
  'config.default.json',
  '.gitignore',
  '.gitattributes',
  'assets',
  'bin',
  'lib',
  'scripts',
  'skills',
  'test',
];

/**
 * 递归复制文件并按扩展名规范跨平台脚本换行符。
 * @param {string} src 源路径
 * @param {string} dest 目标路径
 */
function copyWithEolFix(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === '.DS_Store' || entry === 'Thumbs.db') continue;
      copyWithEolFix(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ext = path.extname(src).toLowerCase();

  if (ext === '.sh') {
    const lfText = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(dest, lfText, 'utf8');
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      // Windows 忽略 chmod
    }
  } else if (ext === '.bat' || ext === '.ps1') {
    const crlfText = fs.readFileSync(src, 'utf8').replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(dest, crlfText, 'utf8');
  } else {
    fs.copyFileSync(src, dest);
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.0';
  const distDir = path.join(PROJECT_ROOT, 'dist');
  const zipName = `agy-monitor-v${version}.zip`;
  const zipPath = path.join(distDir, zipName);

  const stageParent = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-monitor-release-'));
  const stageRoot = path.join(stageParent, 'agy-monitor');

  try {
    fs.mkdirSync(stageRoot, { recursive: true });
    for (const item of RELEASE_ITEMS) {
      const src = path.join(PROJECT_ROOT, item);
      if (fs.existsSync(src)) {
        copyWithEolFix(src, path.join(stageRoot, item));
      }
    }

    fs.mkdirSync(distDir, { recursive: true });
    if (fs.existsSync(zipPath)) {
      fs.rmSync(zipPath, { force: true });
    }

    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${stageRoot.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: 'inherit' },
      );
    } else {
      execFileSync('zip', ['-r', '-q', zipPath, 'agy-monitor'], {
        cwd: stageParent,
        stdio: 'inherit',
      });
    }

    const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
    console.log('=== 打包分发完成 ===');
    console.log(`输出压缩包 : ${zipPath} (${sizeKb} KB)`);
    console.log('接收方使用 : 解压后双击 install.bat（Windows）或运行 bash install.sh（macOS/Linux）即可一键部署。');
  } finally {
    fs.rmSync(stageParent, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(`打包失败：${err.message}`);
  process.exitCode = 1;
}
