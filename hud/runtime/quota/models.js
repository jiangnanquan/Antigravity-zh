'use strict';

// Resets shorter than this come from the 5-hour bucket; longer ones from the
// weekly bucket. 12 h is well-separated from both natural ranges
// (5 h max for the short window, ~7 d for the weekly).
const FIVE_HOUR_WINDOW_THRESHOLD_MS = 12 * 60 * 60 * 1000;

// Fallback model list when agentModelSorts is absent from the API response
const FALLBACK_AGENT_MODEL_IDS = [
  'gemini-3-flash-agent',
  'gemini-3.5-flash-low',
  'gemini-3.5-flash-extra-low',
  'gemini-pro-agent',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
];

function discoverAgentModelIds(apiResponse) {
  const sorts = apiResponse.agentModelSorts;
  if (Array.isArray(sorts) && sorts.length > 0) {
    const ids = sorts[0].groups?.[0]?.modelIds;
    if (Array.isArray(ids) && ids.length > 0) return ids;
  }
  return null;
}

function resolveDeprecatedIds(ids, apiResponse) {
  const deprecated = apiResponse.deprecatedModelIds;
  if (!deprecated || typeof deprecated !== 'object') return ids;
  return ids.map(id => deprecated[id]?.newModelId || id);
}

function normalizeRemainingFraction(value, hasResetTime = false) {
  if (value === undefined || value === null) {
    return hasResetTime ? 0 : 1;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Classify a resetTime as belonging to the 5-hour or weekly quota window.
 * The fetchAvailableModels API exposes only one window at a time, so we infer
 * which one by how far away the reset is. resetTimes already in the past
 * cannot be classified — they refer to a window that has already rolled over.
 * @param {string|null} resetTime ISO-8601 string
 * @param {number} now epoch ms
 * @returns {'fiveHour' | 'weekly' | null}
 */
function classifyQuotaWindow(resetTime, now = Date.now()) {
  if (!resetTime) return null;
  const ms = new Date(resetTime).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms < FIVE_HOUR_WINDOW_THRESHOLD_MS ? 'fiveHour' : 'weekly';
}

/**
 * True when a window observation's resetTime has already elapsed — the
 * observation is stale and refers to a window cycle that has rolled over.
 */
function isObservationExpired(observation, now = Date.now()) {
  if (!observation || !observation.resetTime) return false;
  const t = new Date(observation.resetTime).getTime();
  return Number.isFinite(t) && t <= now;
}

function pruneExpiredWindows(windows, now = Date.now()) {
  if (!windows) return {};
  const out = {};
  if (windows.fiveHour && !isObservationExpired(windows.fiveHour, now)) out.fiveHour = windows.fiveHour;
  if (windows.weekly && !isObservationExpired(windows.weekly, now)) out.weekly = windows.weekly;
  return out;
}

/**
 * Normalize the fetchAvailableModels response to the HUD quota shape.
 * Each model carries the `window` tag inferred from its resetTime so that
 * downstream merging can keep both windows' last observed values in cache.
 * @param {Object<string, Object>} models
 * @returns {ModelQuota[]}
 */
function normalizeQuotaModels(models, interestingModelIds = FALLBACK_AGENT_MODEL_IDS, now = Date.now()) {
  const results = [];
  for (const id of interestingModelIds) {
    const m = models[id];
    if (!m || !m.quotaInfo) continue;
    const qi = m.quotaInfo;
    const resetTime = qi.resetTime || null;
    const remainingFraction = normalizeRemainingFraction(qi.remainingFraction, !!resetTime);
    const window = classifyQuotaWindow(resetTime, now);
    const observation = resetTime
      ? { remainingFraction, resetTime, observedAt: now }
      : null;
    results.push({
      id,
      displayName: m.displayName || id,
      modelProvider: m.modelProvider || null,
      remainingFraction,
      resetTime,
      window,
      windows: observation && window
        ? { [window]: observation }
        : {},
    });
  }
  return results;
}

/**
 * Merge a freshly observed quota response with the previously cached one,
 * preserving the *other* window's last observation. The cloud API only
 * exposes one window per response, so without merging the never-observed
 * window would never appear in the UI.
 *
 * Expired previous observations are dropped so a 5-hour bucket that has
 * since rolled over server-side cannot keep dominating pickCriticalWindow.
 * Models present in `previous` but missing from `fresh` are carried forward
 * with their non-expired windows so a temporary API omission doesn't erase
 * the user's window history.
 */
function mergeQuotaWindows(fresh, previous, now = Date.now()) {
  const prevById = new Map();
  for (const q of previous || []) {
    if (q && q.id) prevById.set(q.id, q);
  }
  const freshIds = new Set();
  const results = [];
  for (const q of fresh || []) {
    if (!q || !q.id) continue;
    freshIds.add(q.id);
    const prev = prevById.get(q.id);
    const prevWindows = prev ? pruneExpiredWindows(prev.windows, now) : {};
    const merged = { ...prevWindows, ...(q.windows || {}) };
    const critical = pickCriticalWindow(merged, now);
    results.push({
      ...q,
      remainingFraction: critical ? critical.remainingFraction : q.remainingFraction,
      resetTime: critical ? critical.resetTime : q.resetTime,
      window: critical ? critical.window : q.window,
      windows: merged,
    });
  }
  for (const q of previous || []) {
    if (!q || !q.id || freshIds.has(q.id)) continue;
    const merged = pruneExpiredWindows(q.windows, now);
    if (merged.fiveHour || merged.weekly) {
      const critical = pickCriticalWindow(merged, now);
      results.push({
        ...q,
        remainingFraction: critical ? critical.remainingFraction : q.remainingFraction,
        resetTime: critical ? critical.resetTime : q.resetTime,
        window: critical ? critical.window : q.window,
        windows: merged,
      });
    }
  }
  return results;
}


/**
 * Pick the binding window (lower remaining fraction) for surface display.
 * Falls back to whichever single window we have, or null if none.
 * Expired observations are skipped — a 5-hour bucket whose resetTime has
 * already elapsed must not keep winning the pick.
 */
function pickCriticalWindow(windows, now = Date.now()) {
  if (!windows) return null;
  const five = isObservationExpired(windows.fiveHour, now) ? null : windows.fiveHour;
  const week = isObservationExpired(windows.weekly, now) ? null : windows.weekly;
  if (five && week) {
    return five.remainingFraction <= week.remainingFraction
      ? { ...five, window: 'fiveHour' }
      : { ...week, window: 'weekly' };
  }
  if (five) return { ...five, window: 'fiveHour' };
  if (week) return { ...week, window: 'weekly' };
  return null;
}

function createUnavailableQuotaResult(reason) {
  const result = [];
  Object.defineProperty(result, 'unavailableReason', {
    value: reason,
    enumerable: false,
  });
  return result;
}

/**
 * Parse retrieveUserQuotaSummary response into normalized group windows.
 * Maps groups:
 * - gemini: 'Gemini Models' (Weekly Limit & Five Hour Limit)
 * - 3p: 'Claude and GPT models' (Weekly Limit & Five Hour Limit)
 * @param {Object} quotaSummaryResponse
 * @param {number} [now]
 * @returns {Object<string, Object>|null}
 */
function parseQuotaSummaryGroups(quotaSummaryResponse, now = Date.now()) {
  if (!quotaSummaryResponse || !Array.isArray(quotaSummaryResponse.groups)) {
    return null;
  }
  const groupMap = {};
  for (const g of quotaSummaryResponse.groups) {
    const gName = (g.displayName || '').toLowerCase();
    let groupKey = 'other';
    if (gName.includes('gemini')) groupKey = 'gemini';
    else if (gName.includes('claude') || gName.includes('gpt')) groupKey = '3p';

    const windows = {};
    for (const b of g.buckets || []) {
      const is5h = b.window === '5h' || b.bucketId?.includes('5h') || b.displayName?.toLowerCase().includes('five hour');
      const isWeekly = b.window === 'weekly' || b.bucketId?.includes('weekly') || b.displayName?.toLowerCase().includes('weekly');
      const windowKey = is5h ? 'fiveHour' : (isWeekly ? 'weekly' : null);
      if (!windowKey) continue;

      const remainingFraction = normalizeRemainingFraction(b.remainingFraction, !!b.resetTime);
      windows[windowKey] = {
        remainingFraction,
        resetTime: b.resetTime || null,
        observedAt: now,
      };
    }

    const critical = pickCriticalWindow(windows, now);
    groupMap[groupKey] = {
      groupKey,
      displayName: g.displayName,
      description: g.description,
      windows,
      critical,
    };
  }
  return groupMap;
}

/**
 * Resolve whether a model belongs to 'gemini', '3p' (Claude/GPT), or an individual bucket (e.g. image).
 * @param {string} modelId
 * @param {string} [displayName]
 * @returns {'gemini'|'3p'|null}
 */
function resolveModelGroup(modelId, displayName) {
  const text = `${modelId || ''} ${displayName || ''}`.toLowerCase();
  if (text.includes('image')) return null;
  if (text.includes('claude') || text.includes('gpt')) return '3p';
  if (text.includes('gemini') || text.includes('flash') || text.includes('pro')) return 'gemini';
  return null;
}

/**
 * Expand tiered models (e.g. gemini-3.8-flash-tiered) into high, medium, low variants.
 * @param {Object<string, Object>} models
 * @param {Object} tieredModelIds
 * @returns {Object<string, Object>}
 */
function expandTieredModels(models, tieredModelIds) {
  if (!tieredModelIds || typeof tieredModelIds !== 'object') return models;
  const out = { ...models };
  for (const [, list] of Object.entries(tieredModelIds)) {
    if (!Array.isArray(list)) continue;
    for (const tieredId of list) {
      const match = String(tieredId).match(/^(gemini-[\d.]+-flash)-tiered$/);
      if (match) {
        const prefix = match[1];
        const verMatch = prefix.match(/gemini-([\d.]+)-flash/);
        const ver = verMatch ? verMatch[1] : '';
        const baseQuota = models[tieredId]?.quotaInfo || {};
        const tiers = [
          { sub: 'high', label: 'High' },
          { sub: 'medium', label: 'Medium' },
          { sub: 'low', label: 'Low' },
        ];
        for (const { sub, label } of tiers) {
          const modelId = `${prefix}-${sub}`;
          if (!out[modelId]) {
            out[modelId] = {
              displayName: `Gemini ${ver} Flash (${label})`,
              modelProvider: 'MODEL_PROVIDER_GOOGLE',
              quotaInfo: { ...baseQuota },
            };
          }
        }
      }
    }
  }
  return out;
}

/**
 * Inject authoritative group windows and critical quotas into the normalized model list.
 * @param {ModelQuota[]} normalizedList
 * @param {Object<string, Object>} groupWindows
 * @param {number} [now]
 * @returns {ModelQuota[]}
 */
function applyQuotaSummaryToModels(normalizedList, groupWindows, now = Date.now()) {
  if (!groupWindows || typeof groupWindows !== 'object') return normalizedList;
  const results = [];
  const addedGroupKeys = new Set();

  for (const q of normalizedList) {
    const groupKey = resolveModelGroup(q.id, q.displayName);
    const group = groupKey ? groupWindows[groupKey] : null;
    if (group && group.windows) {
      const mergedWindows = { ...(q.windows || {}), ...(group.windows || {}) };
      const critical = pickCriticalWindow(mergedWindows, now) || group.critical || q;
      results.push({
        ...q,
        remainingFraction: critical.remainingFraction,
        resetTime: critical.resetTime,
        window: critical.window,
        windows: mergedWindows,
        groupKey,
      });
    } else {
      results.push(q);
    }
  }

  // Also include synthetic group-level entries for direct group references or fallbacks
  for (const [key, g] of Object.entries(groupWindows)) {
    const groupId = `group-${key}`;
    if (!addedGroupKeys.has(groupId) && g.windows) {
      addedGroupKeys.add(groupId);
      const critical = g.critical || pickCriticalWindow(g.windows, now);
      if (critical) {
        results.push({
          id: groupId,
          displayName: g.displayName || (key === 'gemini' ? 'Gemini Models' : 'Claude & GPT'),
          modelProvider: key === 'gemini' ? 'MODEL_PROVIDER_GOOGLE' : 'MODEL_PROVIDER_ANTHROPIC',
          remainingFraction: critical.remainingFraction,
          resetTime: critical.resetTime,
          window: critical.window,
          windows: g.windows,
          groupKey: key,
          isGroup: true,
        });
      }
    }
  }

  return results;
}

module.exports = {
  FALLBACK_AGENT_MODEL_IDS,
  FIVE_HOUR_WINDOW_THRESHOLD_MS,
  discoverAgentModelIds,
  resolveDeprecatedIds,
  normalizeRemainingFraction,
  normalizeQuotaModels,
  classifyQuotaWindow,
  isObservationExpired,
  pruneExpiredWindows,
  mergeQuotaWindows,
  pickCriticalWindow,
  createUnavailableQuotaResult,
  parseQuotaSummaryGroups,
  resolveModelGroup,
  expandTieredModels,
  applyQuotaSummaryToModels,
};
