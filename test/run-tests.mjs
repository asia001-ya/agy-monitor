import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadDefaultConfig } from '../lib/config.mjs';
import { parseStatusPayload } from '../lib/parser.mjs';
import { renderStatusLine } from '../lib/renderer.mjs';
import { resolveLocalGitInfo } from '../lib/git.mjs';
import { resolveTokenTelemetry } from '../lib/telemetry.mjs';
import { buildStatusLineCommand } from '../scripts/install.mjs';
import {
  createStyler,
  displayWidth,
  formatDuration,
  formatTokenRate,
  formatTokens,
  pickModelColor,
  renderCycleModeBadge,
  stripAnsi,
  truncateAnsi,
} from '../lib/formatter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('parser: 准确解析标准多模型 5h/周配额、上下文占用与中文项目名', () => {
  const config = loadDefaultConfig();
  const payload = readFixture('standard-multi-model.json');
  const parsed = parseStatusPayload(payload, config);

  assert.equal(parsed.project.name, '示例项目');
  assert.equal(parsed.project.vcs.branch, 'main');
  assert.equal(parsed.project.vcs.dirty, true);

  // display_name 已带 (XHigh)，不应重复拼接 (xhigh)
  assert.equal(parsed.model.label, 'Gemini 4 Neon (XHigh)');
  assert.equal(parsed.agentState.label, '运行');

  // 上下文占用与缓存命中率
  assert.equal(parsed.context.usedPercentage, 14.2);
  assert.equal(parsed.context.windowSize, 1048576);
  assert.ok(parsed.context.cacheHitRate > 50);

  // 分组排序：Gemini 在前，Claude 在后，每组内 5h 在周前
  assert.equal(parsed.quotaGroups.length, 2);
  assert.equal(parsed.quotaGroups[0].groupName, 'Gemini');
  assert.deepEqual(
    parsed.quotaGroups[0].buckets.map((b) => b.windowType),
    ['5h', 'weekly'],
  );
  assert.equal(parsed.quotaGroups[0].buckets[0].remainingPercent, 82);
  assert.equal(parsed.quotaGroups[0].buckets[1].remainingPercent, 93.8);

  assert.equal(parsed.quotaGroups[1].groupName, 'Claude');
  assert.deepEqual(
    parsed.quotaGroups[1].buckets.map((b) => b.windowType),
    ['5h', 'weekly'],
  );
});

test('parser: 递归解析嵌套 third_party 配额、驼峰键名与子目录路径', () => {
  const config = loadDefaultConfig();
  const nested = readFixture('nested-third-party.json');
  const parsedNested = parseStatusPayload(nested, config);

  assert.equal(parsedNested.project.name, 'payments-service');
  assert.equal(parsedNested.project.subPath, 'src/middleware');
  assert.equal(parsedNested.subagentCount, 1);

  const groupNames = parsedNested.quotaGroups.map((g) => g.groupName);
  assert.deepEqual(groupNames, ['Gemini', 'Argon', 'Claude']);

  const claudeGroup = parsedNested.quotaGroups.find((g) => g.groupName === 'Claude');
  assert.equal(claudeGroup.buckets.length, 2);
  assert.equal(claudeGroup.buckets[0].remainingPercent, 21);
  assert.equal(claudeGroup.buckets[1].remainingPercent, 16);

  // 验证 camelCase 第三方桶名与 disabled 桶过滤
  const critical = readFixture('critical-usage.json');
  const parsedCritical = parseStatusPayload(critical, config);
  const criticalGroups = parsedCritical.quotaGroups.map((g) => g.groupName);
  assert.deepEqual(criticalGroups, ['Gemini', '3P']);
  assert.equal(
    parsedCritical.quotaGroups.flatMap((g) => g.buckets).some((b) => b.disabled),
    false,
  );
});

test('parser: 支持数组形式 quota 与根据 reset_time 自动计算倒计时', () => {
  const config = loadDefaultConfig();
  const fixedNow = Date.parse('2026-11-22T10:00:00Z');
  const parsed = parseStatusPayload(
    {
      cwd: '/repo/demo',
      quota: [
        {
          id: 'gpt-5h',
          used_percentage: 35,
          reset_time: '2026-11-22T12:30:00Z',
        },
      ],
    },
    config,
    fixedNow,
  );

  assert.equal(parsed.quotaGroups.length, 1);
  assert.equal(parsed.quotaGroups[0].groupName, 'GPT');
  assert.equal(parsed.quotaGroups[0].buckets[0].remainingPercent, 65);
  assert.equal(parsed.quotaGroups[0].buckets[0].resetInSeconds, 9000);
});

test('formatter: 精准计算全角字符与 ANSI 宽度并安全截断', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('示例项目'), 8);
  assert.equal(displayWidth('\x1b[32m示例\x1b[0m12'), 6);

  const truncated = truncateAnsi('\x1b[96m示例项目状态栏测试\x1b[0m', 7, true);
  assert.ok(displayWidth(truncated) <= 7);
  assert.ok(truncated.endsWith('\x1b[0m'));

  assert.equal(formatTokens(1048576), '1M');
  assert.equal(formatTokens(149200), '149K');
  assert.equal(formatTokens(15400), '15.4K');
  assert.equal(formatDuration(15360), '4h16m');
  assert.equal(formatDuration(14835), '4h07m');
  assert.equal(formatDuration(558000), '6d11h');
  assert.equal(formatDuration(45), '<1m');
});

test('renderer: compact / minimal / detailed 三种模式输出且严控终端宽度', () => {
  const baseConfig = loadDefaultConfig();
  const payload = readFixture('standard-multi-model.json');

  // 1. compact 两行紧凑模式（默认 square 垂直居中进度条 + TrueColor + Token 消耗/速率）
  const compactData = parseStatusPayload(payload, baseConfig);
  compactData.telemetry = { tokensPerSecond: 42.5, isLive: true, source: 'telemetry' };
  const compactOut = renderStatusLine(compactData, baseConfig);
  const compactLines = compactOut.split('\n');
  assert.equal(compactLines.length, 2);
  assert.ok(compactOut.includes('\x1b[38;2;'), '默认应输出 24-bit TrueColor 柔和配色');
  assert.ok(stripAnsi(compactOut).includes('■'), '默认 square 风格应使用垂直居中实心方格字符');
  assert.equal(stripAnsi(compactOut).includes('['), false, '默认 square 风格不应包含冗余方括号');
  assert.ok(stripAnsi(compactLines[0]).includes('示例项目'));
  assert.ok(stripAnsi(compactLines[0]).includes('CTX'));
  assert.ok(stripAnsi(compactLines[0]).includes('42.5'), '应显示 token/s 速率');
  assert.ok(
    stripAnsi(compactLines[0]).includes('↑182K') || stripAnsi(compactLines[0]).includes('223Ktok'),
    '应显示会话 Token 消耗',
  );
  assert.ok(stripAnsi(compactLines[1]).includes('Gemini'));
  assert.ok(stripAnsi(compactLines[1]).includes('Claude'));
  for (const line of compactLines) {
    assert.ok(displayWidth(line) <= payload.terminal_width);
  }

  // 用户主目录应显示为简洁的 ~
  const homeParsed = parseStatusPayload({ cwd: os.homedir(), plan_tier: 'Google AI Ultra' }, baseConfig);
  assert.equal(homeParsed.project.name, '~');
  const homeOut = stripAnsi(renderStatusLine(homeParsed, baseConfig));
  assert.ok(homeOut.includes('● ~'));
  assert.ok(homeOut.includes('✦ Ultra'));

  // 2. minimal 单行极简模式
  const minimalConfig = { ...baseConfig, mode: 'minimal' };
  const minimalData = parseStatusPayload(payload, minimalConfig);
  minimalData.telemetry = { tokensPerSecond: 38.4, isLive: false, source: 'telemetry' };
  const minimalOut = renderStatusLine(minimalData, minimalConfig);
  assert.equal(minimalOut.split('\n').length, 1);
  assert.ok(stripAnsi(minimalOut).includes('38.4 t/s'));
  assert.ok(displayWidth(minimalOut) <= payload.terminal_width);

  // 3. detailed 多行详细看板模式
  const detailedConfig = { ...baseConfig, mode: 'detailed' };
  const detailedData = parseStatusPayload(payload, detailedConfig);
  detailedData.telemetry = { tokensPerSecond: 51.2, isLive: true, source: 'telemetry' };
  const detailedOut = renderStatusLine(detailedData, detailedConfig);
  const detailedLines = detailedOut.split('\n');
  assert.ok(detailedLines.length >= 4);
  assert.ok(stripAnsi(detailedLines[1]).includes('缓存:'));
  assert.ok(stripAnsi(detailedLines[1]).includes('51.2 tok/s'));

  // 4. 窄终端（76 列）绝不溢出宽度
  const criticalPayload = readFixture('critical-usage.json');
  const criticalOut = renderStatusLine(parseStatusPayload(criticalPayload, baseConfig), baseConfig);
  for (const line of criticalOut.split('\n')) {
    assert.ok(
      displayWidth(line) <= criticalPayload.terminal_width,
      `行宽 ${displayWidth(line)} 超出限制 ${criticalPayload.terminal_width}: ${stripAnsi(line)}`,
    );
  }

  // 5. 启动无 quota 数据优雅降级
  const startupPayload = readFixture('minimal-startup.json');
  const startupOut = renderStatusLine(parseStatusPayload(startupPayload, baseConfig), baseConfig);
  assert.ok(stripAnsi(startupOut).includes('new-app'));
  assert.ok(stripAnsi(startupOut).includes('等待 agy 推送'));
});

test('e2e: statusline.mjs 管道执行、快照落盘与畸形输入容错（始终退出码 0）', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-monitor-test-'));
  const snapshotFile = path.join(tempDir, 'snapshot.json');
  const telemetryFile = path.join(tempDir, 'telemetry.json');
  const statuslineBin = path.join(PLUGIN_ROOT, 'bin', 'statusline.mjs');
  const sampleJson = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'standard-multi-model.json'),
    'utf8',
  );

  try {
    // 正常 JSON 输入
    const out = execFileSync(process.execPath, [statuslineBin], {
      input: sampleJson,
      encoding: 'utf8',
      env: {
        ...process.env,
        AGY_MONITOR_SNAPSHOT: snapshotFile,
        AGY_MONITOR_TELEMETRY: telemetryFile,
      },
    });
    assert.ok(stripAnsi(out).includes('示例项目'));
    assert.ok(stripAnsi(out).includes('Gemini'));
    assert.ok(fs.existsSync(snapshotFile), '应自动写入监控快照文件');

    const saved = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    assert.equal(saved.parsed.project.name, '示例项目');

    // 畸形 JSON 输入也必须安全返回退出码 0
    const badOut = execFileSync(process.execPath, [statuslineBin, '--no-snapshot', '--no-telemetry'], {
      input: '{invalid-json',
      encoding: 'utf8',
    });
    assert.ok(badOut.includes('降级'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('formatter: 不同模型分配不同专属颜色并正确格式化 token/s', () => {
  const styler = createStyler(true, 'truecolor');
  const models = [
    'Gemini 4 Neon',
    'Gemini 4 Argon',
    'Gemini Flash',
    'Claude 4 Opus',
    'Claude 4 Sonnet',
    'GPT-5',
    'DeepSeek R1',
    '3P',
  ];
  const colorCodes = models.map((m) => pickModelColor(m, styler)('X').replace('X\x1b[0m', ''));
  assert.equal(new Set(colorCodes).size, models.length, '不同模型系列应映射为互不相同的颜色码');

  assert.equal(formatTokenRate(0), '0');
  assert.equal(formatTokenRate(null), '0');
  assert.equal(formatTokenRate(42.5), '42.5');
  assert.equal(formatTokenRate(42.0), '42');
  assert.equal(formatTokenRate(128.7), '129');

  // 不同运行模式（auto / plan / accept-edits / default / yolo）应使用互不相同的纯前景色（无背景色、紧凑小写）
  const modes = ['auto', 'plan', 'accept-edits', 'default', 'yolo'];
  const renderedModes = modes.map((m) => renderCycleModeBadge(m, styler));
  const modeCodes = renderedModes.map((s) => s.replace(/[a-z]+\x1b\[0m$/, ''));
  assert.equal(new Set(modeCodes).size, modes.length, '不同运行模式应具备互不相同的前景色');
  for (const rendered of renderedModes) {
    assert.equal(rendered.includes('\x1b[48;'), false, '模式标签不应带背景色');
  }
  assert.equal(stripAnsi(renderedModes[0]), 'auto');
  assert.equal(stripAnsi(renderedModes[1]), 'plan');
  assert.equal(stripAnsi(renderedModes[2]), 'edits');
  assert.equal(stripAnsi(renderedModes[3]), 'default');
});

test('telemetry: 支持流式滑动窗口、轮次起止跳变、空闲保留速率及新会话重置', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-telemetry-test-'));
  const telemetryFile = path.join(tempDir, 'telemetry.json');
  const prevEnv = process.env.AGY_MONITOR_TELEMETRY;
  process.env.AGY_MONITOR_TELEMETRY = telemetryFile;

  const config = loadDefaultConfig();
  const makePayload = (overrides) => ({
    conversation_id: 'conv-1',
    cwd: '/repo/demo',
    agent_state: 'idle',
    context_window: {
      context_window_size: 1000000,
      total_input_tokens: 1000,
      total_output_tokens: 0,
      used_percentage: 1,
    },
    ...overrides,
  });

  try {
    // 1. 初始 idle：速率为 null
    const p1 = makePayload({ agent_state: 'idle' });
    const t1 = resolveTokenTelemetry(p1, parseStatusPayload(p1, config, 10_000), config, 10_000);
    assert.equal(t1.tokensPerSecond, null);

    // 2. 进入 working：记录轮次起点
    const p2 = makePayload({ agent_state: 'working' });
    const t2 = resolveTokenTelemetry(p2, parseStatusPayload(p2, config, 12_000), config, 12_000);
    assert.equal(t2.tokensPerSecond, null);

    // 3. 2 秒后输出增长 100 token -> 50 tok/s 且为 live
    const p3 = makePayload({
      agent_state: 'working',
      context_window: { context_window_size: 1000000, total_input_tokens: 1000, total_output_tokens: 100 },
    });
    const t3 = resolveTokenTelemetry(p3, parseStatusPayload(p3, config, 14_000), config, 14_000);
    assert.equal(t3.tokensPerSecond, 50);
    assert.equal(t3.isLive, true);

    // 4. 回到 idle：应保留最近一次有效速率（非 live）
    const p4 = makePayload({
      agent_state: 'idle',
      context_window: { context_window_size: 1000000, total_input_tokens: 1000, total_output_tokens: 100 },
    });
    const t4 = resolveTokenTelemetry(p4, parseStatusPayload(p4, config, 16_000), config, 16_000);
    assert.equal(t4.tokensPerSecond, 50);
    assert.equal(t4.isLive, false);

    // 5. 切换新会话：速率重置为 null
    const p5 = makePayload({
      conversation_id: 'conv-2',
      agent_state: 'idle',
      context_window: { context_window_size: 1000000, total_input_tokens: 0, total_output_tokens: 0 },
    });
    const t5 = resolveTokenTelemetry(p5, parseStatusPayload(p5, config, 20_000), config, 20_000);
    assert.equal(t5.tokensPerSecond, null);

    // 6. 原生 tokens_per_second 字段优先
    const p6 = makePayload({ tokens_per_second: 88.6, agent_state: 'working' });
    const t6 = resolveTokenTelemetry(p6, parseStatusPayload(p6, config, 22_000), config, 22_000);
    assert.equal(t6.tokensPerSecond, 88.6);
    assert.equal(t6.source, 'native');
  } finally {
    if (prevEnv === undefined) delete process.env.AGY_MONITOR_TELEMETRY;
    else process.env.AGY_MONITOR_TELEMETRY = prevEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('git: 当 payload 仅提供 vcs.type="git" 未传 branch 时，自动从本地 .git/HEAD（含 worktree 与 detached）补全分支', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-git-test-'));
  const config = { ...loadDefaultConfig(), detectGitDirty: false };

  try {
    // 1. 普通仓库分支（含子目录向上查找）
    const repo1 = path.join(tempDir, 'repo-normal');
    const subDir = path.join(repo1, 'src', 'api');
    fs.mkdirSync(path.join(repo1, '.git'), { recursive: true });
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(repo1, '.git', 'HEAD'), 'ref: refs/heads/feat/statusline\n', 'utf8');

    const parsed1 = parseStatusPayload(
      { workspace: { project_dir: repo1, current_dir: subDir }, vcs: { type: 'git' } },
      config,
    );
    assert.equal(parsed1.project.vcs.type, 'git');
    assert.equal(parsed1.project.vcs.branch, 'feat/statusline');

    // 2. 游离 HEAD（detached commit SHA）
    fs.writeFileSync(
      path.join(repo1, '.git', 'HEAD'),
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n',
      'utf8',
    );
    const detached = resolveLocalGitInfo(repo1, { detectDirty: false });
    assert.equal(detached.branch, '@a1b2c3d');

    // 3. Git worktree（.git 为指向实际 gitdir 的文件）
    const wtRoot = path.join(tempDir, 'repo-worktree');
    const actualGitDir = path.join(tempDir, 'actual-gitdir');
    fs.mkdirSync(wtRoot, { recursive: true });
    fs.mkdirSync(actualGitDir, { recursive: true });
    fs.writeFileSync(path.join(actualGitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    fs.writeFileSync(path.join(wtRoot, '.git'), `gitdir: ${actualGitDir}\n`, 'utf8');

    const wtInfo = resolveLocalGitInfo(wtRoot, { detectDirty: false });
    assert.equal(wtInfo.branch, 'main');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('install: 生成跨平台 statusLine.command（Windows 禁用双引号并兼容含空格/特殊字符路径）', () => {
  // 1. Windows 纯 ASCII 路径：直接无引号输出，避免 cmd /c 将双引号转义为 \"
  const winSimple = buildStatusLineCommand(
    'C:\\Users\\alice\\.gemini\\config\\plugins\\agy-monitor\\bin\\statusline.mjs',
    'win32',
  );
  assert.equal(
    winSimple,
    'node C:/Users/alice/.gemini/config/plugins/agy-monitor/bin/statusline.mjs',
  );
  assert.equal(winSimple.includes('"'), false);

  // 2. Windows 含空格/括号/& 路径：使用无双引号、无空格、无 % 的 import() 兜底
  const winComplex = buildStatusLineCommand(
    'C:\\Users\\John Doe (Dev) & Ops\\.gemini\\config\\plugins\\agy-monitor\\bin\\statusline.mjs',
    'win32',
  );
  assert.equal(winComplex.includes('"'), false);
  assert.equal(winComplex.includes('%'), false);
  assert.ok(winComplex.startsWith("node -e import('file:///"));

  // 3. Unix 路径：纯安全路径直接输出，含空格/单引号路径单引号安全包裹
  assert.equal(
    buildStatusLineCommand('/home/alice/.gemini/config/plugins/agy-monitor/bin/statusline.mjs', 'linux'),
    'node /home/alice/.gemini/config/plugins/agy-monitor/bin/statusline.mjs',
  );
  assert.equal(
    buildStatusLineCommand("/Users/Alice O'Connor/.gemini/statusline.mjs", 'darwin'),
    "node '/Users/Alice O'\\''Connor/.gemini/statusline.mjs'",
  );

  // 4. 在真实 Windows 环境下通过 cmd.exe /c 端到端验证普通路径与含空格/特殊字符路径均可执行
  if (process.platform === 'win32') {
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cmd-'));
    const simpleScript = path.join(tempBase, 'simple.mjs');
    const complexDir = path.join(tempBase, 'user space (1) & 2');
    const complexScript = path.join(complexDir, 'statusline.mjs');

    fs.mkdirSync(complexDir, { recursive: true });
    const tinyBody =
      "import fs from 'node:fs'; process.stdout.write('OK:' + fs.readFileSync(0, 'utf8').trim());";
    fs.writeFileSync(simpleScript, tinyBody, 'utf8');
    fs.writeFileSync(complexScript, tinyBody, 'utf8');

    try {
      const cmd1 = buildStatusLineCommand(simpleScript, 'win32');
      const out1 = execFileSync('cmd.exe', ['/c', cmd1], { input: 'ping1', encoding: 'utf8' });
      assert.equal(out1, 'OK:ping1');

      const cmd2 = buildStatusLineCommand(complexScript, 'win32');
      const out2 = execFileSync('cmd.exe', ['/c', cmd2], { input: 'ping2', encoding: 'utf8' });
      assert.equal(out2, 'OK:ping2');
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
});
