import fs from 'node:fs';
import path from 'node:path';
import { getSnapshotPath } from './config.mjs';

/**
 * 按节流策略原子保存最新一次状态栏快照（原始 payload + 解析结果），供 inspect 命令和内置技能查看。
 * 写入失败时静默忽略，确保绝不影响状态栏的毫秒级正常渲染。
 * @param {Record<string, any>} rawPayload 原始 agy stdin JSON
 * @param {Record<string, any>} parsedData 归一化后的监控对象
 * @param {Record<string, any>} config 监控配置
 */
export function saveSnapshotIfDue(rawPayload, parsedData, config) {
  if (config?.snapshot?.enabled === false) return;

  const snapshotPath = getSnapshotPath();
  const minIntervalMs = Number(config?.snapshot?.minIntervalMs ?? 1000);

  try {
    if (minIntervalMs > 0 && fs.existsSync(snapshotPath)) {
      const stat = fs.statSync(snapshotPath);
      if (Date.now() - stat.mtimeMs < minIntervalMs) {
        return;
      }
    }

    const dir = path.dirname(snapshotPath);
    fs.mkdirSync(dir, { recursive: true });

    const payloadToWrite = {
      savedAt: new Date().toISOString(),
      parsed: parsedData,
      raw: rawPayload,
    };

    const tempPath = `${snapshotPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payloadToWrite, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, snapshotPath);
  } catch {
    // 沙箱只读或并发竞争时静默跳过，绝不阻塞状态栏输出
  }
}

/**
 * 读取最近一次保存的监控快照。
 * @returns {{ savedAt: string, parsed: Record<string, any>, raw: Record<string, any> } | null}
 */
export function readSnapshot() {
  const snapshotPath = getSnapshotPath();
  try {
    if (!fs.existsSync(snapshotPath)) return null;
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
