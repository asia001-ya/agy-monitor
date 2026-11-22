import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitCachePath } from './config.mjs';

/**
 * 从指定目录向上遍历查找 Git 仓库根目录与真实 .git 元数据目录（兼容普通仓库与 worktree/submodule）。
 * @param {string} startDir 起始目录路径
 * @returns {{ repoRoot: string, gitDir: string } | null}
 */
export function findGitDir(startDir) {
  if (!startDir || typeof startDir !== 'string') return null;

  let current;
  try {
    current = path.resolve(startDir);
    if (!fs.existsSync(current)) return null;
    if (!fs.statSync(current).isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    return null;
  }

  // 最多向上查找 16 层，防止极端路径死循环
  for (let depth = 0; depth < 16; depth += 1) {
    const dotGit = path.join(current, '.git');
    try {
      if (fs.existsSync(dotGit)) {
        const stat = fs.statSync(dotGit);
        if (stat.isDirectory()) {
          return { repoRoot: current, gitDir: dotGit };
        }
        if (stat.isFile()) {
          // worktree / submodule 场景：.git 文件内容形如 "gitdir: ../.git/worktrees/xxx"
          const content = fs.readFileSync(dotGit, 'utf8').trim();
          const match = content.match(/^gitdir:\s*(.+)$/i);
          if (match) {
            const resolvedGitDir = path.resolve(current, match[1].trim());
            if (fs.existsSync(resolvedGitDir)) {
              return { repoRoot: current, gitDir: resolvedGitDir };
            }
          }
        }
      }
    } catch {
      // 无权限读取该层级时继续尝试或安全放弃
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * 直接读取 .git/HEAD 文件解析当前分支名（零子进程，约 0.1ms 完成）。
 * @param {string} gitDir .git 目录路径
 * @returns {string | null}
 */
export function readGitBranchFromHead(gitDir) {
  try {
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const raw = fs.readFileSync(headPath, 'utf8').trim();
    if (!raw) return null;

    if (raw.startsWith('ref:')) {
      const ref = raw.slice(4).trim();
      if (ref.startsWith('refs/heads/')) {
        return ref.slice('refs/heads/'.length);
      }
      if (ref.startsWith('refs/tags/')) {
        return `tag:${ref.slice('refs/tags/'.length)}`;
      }
      if (ref.startsWith('refs/')) {
        return ref.slice('refs/'.length);
      }
      return ref;
    }

    // 游离 HEAD（detached HEAD）：显示 7 位短提交哈希
    if (/^[0-9a-f]{7,40}$/i.test(raw)) {
      return `@${raw.slice(0, 7)}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 读取本地轻量 Git dirty 缓存文件。
 * @param {string} cachePath 缓存文件路径
 * @returns {Record<string, { dirty: boolean, ts: number }>}
 */
function readDirtyCache(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) return {};
    const raw = fs.readFileSync(cachePath, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 写入本地轻量 Git dirty 缓存文件（失败静默跳过）。
 * @param {string} cachePath 缓存文件路径
 * @param {Record<string, { dirty: boolean, ts: number }>} cache 缓存对象
 */
function writeDirtyCache(cachePath, cache) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(cache), 'utf8');
    fs.renameSync(tempPath, cachePath);
  } catch {
    // 沙箱只读或并发竞争时静默跳过
  }
}

/**
 * 带短时缓存与严格超时保护地检测 Git 工作区是否存在未提交改动（* 标记）。
 * 仅在缓存过期时执行一次快速 git status，绝大多数刷新直接 0.1ms 命中缓存。
 * @param {string} repoRoot Git 仓库根目录
 * @param {number} [ttlMs=5000] 缓存有效期（毫秒）
 * @returns {boolean}
 */
function detectGitDirtyCached(repoRoot, ttlMs = 5000) {
  const cachePath = getGitCachePath();
  const key = repoRoot.toLowerCase();
  const now = Date.now();
  const cache = readDirtyCache(cachePath);
  const entry = cache[key];

  if (entry && typeof entry.ts === 'number' && now - entry.ts < ttlMs) {
    return Boolean(entry.dirty);
  }

  let dirty = false;
  try {
    const output = execFileSync(
      'git',
      ['-C', repoRoot, 'status', '--porcelain', '--ignore-submodules=dirty'],
      {
        encoding: 'utf8',
        timeout: 250,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    dirty = output.trim().length > 0;
  } catch {
    // 未安装 git、超大仓库超时或无权执行时安全降级为 false
    dirty = false;
  }

  // 仅保留最近 16 个仓库记录，防止缓存文件增长
  const keys = Object.keys(cache);
  if (keys.length >= 16 && !cache[key]) {
    delete cache[keys[0]];
  }
  cache[key] = { dirty, ts: now };
  writeDirtyCache(cachePath, cache);

  return dirty;
}

/**
 * 当 agy payload 未提供 vcs.branch（仅给了 vcs.type="git" 或未给 vcs）时，
 * 直接从本地仓库 .git/HEAD 毫秒级解析分支名与脏工作区标记。
 * @param {string} targetDir 当前目录或项目目录
 * @param {{ detectDirty?: boolean, dirtyCacheTtlMs?: number }} [options] 探测选项
 * @returns {{ type: 'git', branch: string, dirty: boolean } | null}
 */
export function resolveLocalGitInfo(targetDir, options = {}) {
  const found = findGitDir(targetDir);
  if (!found) return null;

  const branch = readGitBranchFromHead(found.gitDir);
  if (!branch) return null;

  const dirty = options.detectDirty
    ? detectGitDirtyCached(found.repoRoot, options.dirtyCacheTtlMs ?? 5000)
    : false;

  return {
    type: 'git',
    branch,
    dirty,
  };
}
