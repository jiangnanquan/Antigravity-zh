'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');


/**
 * Return all candidate antigravity-cli data roots, ordered by priority:
 *   1. ~/.gemini/antigravity-cli         (standard macOS/Linux install)
 *   2. $XDG_DATA_HOME/antigravity-cli    (Linux XDG override)
 *   3. $APPDATA/antigravity-cli          (Windows roaming)
 *   4. $LOCALAPPDATA/antigravity-cli     (Windows local)
 *
 * Unset env vars are filtered out so the list only contains usable paths.
 *
 * @returns {string[]}
 */
function getAntigravityRoots() {
  if (process.env.AGY_HUD_DATA_DIR) {
    return [process.env.AGY_HUD_DATA_DIR];
  }

  const candidates = [
    path.join(os.homedir(), '.gemini', 'antigravity-cli'),
    process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'antigravity-cli')
      : null,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'antigravity-cli')
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'antigravity-cli')
      : null,
  ].filter(Boolean);

  return candidates;
}

/**
 * Resolve a relative path under any of the candidate antigravity roots.
 * Returns the first candidate whose joined path exists on disk; if none exist,
 * returns the joined path under the first (highest-priority) candidate so
 * callers can still use it as a write target.
 *
 * @param {string} relativePath
 * @returns {string}
 */
function resolveAntigravityPath(relativePath) {
  const roots = getAntigravityRoots();
  for (const root of roots) {
    const candidate = path.join(root, relativePath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(roots[0], relativePath);
}

/**
 * Safely resolve the absolute path of a system executable without searching CWD.
 * On Windows, it maps standard binaries directly to %SystemRoot%\System32 or WindowsPowerShell,
 * and searches PATH while explicitly ignoring relative path directories.
 *
 * @param {string} name
 * @returns {string|null}
 */
function resolveSafeExecutable(name) {
  const platform = process.platform;
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    if (name === 'chcp') {
      return path.join(systemRoot, 'System32', 'chcp.com');
    }
    if (name === 'powershell') {
      return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    }
  }

  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];

  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed || trimmed === '.' || !path.isAbsolute(trimmed)) continue;

    for (const ext of extensions) {
      const fullPath = path.join(trimmed, name + ext);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          return fullPath;
        }
      } catch {
        // ignore errors reading path entries
      }
    }
  }
  return null;
}

module.exports = {
  getAntigravityRoots,
  resolveAntigravityPath,
  resolveSafeExecutable,
};
