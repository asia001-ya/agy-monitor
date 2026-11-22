#!/usr/bin/env node
/**
 * agy-monitor 管理与诊断命令行工具。
 * 支持：preview（模拟预览）、inspect（查看最新实时快照）、mode（切换显示模式）、
 *       config（查看/修改配置）、doctor（环境与耗时自检）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  getDataDir,
  getPluginRoot,
  getSnapshotPath,
  getUserConfigPath,
  loadConfig,
  saveUserConfigPatch,
} from '../lib/config.mjs';
import { parseStatusPayload } from '../lib/parser.mjs';
import { renderStatusLine } from '../lib/renderer.mjs';
import { readSnapshot } from '../lib/snapshot.mjs';
import {
  createStyler,
  formatDuration,
  formatLocalResetClock,
  formatPercent,
  formatTokenRate,
  formatTokens,
} from '../lib/formatter.mjs';
import { resolveTokenTelemetry } from '../lib/telemetry.mjs';

const VALID_MODES = ['compact', 'minimal', 'detailed'];

const FIXTURE_MAP = {
  standard: 'standard-multi-model.json',
  nested: 'nested-third-party.json',
  critical: 'critical-usage.json',
  startup: 'minimal-startup.json',
};

/**
 * 解析命令行选项参数。
 * @param {string[]} args 原始参数数组
 * @returns {{ flags: Record<string, any>, positional: string[] }}
 */
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/**
 * 打印帮助信息。
 */
function printHelp() {
  console.log(`agy-monitor — Antigravity CLI (agy) 用量、上下文与项目监控插件

用法:
  node bin/agy-monitor.mjs <命令> [选项]

常用命令:
  preview   模拟渲染状态栏效果
            选项: --mode <compact|minimal|detailed>  --width <列数>
                  --fixture <standard|nested|critical|startup|snapshot>
                  --bar <square|para|vbar|seg|half|line|dots|unicode|ascii>
                  --quota-display <remaining|used>  --no-color

  inspect   查看最近一次 agy 推送的实时监控快照详情
            选项: --raw（输出原始 JSON）  --json（输出归一化 JSON）

  mode      切换状态栏默认排版模式: compact（两行紧凑）| minimal（单行极简）| detailed（多行详细）
            示例: node bin/agy-monitor.mjs mode detailed

  config    查看当前生效配置，或以 key=value 形式修改用户配置
            示例: node bin/agy-monitor.mjs config quotaDisplay=used barStyle=para
            支持键: mode, quotaDisplay, color, colorProfile, barStyle, showResetTime,
                    showExactResetClock, showVcs, showSubPath, showPlanTier, showTokenUsage,
                    showTokenSpeed, showCost, showDisabledQuotas

  doctor    检查本机 Node / agy / 配置文件 / 状态栏脚本渲染耗时

  help      显示此帮助信息`);
}

/**
 * 加载预览用的测试夹具或实时快照 payload。
 * @param {string} fixtureName 夹具名称
 * @returns {Record<string, any>}
 */
function loadPreviewPayload(fixtureName) {
  if (fixtureName === 'snapshot') {
    const snap = readSnapshot();
    if (!snap?.raw) {
      throw new Error(`尚未找到实时快照文件（${getSnapshotPath()}），请先在 agy 中启用状态栏后再试。`);
    }
    return snap.raw;
  }

  const fileName = FIXTURE_MAP[fixtureName] || FIXTURE_MAP.standard;
  const fixturePath = path.join(getPluginRoot(), 'test', 'fixtures', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

/**
 * preview 子命令：直观预览不同模式和终端宽度下的渲染效果。
 * @param {Record<string, any>} flags 命令行选项
 */
function cmdPreview(flags) {
  const fixtureName = String(flags.fixture || 'standard');
  const payload = loadPreviewPayload(fixtureName);

  if (flags.width) {
    const w = Number(flags.width);
    if (Number.isFinite(w) && w >= 30) {
      payload.terminal_width = w;
    }
  }

  const overrides = {};
  if (flags.mode) overrides.mode = String(flags.mode);
  if (flags.bar) overrides.barStyle = String(flags.bar);
  if (flags['quota-display']) overrides.quotaDisplay = String(flags['quota-display']);
  if (flags['no-color']) overrides.color = false;

  const config = loadConfig(overrides);
  const parsed = parseStatusPayload(payload, config);
  parsed.telemetry = resolveTokenTelemetry(payload, parsed, { ...config, telemetry: { enabled: false } });
  const output = renderStatusLine(parsed, config);

  const width = parsed.terminalWidth;
  const divider = '─'.repeat(Math.min(width, 96));
  console.log(`模式: ${config.mode} | 场景: ${fixtureName} | 终端宽度: ${width} 列 | 配额口径: ${config.quotaDisplay}`);
  console.log(divider);
  console.log(output);
  console.log(divider);
}

/**
 * inspect 子命令：读取并格式化展示最近一次 agy 实时快照。
 * @param {Record<string, any>} flags 命令行选项
 */
function cmdInspect(flags) {
  const snapshotPath = getSnapshotPath();
  const snap = readSnapshot();

  if (!snap) {
    console.log(`暂未检测到实时快照：${snapshotPath}`);
    console.log('提示：请先启用 agy-monitor 状态栏并在 agy 中触发一次交互，快照会自动生成。');
    console.log('你也可以先运行 `node bin/agy-monitor.mjs preview` 查看模拟渲染效果。');
    return;
  }

  if (flags.raw) {
    console.log(JSON.stringify(snap.raw, null, 2));
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify(snap.parsed, null, 2));
    return;
  }

  const config = loadConfig();
  const styler = createStyler(config.color, config.colorProfile || 'truecolor');
  const data = parseStatusPayload(snap.raw, config);

  console.log(styler.boldCyan('=== AGY 实时监控快照 ==='));
  console.log(`快照时间 : ${snap.savedAt}`);
  console.log(`快照文件 : ${snapshotPath}`);
  console.log(`当前项目 : ${data.project.name}${data.project.subPath ? `/${data.project.subPath}` : ''}`);
  console.log(`项目路径 : ${data.project.projectDir || '-'}`);
  if (data.project.vcs?.branch) {
    console.log(
      `版本控制 : ${data.project.vcs.type || 'vcs'} / ${data.project.vcs.branch}${data.project.vcs.dirty ? ' (有未提交更改)' : ' (干净)'}`,
    );
  }
  console.log(`当前模型 : ${data.model.label} | 状态: ${data.agentState.label} | 套餐: ${data.planTier || '-'}`);
  console.log(
    `上下文   : 已用 ${formatPercent(data.context.usedPercentage, true)} (${formatTokens(data.context.usedTokens)} / ${formatTokens(data.context.windowSize)})` +
      (data.context.cacheHitRate !== null ? ` | 缓存命中 ${formatPercent(data.context.cacheHitRate)}` : ''),
  );
  if (data.context.totalInputTokens !== null || data.context.totalOutputTokens !== null) {
    const tps = snap.parsed?.telemetry?.tokensPerSecond;
    console.log(
      `会话累计 : 输入 ${formatTokens(data.context.totalInputTokens)} / 输出 ${formatTokens(data.context.totalOutputTokens)}` +
        (tps ? ` | 速率 ${formatTokenRate(tps)} tok/s` : '') +
        (data.cost?.totalUsd !== null ? ` | 费用 $${data.cost.totalUsd.toFixed(4)}` : ''),
    );
  }

  console.log('');
  console.log(styler.boldWhite('各模型配额用量（5小时 / 周限额）:'));
  if (!data.quotaGroups || data.quotaGroups.length === 0) {
    console.log('  （当前快照中未包含 quota 字段或暂无活跃配额桶）');
  } else {
    for (const group of data.quotaGroups) {
      console.log(`  [${group.groupName}]`);
      for (const b of group.buckets) {
        const countdown = formatDuration(b.resetInSeconds) || '-';
        const clock = formatLocalResetClock(b.resetTime);
        console.log(
          `    - ${b.windowLabel.padEnd(4)} (${b.id}): 剩余 ${formatPercent(b.remainingPercent, true)} / 已用 ${formatPercent(b.usedPercent, true)} | 重置: ${countdown}${clock ? ` (${clock})` : ''}`,
        );
      }
    }
  }
}

/**
 * mode 子命令：一键切换显示模式。
 * @param {string[]} positional 位置参数
 */
function cmdMode(positional) {
  const nextMode = positional[0];
  if (!nextMode || !VALID_MODES.includes(nextMode)) {
    console.error(`请指定有效的显示模式：${VALID_MODES.join(' | ')}`);
    console.error('示例：node bin/agy-monitor.mjs mode detailed');
    process.exitCode = 1;
    return;
  }

  const { configPath } = saveUserConfigPatch({ mode: nextMode });
  const modeDesc = {
    compact: '两行紧凑仪表盘（默认）',
    minimal: '单行极简模式',
    detailed: '多行详细看板模式',
  };
  console.log(`已将默认模式切换为：${nextMode}（${modeDesc[nextMode]}）`);
  console.log(`配置文件：${configPath}`);
  console.log('下次 agy 状态栏刷新时立即生效。');
}

/**
 * 将命令行字符串值解析为布尔、数字或字符串。
 * @param {string} rawValue 原始字符串
 * @returns {any}
 */
function coerceValue(rawValue) {
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) return Number(rawValue);
  return rawValue;
}

/**
 * config 子命令：查看当前生效配置或按 key=value 更新配置。
 * @param {string[]} positional key=value 参数列表
 */
function cmdConfig(positional) {
  if (positional.length === 0) {
    console.log(`用户配置文件路径: ${getUserConfigPath()}`);
    console.log(JSON.stringify(loadConfig(), null, 2));
    return;
  }

  const patch = {};
  for (const item of positional) {
    const idx = item.indexOf('=');
    if (idx === -1) {
      console.error(`无效配置参数：${item}，请使用 key=value 格式（例如 quotaDisplay=used）`);
      process.exitCode = 1;
      return;
    }
    const keyPath = item.slice(0, idx).trim();
    const value = coerceValue(item.slice(idx + 1).trim());
    const keys = keyPath.split('.').filter(Boolean);
    let cursor = patch;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!cursor[keys[i]] || typeof cursor[keys[i]] !== 'object') {
        cursor[keys[i]] = {};
      }
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
  }

  const { configPath, config } = saveUserConfigPatch(patch);
  console.log(`配置已更新并写入：${configPath}`);
  console.log(JSON.stringify(config, null, 2));
}

/**
 * doctor 子命令：检查本机环境、agy CLI、插件结构及状态栏端到端渲染延迟。
 */
function cmdDoctor() {
  const pluginRoot = getPluginRoot();
  const statuslineScript = path.join(pluginRoot, 'bin', 'statusline.mjs');

  console.log('=== agy-monitor 环境自检 ===');
  console.log(`Node.js 版本  : ${process.version}`);
  console.log(`操作系统      : ${process.platform} (${process.arch})`);
  console.log(`插件源码目录  : ${pluginRoot}`);
  console.log(`数据目录      : ${getDataDir()}`);
  console.log(`用户配置文件  : ${getUserConfigPath()} (${fs.existsSync(getUserConfigPath()) ? '已存在' : '使用默认配置'})`);
  console.log(`最新快照文件  : ${getSnapshotPath()} (${fs.existsSync(getSnapshotPath()) ? '已存在' : '尚未生成'})`);

  try {
    const agyVersion = execFileSync('agy', ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    console.log(`agy CLI 版本  : ${agyVersion || '已检测到'}`);
  } catch {
    console.log('agy CLI 版本  : 未在 PATH 中检测到 agy（请确认已安装 Antigravity CLI）');
  }

  // 检查 agy settings.json 中的 statusLine.command 配置并用真实壳层校验
  const settingsPath = path.join(getDataDir(), 'settings.json');
  let configuredCommand = null;
  try {
    if (fs.existsSync(settingsPath)) {
      const parsedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      configuredCommand = parsedSettings?.statusLine?.command || null;
      console.log(`statusLine配置: ${configuredCommand || '(未配置)'}`);
      if (process.platform === 'win32' && configuredCommand && configuredCommand.includes('"')) {
        console.error(
          '  [警告] Windows 下 statusLine.command 包含双引号 (")，会导致 agy 执行 cmd /c 时转义为 \\" 并触发 Cannot find module；请重新运行 node ./scripts/install.mjs 修复！',
        );
        process.exitCode = 1;
      }
    } else {
      console.log(`statusLine配置: 未检测到 ${settingsPath}`);
    }
  } catch (err) {
    console.log(`statusLine配置: 读取跳过 (${err.message})`);
  }

  // 测试端到端管道调用 statusline.mjs 的真实耗时
  const samplePayload = fs.readFileSync(
    path.join(pluginRoot, 'test', 'fixtures', 'standard-multi-model.json'),
    'utf8',
  );
  const start = Date.now();
  try {
    const out = execFileSync(process.execPath, [statuslineScript, '--no-snapshot'], {
      input: samplePayload,
      encoding: 'utf8',
      timeout: 4000,
    });
    const elapsedMs = Date.now() - start;
    console.log(`端到端渲染测试: 成功 (${elapsedMs} ms，远低于 5000 ms 上限)`);
    console.log('示例输出:');
    console.log(out.trimEnd());
  } catch (err) {
    console.error(`端到端渲染测试: 失败 - ${err.message}`);
    process.exitCode = 1;
  }

  // 模拟 agy 的真实壳层调用方式（Windows: cmd /c，Unix: sh -c）验证已配置的 statusLine.command
  if (configuredCommand) {
    const shellBin = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const shellFlag = process.platform === 'win32' ? '/c' : '-c';
    const tempSnap = path.join(os.tmpdir(), `agy-monitor-doctor-${process.pid}.json`);
    const shellStart = Date.now();
    try {
      execFileSync(shellBin, [shellFlag, configuredCommand], {
        input: samplePayload,
        encoding: 'utf8',
        timeout: 4000,
        env: { ...process.env, AGY_MONITOR_SNAPSHOT: tempSnap },
      });
      console.log(`壳层调用自检  : 成功 (${shellBin} ${shellFlag}, ${Date.now() - shellStart} ms)`);
    } catch (err) {
      const detail = (err.stderr || err.message || '').trim().split(/\r?\n/).slice(0, 6).join('\n');
      console.error(`壳层调用自检  : 失败 (${shellBin} ${shellFlag})\n${detail}`);
      process.exitCode = 1;
    } finally {
      fs.rmSync(tempSnap, { force: true });
    }
  }
}

function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);

  switch (command) {
    case 'preview':
      cmdPreview(flags);
      break;
    case 'inspect':
      cmdInspect(flags);
      break;
    case 'mode':
      cmdMode(positional);
      break;
    case 'config':
      cmdConfig(positional);
      break;
    case 'doctor':
      cmdDoctor();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`未知命令: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error(`执行失败: ${err.message}`);
  process.exitCode = 1;
}
