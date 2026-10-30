// Node-side check of the host half: fold semantics, fork dedupe, filters,
// heatmap/trend windows, and the route contract.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from '../index.js';

// Keep the run isolated from the developer's real DSH_HOME: `apply()` restores
// the rolling call window from `$DSH_HOME/usage-stats/recent-calls.json`.
const home = mkdtempSync(join(tmpdir(), 'dsh-usage-host-'));
process.env.DSH_HOME = home;

function event(seq, time, usage, model) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek', model } },
      stream: [],
      ...(usage === null ? {} : { usage }),
    },
  };
}

// Relative to the run time: the trend window and heatmap are anchored on today,
// so fixed dates would rot after a day.
const day2 = Date.now();
const day1 = day2 - 86400000;

const sessions = new Map([
  ['s1', {
    session: { id: 's1', cwd: 'E:\\work\\alpha' },
    inheritedEventCount: 0,
    events: [
      { type: 'turn/start', seq: 1, time: day1, data: { turn: 1 } },
      event(2, day1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10, reasoningTokens: 40 }, 'deepseek-v4'),
      event(3, day1, null, 'deepseek-v4'),
      event(4, day2, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100 }, 'deepseek-v4'),
      event(5, day2, { inputTokens: 10, outputTokens: 5 }, 'deepseek-v4-mini'),
    ],
  }],
  // Fork: the inherited prefix must not be counted again, and a user fork stays
  // a main task (`origin` is what marks an agent-spawned subtask).
  ['s2', {
    session: { id: 's2', cwd: 'E:\\work\\alpha', parentSession: 's1', isSeeded: true },
    inheritedEventCount: 2,
    events: [
      event(1, day1, { inputTokens: 999, outputTokens: 999 }, 'inherited'),
      event(2, day1, { inputTokens: 999, outputTokens: 999 }, 'inherited'),
      event(3, day2, { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'deepseek-v4'),
    ],
  }],
  ['s3', {
    session: { id: 's3', cwd: 'E:\\work\\beta' },
    inheritedEventCount: 0,
    events: [event(1, day1, { inputTokens: 300, outputTokens: 200 }, 'deepseek-v4-pro')],
  }],
  // Subagent: a positive delegation depth alone marks it, even without `origin`
  // (the `origin: 'subagent'` path is covered by the live-event case in calls.test).
  ['s4', {
    session: { id: 's4', cwd: 'E:\\work\\beta', delegationDepth: 1, parentSession: 's3' },
    inheritedEventCount: 0,
    events: [event(1, day2, { inputTokens: 11, outputTokens: 9 }, 'deepseek-v4-mini')],
  }],
  ['broken', { error: new Error('unreadable') }],
]);

const registered = [];
const ctx = {
  effect: (callback) => { callback(); return () => {}; },
  on: () => () => {},
  webServer: {
    register: (route) => {
      registered.push(route);
      return () => {};
    },
  },
  connection: { requestRejection: () => undefined },
  sessionQuery: {
    listSessions: async () => [...sessions.keys()].map((id) => ({ header: { id }, live: false, persisted: true })),
    readSession: async (id) => {
      const entry = sessions.get(id);
      if (!entry || entry.error) throw entry.error || new Error('missing');
      return entry;
    },
  },
};

if (name !== 'usage-stats') throw new Error('unexpected plugin name');
if (inject.join(',') !== 'webServer,connection,sessionQuery') throw new Error('unexpected inject');

apply(ctx);
if (registered.length !== 1) throw new Error('expected one route');
const route = registered[0];
if (route.kind !== 'exact' || route.path !== '/usage-stats/summary') throw new Error(`unexpected route ${route.kind} ${route.path}`);

function call(method, url) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(key, value) { this.headers[key] = value; },
      end(chunk) {
        this.body = chunk === undefined ? '' : String(chunk);
        try {
          resolve({ status: this.statusCode, headers: this.headers, json: this.body ? JSON.parse(this.body) : null });
        } catch (cause) { reject(cause); }
      },
    };
    Promise.resolve(route.handler({ method, url, headers: {} }, res)).catch(reject);
  });
}

let payload = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const response = await call('GET', '/usage-stats/summary?range=7');
  if (response.status !== 200) throw new Error(`status ${response.status}`);
  payload = response.json;
  if (!payload.scanning) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const fail = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// Fold semantics.
check('payload version', payload.version, 2);
check('scan finished', payload.scanning, false);
check('total tokens', payload.summary.totalTokens, 2525);
check('cache read', payload.summary.cacheReadTokens, 220);
check('requests', payload.summary.requests, 6);
check('messages', payload.summary.messages, 7);
check('sessions', payload.summary.sessions, 4);
check('sub sessions', payload.summary.subSessions, 1);
check('active days', payload.summary.activeDays, 2);
check('inherited prefix skipped', payload.models.some((entry) => entry.model === 'inherited'), false);
check('top model', payload.summary.topModel.model, 'deepseek-v4');
check('top model tokens', payload.summary.topModel.tokens, 1990);
check('composition input', payload.composition.input, 100 + 1000 + 10 + 7 + 300 + 11);
check('composition output', payload.composition.output, 50 + 500 + 5 + 3 + 200 + 9);

// Windows.
const todayKey = (() => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `${now.getFullYear()}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
})();
check('trend days', payload.daily.length, 7);
check('trend last day is today', payload.daily[6].day, todayKey);
check('trend today tokens', payload.daily[6].tokens, 1845);
check('heatmap cells', payload.heatmap.length, 371);
check('heatmap starts Sunday', new Date(`${payload.heatmap[0].day}T00:00:00`).getDay(), 0);
const heatToday = payload.heatmap.filter((entry) => entry.day === todayKey)[0];
check('heatmap today tokens', heatToday.tokens, 1845);
check('heatmap has no future usage', payload.heatmap.filter((entry) => entry.future && entry.tokens > 0).length, 0);
check('current streak', payload.summary.currentStreakDays, 2);
check('longest streak', payload.summary.longestStreakDays, 2);

// Filters.
check('range 30 days', (await call('GET', '/usage-stats/summary?range=30')).json.daily.length, 30);
check('unknown range falls back', (await call('GET', '/usage-stats/summary?range=999')).json.selection.range, 30);
const beta = (await call('GET', '/usage-stats/summary?range=7&cwd=' + encodeURIComponent('E:\\work\\beta'))).json;
check('cwd filter tokens', beta.summary.totalTokens, 520);
check('cwd filter sessions', beta.summary.sessions, 2);
const rootOnly = (await call('GET', '/usage-stats/summary?range=7&scope=root')).json;
check('root-only sessions', rootOnly.summary.sessions, 3);
check('root-only excludes subagent', rootOnly.summary.subSessions, 0);
check('root-only keeps the fork', rootOnly.summary.totalTokens, 2505);
const subOnly = (await call('GET', '/usage-stats/summary?range=7&scope=sub')).json;
check('sub-only sessions', subOnly.summary.sessions, 1);
check('sub-only tokens', subOnly.summary.totalTokens, 20);
check('filter options list workspaces', payload.filters.cwds.length, 2);
check('filter options scopes', payload.filters.scopes, { all: 4, root: 3, sub: 1 });

// Route contract.
check('POST rejected', (await call('POST', '/usage-stats/summary')).status, 405);
check('refresh accepted', (await call('GET', '/usage-stats/summary?refresh=1&range=7')).status, 200);

await new Promise((resolve) => setTimeout(resolve, 80));

rmSync(home, { recursive: true, force: true });

if (fail.length > 0) {
  console.error('FAILED\n' + fail.join('\n'));
  process.exit(1);
}
console.log('host half OK:', JSON.stringify({
  tokens: payload.summary.totalTokens,
  sessions: payload.summary.sessions,
  daily: payload.daily.length,
  heatmap: payload.heatmap.length,
  models: payload.models.map((entry) => entry.model),
}));
