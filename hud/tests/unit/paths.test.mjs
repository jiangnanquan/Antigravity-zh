import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getAntigravityRoots,
  resolveAntigravityPath,
  resolveSafeExecutable,
} from '../../runtime/paths.js';

function withEnv(overrides, fn) {
  const snapshot = {};
  for (const key of Object.keys(overrides)) {
    snapshot[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(snapshot)) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  }
}

test('getAntigravityRoots starts with home/.gemini/antigravity-cli', () => {
  withEnv({ XDG_DATA_HOME: undefined, APPDATA: undefined, LOCALAPPDATA: undefined }, () => {
    const roots = getAntigravityRoots();
    assert.equal(roots[0], path.join(os.homedir(), '.gemini', 'antigravity-cli'));
  });
});

test('getAntigravityRoots includes XDG/APPDATA/LOCALAPPDATA when set', () => {
  withEnv({
    XDG_DATA_HOME: '/xdg/home',
    APPDATA: 'C:\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\AppData\\Local',
  }, () => {
    const roots = getAntigravityRoots();
    assert.ok(roots.includes(path.join('/xdg/home', 'antigravity-cli')));
    assert.ok(roots.includes(path.join('C:\\AppData\\Roaming', 'antigravity-cli')));
    assert.ok(roots.includes(path.join('C:\\AppData\\Local', 'antigravity-cli')));
  });
});

test('getAntigravityRoots filters out unset env candidates', () => {
  withEnv({ XDG_DATA_HOME: undefined, APPDATA: undefined, LOCALAPPDATA: undefined }, () => {
    const roots = getAntigravityRoots();
    assert.equal(roots.length, 1);
  });
});

test('resolveAntigravityPath returns first existing candidate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-test-'));
  try {
    const fakeAppdata = path.join(tmp, 'Roaming');
    const fakeRoot = path.join(fakeAppdata, 'antigravity-cli');
    fs.mkdirSync(fakeRoot, { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, 'settings.json'), '{}');

    withEnv({
      XDG_DATA_HOME: undefined,
      APPDATA: fakeAppdata,
      LOCALAPPDATA: undefined,
      HOME: path.join(tmp, 'nonexistent-home'),
      USERPROFILE: path.join(tmp, 'nonexistent-home'),
    }, () => {
      const resolved = resolveAntigravityPath('settings.json');
      assert.equal(resolved, path.join(fakeRoot, 'settings.json'));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveAntigravityPath falls back to first candidate when none exist', () => {
  withEnv({
    XDG_DATA_HOME: undefined,
    APPDATA: undefined,
    LOCALAPPDATA: undefined,
  }, () => {
    const resolved = resolveAntigravityPath('does-not-exist.json');
    assert.equal(
      resolved,
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'does-not-exist.json')
    );
  });
});

test('resolveAntigravityPath joins multi-segment relative paths', () => {
  withEnv({
    XDG_DATA_HOME: undefined,
    APPDATA: undefined,
    LOCALAPPDATA: undefined,
  }, () => {
    const resolved = resolveAntigravityPath(path.join('brain', 'abc', 'log.jsonl'));
    assert.equal(
      resolved,
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', 'abc', 'log.jsonl')
    );
  });
});

test('resolveSafeExecutable resolves absolute path and skips relative directories', () => {
  const nodePath = resolveSafeExecutable('node');
  assert.ok(nodePath);
  assert.ok(path.isAbsolute(nodePath));

  withEnv({
    PATH: ['.', 'relative_dir', path.dirname(nodePath)].join(path.delimiter)
  }, () => {
    const resolved = resolveSafeExecutable('node');
    assert.equal(resolved, nodePath);
  });
});
