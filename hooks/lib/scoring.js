'use strict';

function calcTokenCost(sizeBytes) {
  return Math.max(1, Math.ceil(sizeBytes / 4));
}

function calcRecencyDecay(lastAccessedISO) {
  if (!lastAccessedISO) return 1;
  const days = (Date.now() - new Date(lastAccessedISO).getTime()) / 86400000;
  return Math.pow(0.95, Math.max(0, days));
}

function calcScore(entry) {
  const base = (entry.access_count + entry.edit_count * 3) * calcRecencyDecay(entry.last_accessed);
  return base / calcTokenCost(entry.size_bytes);
}

function coldStartScore(sizeBytes) {
  return 1 / calcTokenCost(sizeBytes);
}

module.exports = { calcTokenCost, calcRecencyDecay, calcScore, coldStartScore };
