#!/usr/bin/env node
/**
 * agy-monitor 跨平台一键部署脚本。
 *
 * 功能：
 * 1. 检查运行环境（要求 Node.js >= 18）。
 * 2. 将插件文件同步到 AGY 全局插件目录（~/.gemini/config/plugins/agy-monitor），
 *    避免工作区路径包含中文/空格导致 Windows cmd /c 出现编码或路径解析问题。
 * 3. 可选初始化用户监控配置文件 ~/.gemini/antigravity-cli/agy-monitor.json（支持 --mode / --bar）。
 * 4. 将状态栏命令安全合并写入 ~/.gemini/antigravity-cli/settings.json（自动备份原配置）。
 * 5. 自动通过真实壳层（Windows: cmd /c，Unix: sh -c）端到端验证部署结果并展示预览。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_ROOT = path.resolve(__dirname, '..');

// 安装到全局插件目录时需要复制的核心文件和目录
const COPY_ITEMS = [
  'plugin.json',
  'package.json',
  'config.default.json',
  'README.md',
  'LICENSE',
  'assets',
  'bin',
  'lib',
  'scripts',
  'skills',
  'test',
];

/**
 * 校验当前 Node.js 版本是否满足最低要求（>= 18.0.0）。
 */
function ensureNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(
      `当前 Node.js 版本为 v${process.versions.node}，agy-monitor 需要 Node.js 18 及以上版本（请前往 https://nodejs.org 升级）。`,
    );
  }
}

/**
 * 解析命令行选项。
 * @param {string[]} argv 参数数组
 * @returns {Record<string, any>}
 */
function parseOptions(argv) {
  const opts = {
    dryRun: false,
    skipSettings: false,
    stackWithDefault: false,
    verify: true,
    mode: null,
    barStyle: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-settings') opts.skipSettings = true;
    else if (arg === '--stack-with-default') opts.stackWithDefault = true;
    else if (arg === '--no-verify') opts.verify = false;
    else if (arg === '--mode' && argv[i + 1]) opts.mode = argv[++i];
    else if (arg.startsWith('--mode=')) opts.mode = arg.slice('--mode='.length);
    else if (arg === '--bar' && argv[i + 1]) opts.barStyle = argv[++i];
    else if (arg.startsWith('--bar=')) opts.barStyle = arg.slice('--bar='.length);
  }
  return opts;
}

/**
 * 递归复制文件或目录。
 * @param {string} src 源路径
 * @param {string} dest 目标路径
 */
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * 将脚本路径转换为标准 file:// URL 字符串，支持跨平台单元测试模拟。
 * @param {string} scriptPath 脚本绝对路径
 * @param {string} platform 目标操作系统平台
 * @returns {string}
 */
function toFileUrlString(scriptPath, platform) {
  if (platform === process.platform) {
    return pathToFileURL(scriptPath).href;
  }
  const segments = scriptPath.replace(/\\/g, '/').split('/');
  const encoded = segments
    .map((seg, idx) => (idx === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return `file://${encoded.startsWith('/') ? encoded : `/${encoded}`}`;
}

/**
 * 生成适合当前操作系统的 statusLine.command 字符串。
 *
 * 说明：Windows 下 agy CLI 通过 Go 的 `exec.Command("cmd", "/c", command)` 执行状态栏命令；
 * 当 command 中包含双引号 `"` 时，Go 的参数转义会将其变成 `\"`，导致 Node 收到带字面双引号的模块路径
 * （`Error: Cannot find module '<cwd>\"C:\...\statusline.mjs\"'`）。
 * 因此：
 * - Windows 路径仅含安全 ASCII 字符时，直接输出无引号的 `node C:/.../statusline.mjs`；
 * - Windows 路径含空格、中文或 cmd 特殊字符时，使用无引号且不含 `%`/空格的 `node -e import('file:///...')` 兜底；
 * - Unix / macOS 使用 `sh -c`，无特殊字符直接输出，含特殊字符使用单引号安全包裹。
 *
 * @param {string} scriptPath 已安装后的 statusline.mjs 绝对路径
 * @param {string} [platform=process.platform] 目标操作系统平台
 * @returns {string}
 */
export function buildStatusLineCommand(scriptPath, platform = process.platform) {
  const posixPath = scriptPath.replace(/\\/g, '/');

  if (platform === 'win32') {
    if (/^[A-Za-z0-9:/._-]+$/.test(posixPath)) {
      return `node ${posixPath}`;
    }
    const fileUrl = toFileUrlString(scriptPath, platform);
    const escapedUrl = fileUrl.replace(
      /[^A-Za-z0-9:/._-]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    return `node -e import('${escapedUrl}')`;
  }

  if (/^[A-Za-z0-9/._-]+$/.test(posixPath)) {
    return `node ${posixPath}`;
  }
  const singleQuoted = posixPath.replace(/'/g, "'\\''");
  return `node '${singleQuoted}'`;
}

/**
 * 使用与 agy 一致的真实壳层执行端到端部署验收，确保用户本机立即可用。
 * @param {string} statusLineCommand 已生成的 statusLine 命令
 * @param {string} pluginDestDir 全局插件目录
 */
function verifyDeployment(statusLineCommand, pluginDestDir) {
  const fixturePath = path.join(pluginDestDir, 'test', 'fixtures', 'standard-multi-model.json');
  const samplePayload = fs.existsSync(fixturePath)
    ? fs.readFileSync(fixturePath, 'utf8')
    : JSON.stringify({
        cwd: os.homedir(),
        model: { display_name: 'Gemini 4 Neon (XHigh)', effort: 'xhigh' },
        context_window: { context_window_size: 1048576, used_percentage: 14.2 },
        cycle_mode: 'auto',
        plan_tier: 'Pro',
        terminal_width: 120,
      });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-monitor-verify-'));
  const shellBin = process.platform === 'win32' ? 'cmd.exe' : 'sh';
  const shellFlag = process.platform === 'win32' ? '/c' : '-c';
  const start = Date.now();

  try {
    const output = execFileSync(shellBin, [shellFlag, statusLineCommand], {
      input: samplePayload,
      encoding: 'utf8',
      timeout: 4500,
      env: {
        ...process.env,
        AGY_MONITOR_SNAPSHOT: path.join(tempDir, 'snapshot.json'),
        AGY_MONITOR_TELEMETRY: path.join(tempDir, 'telemetry.json'),
        AGY_MONITOR_GIT_CACHE: path.join(tempDir, 'git-cache.json'),
      },
    }).trimEnd();
    const elapsedMs = Date.now() - start;
    console.log(`[4/4] 端到端壳层自检通过 (${shellBin} ${shellFlag}, ${elapsedMs} ms)！效果预览：`);
    console.log('────────────────────────────────────────────────────────────────────────');
    console.log(output);
    console.log('────────────────────────────────────────────────────────────────────────');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  ensureNodeVersion();

  const opts = parseOptions(process.argv.slice(2));
  const homeDir = os.homedir();
  const pluginDestDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'agy-monitor');
  const cliConfigDir = path.join(homeDir, '.gemini', 'antigravity-cli');
  const settingsPath = path.join(cliConfigDir, 'settings.json');
  const userMonitorConfigPath = path.join(cliConfigDir, 'agy-monitor.json');
  const installedStatuslinePath = path.join(pluginDestDir, 'bin', 'statusline.mjs');
  const statusLineCommand = buildStatusLineCommand(installedStatuslinePath);

  console.log('=== 一键部署 agy-monitor 插件 ===');
  console.log(`Node.js 版本  : v${process.versions.node}`);
  console.log(`源码目录      : ${SOURCE_ROOT}`);
  console.log(`全局插件目录  : ${pluginDestDir}`);
  console.log(`statusLine命令: ${statusLineCommand}`);

  if (opts.dryRun) {
    console.log('\n[--dry-run 预演模式] 不会修改任何文件。');
    console.log(`计划写入配置  : ${settingsPath}`);
    return;
  }

  // 1. 同步插件到 ~/.gemini/config/plugins/agy-monitor
  fs.mkdirSync(pluginDestDir, { recursive: true });
  for (const item of COPY_ITEMS) {
    const srcPath = path.join(SOURCE_ROOT, item);
    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, path.join(pluginDestDir, item));
    }
  }
  console.log('[1/4] 已同步插件文件到全局插件目录。');

  // 2. 如指定了 --mode 或 --bar，写入用户监控配置
  if (opts.mode || opts.barStyle) {
    fs.mkdirSync(cliConfigDir, { recursive: true });
    let existingUserCfg = {};
    if (fs.existsSync(userMonitorConfigPath)) {
      try {
        existingUserCfg = JSON.parse(fs.readFileSync(userMonitorConfigPath, 'utf8'));
      } catch {
        existingUserCfg = {};
      }
    }
    if (opts.mode) existingUserCfg.mode = opts.mode;
    if (opts.barStyle) existingUserCfg.barStyle = opts.barStyle;
    fs.writeFileSync(userMonitorConfigPath, `${JSON.stringify(existingUserCfg, null, 2)}\n`, 'utf8');
    console.log(`[2/4] 已更新个性偏好配置（${userMonitorConfigPath}）。`);
  } else {
    console.log('[2/4] 保留默认两行紧凑仪表盘配置（后续可随时切换模式与样式）。');
  }

  // 3. 安全合并更新 settings.json
  if (opts.skipSettings) {
    console.log('[3/4] 已按 --skip-settings 跳过 settings.json 修改。');
    console.log('\n你可在 agy 终端中执行以下斜杠命令手动启用状态栏：');
    console.log(`  /statusline ${statusLineCommand}`);
  } else {
    fs.mkdirSync(cliConfigDir, { recursive: true });
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const rawSettings = fs.readFileSync(settingsPath, 'utf8');
      if (rawSettings.trim()) {
        settings = JSON.parse(rawSettings);
      }
      // 备份原 settings.json
      const backupPath = `${settingsPath}.bak.${Date.now()}`;
      fs.writeFileSync(backupPath, rawSettings, 'utf8');
      console.log(`      已自动备份原 settings.json 至：${backupPath}`);
    }

    settings.statusLine = {
      type: 'command',
      command: statusLineCommand,
      enabled: true,
      padding: 0,
      stack_with_default: Boolean(opts.stackWithDefault),
    };

    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    console.log(`[3/4] 已写入 statusLine 配置到：${settingsPath}`);
  }

  // 4. 端到端真实壳层自检
  if (opts.verify) {
    verifyDeployment(statusLineCommand, pluginDestDir);
  } else {
    console.log('[4/4] 已按 --no-verify 跳过端到端自检。');
  }

  console.log('\n部署完成！启动或重启 agy（或在 agy 中输入 /statusline on）即可在底部看到实时监控状态栏。');
}

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  try {
    main();
  } catch (err) {
    console.error(`\n部署失败：${err.message}`);
    process.exitCode = 1;
  }
}
