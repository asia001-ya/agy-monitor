import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

/**
 * 获取 AGY CLI 的配置目录路径。
 * 可通过环境变量 AGY_MONITOR_DATA_DIR 覆盖（便于测试或自定义目录）。
 * @returns {string}
 */
export function getDataDir() {
  if (process.env.AGY_MONITOR_DATA_DIR) {
    return path.resolve(process.env.AGY_MONITOR_DATA_DIR);
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

/**
 * 获取用户自定义监控配置文件路径。
 * @returns {string}
 */
export function getUserConfigPath() {
  if (process.env.AGY_MONITOR_CONFIG) {
    return path.resolve(process.env.AGY_MONITOR_CONFIG);
  }
  return path.join(getDataDir(), 'agy-monitor.json');
}

/**
 * 获取最新状态快照文件路径。
 * @returns {string}
 */
export function getSnapshotPath() {
  if (process.env.AGY_MONITOR_SNAPSHOT) {
    return path.resolve(process.env.AGY_MONITOR_SNAPSHOT);
  }
  return path.join(getDataDir(), 'agy-monitor-snapshot.json');
}

/**
 * 获取实时 Token 速率追踪状态文件路径。
 * @returns {string}
 */
export function getTelemetryPath() {
  if (process.env.AGY_MONITOR_TELEMETRY) {
    return path.resolve(process.env.AGY_MONITOR_TELEMETRY);
  }
  return path.join(getDataDir(), 'agy-monitor-telemetry.json');
}

/**
 * 获取 Git 工作区脏状态短时缓存文件路径。
 * @returns {string}
 */
export function getGitCachePath() {
  if (process.env.AGY_MONITOR_GIT_CACHE) {
    return path.resolve(process.env.AGY_MONITOR_GIT_CACHE);
  }
  return path.join(getDataDir(), 'agy-monitor-git-cache.json');
}

/**
 * 获取插件根目录路径。
 * @returns {string}
 */
export function getPluginRoot() {
  return PLUGIN_ROOT;
}

/**
 * 递归浅安全合并配置对象（数组直接覆盖，普通对象递归合并）。
 * @param {Record<string, any>} base 基础配置对象
 * @param {Record<string, any>} override 覆盖配置对象
 * @returns {Record<string, any>}
 */
export function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 读取插件内置默认配置。
 * @returns {Record<string, any>}
 */
export function loadDefaultConfig() {
  const defaultPath = path.join(PLUGIN_ROOT, 'config.default.json');
  const raw = fs.readFileSync(defaultPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * 安全读取 JSON 文件，不存在或损坏时返回 null。
 * @param {string} filePath 文件路径
 * @returns {Record<string, any> | null}
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 加载生效配置：默认配置 -> 用户配置文件 -> 环境变量覆盖 -> 运行时参数覆盖。
 * @param {Record<string, any>} [runtimeOverrides] 运行时临时覆盖项
 * @returns {Record<string, any>}
 */
export function loadConfig(runtimeOverrides = {}) {
  const defaults = loadDefaultConfig();
  const userConfig = readJsonSafe(getUserConfigPath());
  let merged = deepMerge(defaults, userConfig || {});

  // 支持常用环境变量快速覆盖
  if (process.env.AGY_MONITOR_MODE) {
    merged.mode = process.env.AGY_MONITOR_MODE;
  }
  if (process.env.AGY_MONITOR_QUOTA_DISPLAY) {
    merged.quotaDisplay = process.env.AGY_MONITOR_QUOTA_DISPLAY;
  }
  if (process.env.AGY_MONITOR_BAR_STYLE) {
    merged.barStyle = process.env.AGY_MONITOR_BAR_STYLE;
  }
  if (process.env.NO_COLOR === '1' || process.env.AGY_MONITOR_NO_COLOR === '1') {
    merged.color = false;
  }

  merged = deepMerge(merged, runtimeOverrides);
  return merged;
}

/**
 * 更新并保存用户配置文件（仅写入差异/用户设置，保留已有用户字段）。
 * @param {Record<string, any>} patch 要合并的配置片段
 * @returns {{ configPath: string, config: Record<string, any> }}
 */
export function saveUserConfigPatch(patch) {
  const configPath = getUserConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readJsonSafe(configPath) || {};
  const nextUser = deepMerge(existing, patch);
  fs.writeFileSync(configPath, `${JSON.stringify(nextUser, null, 2)}\n`, 'utf8');
  return {
    configPath,
    config: loadConfig(),
  };
}
