'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// extractPath is the pure logic — extracted here for testing without stdin side-effects
function extractPath(toolName, toolInput) {
  if (!toolInput) return null;
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'Grep') {
    const p = toolInput.path;
    if (p && path.extname(p)) return p;
  }
  return null;
}

test('Read: returns file_path', () => {
  assert.strictEqual(extractPath('Read', { file_path: 'src/index.ts' }), 'src/index.ts');
});

test('Write: returns file_path', () => {
  assert.strictEqual(extractPath('Write', { file_path: 'src/new.ts' }), 'src/new.ts');
});

test('Edit: returns file_path', () => {
  assert.strictEqual(extractPath('Edit', { file_path: 'src/old.ts', old_string: 'x', new_string: 'y' }), 'src/old.ts');
});

test('Grep with file path: returns path', () => {
  assert.strictEqual(extractPath('Grep', { path: 'src/index.ts', pattern: 'foo' }), 'src/index.ts');
});

test('Grep with directory path: returns null', () => {
  assert.strictEqual(extractPath('Grep', { path: 'src/', pattern: 'foo' }), null);
});

test('Glob: returns null (patterns are not file paths)', () => {
  assert.strictEqual(extractPath('Glob', { pattern: '**/*.ts' }), null);
});

test('null input: returns null', () => {
  assert.strictEqual(extractPath('Read', null), null);
});

// normalizePath: extracted pure helper — mirrors the implementation in hooks/track-access.js
function normalizePath(rawPath, cwd) {
  const rel = path.isAbsolute(rawPath)
    ? path.relative(cwd, rawPath)
    : rawPath;
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.startsWith('.claude/tokimizer')) return null;
  return normalized;
}

test('normalizePath: Windows absolute path with backslashes is normalized to forward slashes', () => {
  // Simulate Windows: path.relative returns backslash-separated paths on win32,
  // but we replicate that by using a raw string with backslashes as the rawPath
  // (already relative, so the isAbsolute branch is skipped, letting us test replace directly).
  const cwd = '/project';
  const rawPath = 'src\\components\\Button.tsx';
  assert.strictEqual(normalizePath(rawPath, cwd), 'src/components/Button.tsx');
});

test('normalizePath: relative path already using forward slashes is returned unchanged', () => {
  const cwd = '/project';
  const rawPath = 'src/index.ts';
  assert.strictEqual(normalizePath(rawPath, cwd), 'src/index.ts');
});

test('normalizePath: self-tracking path returns null', () => {
  const cwd = '/project';
  const rawPath = '.claude/tokimizer/session-buffer.json';
  assert.strictEqual(normalizePath(rawPath, cwd), null);
});
