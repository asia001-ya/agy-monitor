#!/usr/bin/env node
/**
 * agy-monitor 跨平台一键卸载脚本。
 *
 * 功能：
 * 1. 从 ~/.gemini/antigravity-cli/settings.json 中移除由 agy-monitor 注册的 statusLine 配置（自动备份）。
 * 2. 删除 ~/.gemini/config/plugins/agy-monitor 全局插件目录。
 * 3. 若传入 --purge，则一并删除用户自定义配置 agy-monitor.json 与快照文件。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function main() {
  const purge = process.argv.includes('--purge');
  const homeDir = os.homedir();
  const pluginDestDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'agy-monitor');
  const cliConfigDir = path.join(homeDir, '.gemini', 'antigravity-cli');
  const settingsPath = path.join(cliConfigDir, 'settings.json');
  const userMonitorConfigPath = path.join(cliConfigDir, 'agy-monitor.json');
  const snapshotPath = path.join(cliConfigDir, 'agy-monitor-snapshot.json');
  const telemetryPath = path.join(cliConfigDir, 'agy-monitor-telemetry.json');
  const gitCachePath = path.join(cliConfigDir, 'agy-monitor-git-cache.json');

  console.log('=== 卸载 agy-monitor 插件 ===');

  // 1. 清理 settings.json 中的 statusLine
  if (fs.existsSync(settingsPath)) {
    const rawSettings = fs.readFileSync(settingsPath, 'utf8');
    if (rawSettings.trim()) {
      const settings = JSON.parse(rawSettings);
      const currentCmd = String(settings?.statusLine?.command || '');
      if (currentCmd.includes('agy-monitor')) {
        const backupPath = `${settingsPath}.uninstall-bak.${Date.now()}`;
        fs.writeFileSync(backupPath, rawSettings, 'utf8');
        delete settings.statusLine;
        fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        console.log(`[1/2] 已从 settings.json 移除 statusLine 配置（原配置已备份至 ${backupPath}）。`);
      } else {
        console.log('[1/2] settings.json 中的 statusLine 并非指向 agy-monitor，已跳过修改。');
      }
    }
  } else {
    console.log('[1/2] 未检测到 settings.json，跳过清理。');
  }

  // 2. 删除全局插件目录
  if (fs.existsSync(pluginDestDir)) {
    fs.rmSync(pluginDestDir, { recursive: true, force: true });
    console.log(`[2/2] 已删除全局插件目录：${pluginDestDir}`);
  } else {
    console.log('[2/2] 全局插件目录不存在，跳过删除。');
  }

  // 3. 可选清理用户配置、快照与速率遥测状态
  if (purge) {
    for (const target of [userMonitorConfigPath, snapshotPath, telemetryPath, gitCachePath]) {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        console.log(`    已清理：${target}`);
      }
    }
  }

  console.log('\n卸载完成。重启 agy 即可恢复默认底部状态栏。');
}

try {
  main();
} catch (err) {
  console.error(`\n卸载失败：${err.message}`);
  process.exitCode = 1;
}
