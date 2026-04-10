'use strict';
const { calcTokenCost } = require('./scoring');

const ENTRY_POINT_SUFFIXES = ['package.json', 'CLAUDE.md'];

function isEntryPoint(filePath) {
  return ENTRY_POINT_SUFFIXES.some(ep => filePath === ep || filePath.endsWith('/' + ep));
}

function generateBriefing(fileMap, prefix) {
  const label = prefix || '[Tokimizer]';

  if (!fileMap || !fileMap.files || Object.keys(fileMap.files).length === 0) {
    return `${label} No file map yet. Run /tokimizer:reindex to initialize.`;
  }

  const config = fileMap.config || {};
  const budgetPct = config.token_budget_pct || 35;
  const contextWindow = config.context_window || 200000;
  const budget = Math.round(contextWindow * budgetPct / 100);

  const entries = Object.entries(fileMap.files);

  // ── Pass 1: greedy walk by raw score to establish initial within-budget set ──
  const pass1Sorted = entries.slice().sort(([, a], [, b]) => b.score - a.score);

  let tokensUsed1 = 0;
  const pass1Set = new Set();

  for (const [filePath, entry] of pass1Sorted) {
    const cost = calcTokenCost(entry.size_bytes);
    if (isEntryPoint(filePath) || tokensUsed1 + cost <= budget) {
      pass1Set.add(filePath);
      tokensUsed1 += cost;
    }
  }

  // ── Pass 2: compute effective scores using pass-1 set as co-access reference ──
  const working = entries.map(([filePath, entry]) => {
    const coAccess = Array.isArray(entry.co_access) ? entry.co_access : [];
    const n = coAccess.filter(peer => pass1Set.has(peer)).length;
    const effectiveScore = entry.score * (1 + 0.1 * n);
    return { path: filePath, effectiveScore, score: entry.score, size_bytes: entry.size_bytes };
  });

  working.sort((a, b) => b.effectiveScore - a.effectiveScore);

  let tokensUsed = 0;
  const withinBudget = [];
  const beyondBudget = [];

  for (const item of working) {
    const cost = calcTokenCost(item.size_bytes);
    if (isEntryPoint(item.path) || tokensUsed + cost <= budget) {
      withinBudget.push({ path: item.path, score: item.score, cost });
      tokensUsed += cost;
    } else {
      beyondBudget.push(item.path);
    }
  }

  const pctUsed = Math.round((tokensUsed / budget) * 100);
  const topFiles = withinBudget
    .slice(0, 5)
    .map(f => `${f.path} (${f.score.toFixed(1)})`)
    .join(', ');

  let out = `${label} Context loaded: ${withinBudget.length} files, ~${tokensUsed.toLocaleString()} tokens (${pctUsed}% of budget)\n`;
  if (topFiles) out += `Top files: ${topFiles}\n`;

  if (beyondBudget.length > 0) {
    const preview = beyondBudget.slice(0, 10).join(', ');
    const extra = beyondBudget.length > 10 ? ` +${beyondBudget.length - 10} more` : '';
    out += `Beyond budget (${beyondBudget.length} files — load on demand if relevant): ${preview}${extra}\n`;
  }

  return out.trim();
}

module.exports = { generateBriefing };
