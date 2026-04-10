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
  const sorted = entries.slice().sort(([, a], [, b]) => b.score - a.score);

  let tokensUsed = 0;
  const withinBudget = [];
  const beyondBudget = [];

  for (const [filePath, entry] of sorted) {
    const cost = calcTokenCost(entry.size_bytes);
    if (isEntryPoint(filePath) || tokensUsed + cost <= budget) {
      withinBudget.push({ path: filePath, score: entry.score, cost });
      tokensUsed += cost;
    } else {
      beyondBudget.push(filePath);
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
