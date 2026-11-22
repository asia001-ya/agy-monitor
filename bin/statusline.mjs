#!/usr/bin/env node
/**
 * Antigravity CLI (agy) 原生 statusLine 入口脚本。
 * 通过 stdin 接收 agy 推送的实时会话状态 JSON，解析并向 stdout 输出带 ANSI 颜色的多行/单行状态栏。
 *
 * 设计约束：
 * 1. 极速启动与渲染（零外部依赖，毫秒级完成，远低于 agy 的 5 秒超时限制）。
 * 2. 全局异常兜底且始终以状态码 0 退出，避免触发 agy 连续失败 30 次自动禁用机制。
 */

import { loadConfig } from '../lib/config.mjs';
import { parseStatusPayload } from '../lib/parser.mjs';
import { renderStatusLine } from '../lib/renderer.mjs';
import { saveSnapshotIfDue } from '../lib/snapshot.mjs';
import { resolveTokenTelemetry } from '../lib/telemetry.mjs';

/**
 * 带超时保护地读取 stdin 全部 UTF-8 文本。
 * @param {number} [timeoutMs=1500] 超时时间（毫秒）
 * @returns {Promise<string>}
 */
function readStdinSafe(timeoutMs = 1500) {
  return new Promise((resolve) => {
    // 若用户直接交互式执行而非通过管道传入，立即返回空字符串避免挂起
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let raw = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      resolve(value);
    };

    const timer = setTimeout(() => finish(raw), timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => finish(raw));
    process.stdin.on('error', () => finish(raw));
  });
}

/**
 * 解析命令行临时覆盖参数（支持 --mode=minimal|compact|detailed 与 --no-color）。
 * @param {string[]} argv 命令行参数
 * @returns {Record<string, any>}
 */
function parseCliOverrides(argv) {
  const overrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-color') {
      overrides.color = false;
    } else if (arg === '--mode' && argv[i + 1]) {
      overrides.mode = argv[++i];
    } else if (arg.startsWith('--mode=')) {
      overrides.mode = arg.slice('--mode='.length);
    } else if (arg === '--no-snapshot') {
      overrides.snapshot = { enabled: false };
    } else if (arg === '--no-telemetry') {
      overrides.telemetry = { enabled: false };
    }
  }
  return overrides;
}

async function main() {
  try {
    const overrides = parseCliOverrides(process.argv.slice(2));
    const config = loadConfig(overrides);
    const inputText = (await readStdinSafe()).trim();

    if (!inputText) {
      process.stdout.write('● agy-monitor | 等待 agy 状态输入\n');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(inputText);
    } catch {
      process.stdout.write('● agy-monitor | 状态 JSON 解析降级\n');
      return;
    }

    const parsed = parseStatusPayload(payload, config);
    parsed.telemetry = resolveTokenTelemetry(payload, parsed, config);
    const output = renderStatusLine(parsed, config);

    // 异步容错保存最新快照（已做节流与静默异常处理）
    saveSnapshotIfDue(payload, parsed, config);

    process.stdout.write(`${output}\n`);
  } catch {
    // 兜底静默降级，确保永远返回 exit code 0
    process.stdout.write('● agy-monitor | 状态栏降级模式\n');
  }
}

main();
