'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const GLOBAL_BASE = path.join(os.homedir(), '.claude', 'tokimizer');

function projectHash(cwd) {
  return crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 8);
}

function detectStateDir(cwd) {
  const localSettings = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(localSettings)) {
    try {
      const s = JSON.parse(fs.readFileSync(localSettings, 'utf8'));
      if (s.enabledPlugins && s.enabledPlugins.tokimizer) {
        const localDir = path.join(cwd, '.claude', 'tokimizer');
        fs.mkdirSync(localDir, { recursive: true });
        return localDir;
      }
    } catch (_) {}
  }
  const globalDir = path.join(GLOBAL_BASE, projectHash(cwd));
  fs.mkdirSync(globalDir, { recursive: true });
  return globalDir;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readFileMap(stateDir) {
  return readJson(path.join(stateDir, 'file-map.json'));
}

function writeFileMap(stateDir, data) {
  writeJson(path.join(stateDir, 'file-map.json'), data);
}

function readSessionBuffer(stateDir) {
  return readJson(path.join(stateDir, 'session-buffer.json'));
}

function writeSessionBuffer(stateDir, data) {
  writeJson(path.join(stateDir, 'session-buffer.json'), data);
}

function clearSessionBuffer(stateDir) {
  const p = path.join(stateDir, 'session-buffer.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function readSuggestions(stateDir) {
  const p = path.join(stateDir, 'suggestions.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function appendSuggestions(stateDir, candidates) {
  const existing = new Set(readSuggestions(stateDir));
  const newOnes = candidates.filter(c => !existing.has(c));
  if (newOnes.length === 0) return;
  fs.appendFileSync(path.join(stateDir, 'suggestions.txt'), newOnes.join('\n') + '\n');
}

function clearSuggestions(stateDir) {
  const p = path.join(stateDir, 'suggestions.txt');
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = {
  detectStateDir,
  readFileMap, writeFileMap,
  readSessionBuffer, writeSessionBuffer, clearSessionBuffer,
  readSuggestions, appendSuggestions, clearSuggestions
};
