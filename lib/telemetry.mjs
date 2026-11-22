import fs from 'node:fs';
import path from 'node:path';
import { getTelemetryPath } from './config.mjs';

// 认为模型正在生成/工作的活跃状态集合
const ACTIVE_STATES = new Set(['working', 'thinking', 'tool_use']);

/**
 * 安全读取本地速率追踪状态文件。
 * @param {string} filePath 遥测文件路径
 * @returns {Record<string, any> | null}
 */
function readTelemetryState(filePath) {
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
 * 原子写入轻量速率状态文件（失败静默跳过，绝不影响状态栏渲染）。
 * @param {string} filePath 遥测文件路径
 * @param {Record<string, any>} state 状态对象
 */
function writeTelemetryState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch {
    // 沙箱只读或并发竞争时静默降级
  }
}

/**
 * 校验并规整化速率值（过滤 NaN、负数及异常尖峰）。
 * @param {any} value 原始速率值
 * @returns {number | null}
 */
function sanitizeTps(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 5000) return null;
  return Number(value.toFixed(1));
}

/**
 * 从原始 payload 提取原生速率字段（若 agy 直接提供）。
 * @param {Record<string, any>} payload 原始 JSON
 * @returns {number | null}
 */
function extractNativeTps(payload) {
  const cw = payload?.context_window || payload?.contextWindow || {};
  const candidates = [
    payload?.output_tokens_per_second,
    payload?.tokens_per_second,
    payload?.tps,
    cw?.output_tokens_per_second,
    cw?.tokens_per_second,
    cw?.tps,
  ];
  for (const val of candidates) {
    const num = typeof val === 'number' ? val : (typeof val === 'string' && val.trim() ? Number(val) : NaN);
    const clean = sanitizeTps(num);
    if (clean !== null) return clean;
  }
  return null;
}

/**
 * 结合本次 payload 与本地轻量状态，计算实时/最近有效输出速率（token/s）并持久化采样窗口。
 *
 * 支持三种来源（按优先级）：
 * 1. payload 原生 tokens_per_second 字段；
 * 2. 基于会话累计 total_output_tokens 的实时滑动窗口（流式场景）或轮次起止耗时（每轮结束后更新场景）；
 * 3. payload.cost.total_api_duration_ms 平均速率兜底。
 *
 * @param {Record<string, any>} rawPayload 原始 agy payload
 * @param {Record<string, any>} parsedData 归一化监控数据
 * @param {Record<string, any>} config 监控配置
 * @param {number} [nowMs=Date.now()] 当前毫秒时间戳（便于测试注入）
 * @returns {{ tokensPerSecond: number | null, isLive: boolean, source: string }}
 */
export function resolveTokenTelemetry(rawPayload, parsedData, config, nowMs = Date.now()) {
  const stateCode = parsedData?.agentState?.code || 'idle';
  const isActive = ACTIVE_STATES.has(stateCode);

  // 1. 优先采用原生速率字段
  const nativeTps = extractNativeTps(rawPayload);
  if (nativeTps !== null) {
    return { tokensPerSecond: nativeTps, isLive: isActive, source: 'native' };
  }

  const persistEnabled = config?.telemetry?.enabled !== false;
  const telemetryPath = getTelemetryPath();
  const sessionKey = String(
    parsedData?.conversationId || parsedData?.project?.projectDir || 'default',
  );
  const currOut = parsedData?.context?.totalOutputTokens;
  const currIn = parsedData?.context?.totalInputTokens;

  // 若不启用本地持久化（如 preview 模拟模式），尝试用 API 耗时兜底
  if (!persistEnabled) {
    const fallbackTps = computeApiDurationFallback(rawPayload, parsedData);
    return { tokensPerSecond: fallbackTps, isLive: isActive && fallbackTps !== null, source: 'fallback' };
  }

  const prev = readTelemetryState(telemetryPath);
  const sameSession =
    prev &&
    prev.sessionKey === sessionKey &&
    (currOut === null || prev.lastOut === null || currOut >= prev.lastOut);

  const next = sameSession
    ? {
        sessionKey,
        turnStartMs: prev.turnStartMs ?? null,
        turnBaseOut: prev.turnBaseOut ?? (currOut ?? 0),
        lastState: stateCode,
        lastOut: currOut ?? prev.lastOut ?? 0,
        lastIn: currIn ?? prev.lastIn ?? 0,
        lastTs: prev.lastTs ?? nowMs,
        lastOutChangeTs: prev.lastOutChangeTs ?? null,
        samples: Array.isArray(prev.samples) ? [...prev.samples] : [],
        lastTps: prev.lastTps ?? null,
      }
    : {
        sessionKey,
        turnStartMs: isActive ? nowMs : null,
        turnBaseOut: currOut ?? 0,
        lastState: stateCode,
        lastOut: currOut ?? 0,
        lastIn: currIn ?? 0,
        lastTs: nowMs,
        lastOutChangeTs: null,
        samples: currOut !== null ? [{ ts: nowMs, out: currOut }] : [],
        lastTps: null,
      };

  // 检测新一轮生成开始（从 idle 等非活跃态切入活跃态），重置采样锚点避免把空闲发呆时间计入耗时
  const wasActive = sameSession ? ACTIVE_STATES.has(prev.lastState) : false;
  if (isActive && (!wasActive || next.turnStartMs === null)) {
    next.turnStartMs = nowMs;
    next.turnBaseOut = currOut ?? next.lastOut ?? 0;
    next.samples = [{ ts: nowMs, out: next.turnBaseOut }];
  }

  let computedTps = null;
  let isLive = false;

  if (currOut !== null && sameSession && prev.lastOut !== null && currOut > prev.lastOut) {
    // 输出 token 增长：追加到滑动窗口（保留最近 12 秒内最多 8 个采样点）
    next.samples.push({ ts: nowMs, out: currOut });
    next.samples = next.samples.filter((s) => nowMs - s.ts <= 12_000).slice(-8);
    next.lastOutChangeTs = nowMs;

    // 优先使用滑动窗口（流式更新时最平滑准确）
    if (next.samples.length >= 2) {
      const oldest = next.samples[0];
      const newest = next.samples[next.samples.length - 1];
      const dtSec = (newest.ts - oldest.ts) / 1000;
      const dOut = newest.out - oldest.out;
      if (dtSec >= 0.25 && dOut > 0) {
        computedTps = sanitizeTps(dOut / dtSec);
      }
    }

    // 其次使用轮次起止计时（适用于每轮结束一次性跳增 total_output_tokens 的 CLI 行为）
    if (computedTps === null && next.turnStartMs !== null) {
      const turnDtSec = (nowMs - next.turnStartMs) / 1000;
      const turnOut = currOut - (next.turnBaseOut ?? prev.lastOut);
      if (turnDtSec >= 0.25 && turnDtSec <= 600 && turnOut > 0) {
        computedTps = sanitizeTps(turnOut / turnDtSec);
      }
    }

    // 再次使用相邻两次刷新的差值
    if (computedTps === null && prev.lastTs) {
      const stepDtSec = (nowMs - prev.lastTs) / 1000;
      const stepOut = currOut - prev.lastOut;
      if (stepDtSec >= 0.25 && stepDtSec <= 120 && stepOut > 0) {
        computedTps = sanitizeTps(stepOut / stepDtSec);
      }
    }

    if (computedTps !== null) {
      next.lastTps = computedTps;
      isLive = isActive;
    }
  } else if (currOut !== null && next.samples.length === 0) {
    next.samples = [{ ts: nowMs, out: currOut }];
  }

  // 若仍处于活跃生成中且近期刚产生过增量，保持 live 高亮；回到 idle 时清零轮次起点但保留 lastTps
  if (isActive && next.lastTps !== null && next.lastOutChangeTs && nowMs - next.lastOutChangeTs <= 8_000) {
    isLive = true;
  }
  if (!isActive) {
    next.turnStartMs = null;
    next.turnBaseOut = currOut ?? next.lastOut ?? 0;
  }

  next.lastTs = nowMs;
  if (currOut !== null) next.lastOut = currOut;
  if (currIn !== null) next.lastIn = currIn;

  // 若尚无增量样本，回退使用 payload 中的 API 耗时估算
  const finalTps = next.lastTps ?? computeApiDurationFallback(rawPayload, parsedData);

  // 仅在状态/会话/token 发生变化或文件尚不存在时落盘，降低磁盘写入频次
  const shouldWrite =
    !sameSession ||
    prev.lastState !== next.lastState ||
    prev.lastOut !== next.lastOut ||
    prev.lastIn !== next.lastIn ||
    prev.lastTps !== next.lastTps;

  if (shouldWrite) {
    writeTelemetryState(telemetryPath, next);
  }

  return {
    tokensPerSecond: finalTps,
    isLive: Boolean(isLive && finalTps !== null),
    source: next.lastTps !== null ? 'telemetry' : (finalTps !== null ? 'fallback' : 'none'),
  };
}

/**
 * 若 payload 提供了 API 耗时（total_api_duration_ms / total_duration_ms），据此估算会话平均输出速率。
 * @param {Record<string, any>} rawPayload 原始 JSON
 * @param {Record<string, any>} parsedData 归一化监控数据
 * @returns {number | null}
 */
function computeApiDurationFallback(rawPayload, parsedData) {
  const cost = rawPayload?.cost || {};
  const durationMs =
    cost.total_api_duration_ms ??
    cost.totalApiDurationMs ??
    cost.total_duration_ms ??
    cost.totalDurationMs ??
    rawPayload?.duration_ms ??
    rawPayload?.durationMs;

  const outTokens = parsedData?.context?.totalOutputTokens ?? parsedData?.context?.currentOutput;
  if (typeof durationMs === 'number' && durationMs >= 250 && typeof outTokens === 'number' && outTokens > 0) {
    return sanitizeTps(outTokens / (durationMs / 1000));
  }
  return null;
}
