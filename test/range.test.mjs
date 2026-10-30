// Range scoping: the model donut and the token composition must describe the
// selected window, while the cards keep reporting lifetime figures.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-usage-range-'));
process.env.DSH_HOME = home;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

const DAY = 86400000;
const now = Date.now();

function usage(inputTokens, outputTokens) {
  return { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function message(time, model, tokens) {
  return {
    type: 'assistant/message',
    seq: 1,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', source: { kind: 'model', provider: 'p', model } },
      stream: [],
      usage: tokens,
    },
  };
}

const sessions = {
  recent: {
    session: { id: 'recent', cwd: 'E:\\work' },
    inheritedEventCount: 0,
    events: [message(now, 'recent-model', usage(60, 40))],
  },
  mid: {
    session: { id: 'mid', cwd: 'E:\\work' },
    inheritedEventCount: 0,
    events: [message(now - 10 * DAY, 'mid-model', usage(120, 80))],
  },
  old: {
    session: { id: 'old', cwd: 'E:\\work' },
    inheritedEventCount: 0,
    events: [message(now - 40 * DAY, 'old-model', usage(300, 100))],
  },
};

const registered = [];
const disposers = [];
const ctx = {
  effect: (callback) => {
    const dispose = callback();
    const wrapped = typeof dispose === 'function' ? dispose : () => {};
    disposers.push(wrapped);
    return wrapped;
  },
  on: () => () => {},
  webServer: { register: (route) => { registered.push(route); return () => {}; } },
  connection: { requestRejection: () => undefined },
  sessionQuery: {
    listSessions: async () => Object.keys(sessions).map((id) => ({ header: sessions[id].session, live: false, persisted: true })),
    readSession: async (id) => sessions[id],
  },
};

const plugin = await import('../index.js?range=1');
plugin.apply(ctx);

const get = (url) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk) {
      try { resolve(JSON.parse(String(chunk || '{}'))); } catch (cause) { reject(cause); }
    },
  };
  Promise.resolve(registered[0].handler({ method: 'GET', url, headers: {} }, res)).catch(reject);
});

const week = await get('/usage-stats/summary?range=7');
await new Promise((resolve) => setTimeout(resolve, 40));
const weekSettled = await get('/usage-stats/summary?range=7');
const month = await get('/usage-stats/summary?range=30');

// Cards: lifetime.
check('lifetime total covers every session', weekSettled.summary.totalTokens === 700, weekSettled.summary.totalTokens);
check('lifetime top model is the oldest heavy one', weekSettled.summary.topModel && weekSettled.summary.topModel.model === 'old-model', weekSettled.summary.topModel);

// 7 days: only the newest session's model and tokens.
check('7d models exclude older models', JSON.stringify(weekSettled.models.map((entry) => entry.model)) === JSON.stringify(['recent-model']), weekSettled.models);
check('7d model tokens', weekSettled.models[0] && weekSettled.models[0].tokens === 100, weekSettled.models[0]);
check('7d model share is over the range', weekSettled.models[0] && weekSettled.models[0].share === 1, weekSettled.models[0] && weekSettled.models[0].share);
check('7d range tokens', weekSettled.rangeTokens === 100, weekSettled.rangeTokens);
check('7d composition is the range only', JSON.stringify(weekSettled.composition) === JSON.stringify({ input: 60, output: 40, cacheRead: 0, cacheWrite: 0 }), weekSettled.composition);
check('lifetime composition stays separate', JSON.stringify(weekSettled.lifetimeComposition) === JSON.stringify({ input: 480, output: 220, cacheRead: 0, cacheWrite: 0 }), weekSettled.lifetimeComposition);

// 30 days: the model from ten days ago joins, the oldest one still does not.
check('30d models cover the window', JSON.stringify(month.models.map((entry) => entry.model).sort()) === JSON.stringify(['mid-model', 'recent-model']), month.models);
check('30d range tokens', month.rangeTokens === 300, month.rangeTokens);
check('30d composition adds the mid session', JSON.stringify(month.composition) === JSON.stringify({ input: 180, output: 120, cacheRead: 0, cacheWrite: 0 }), month.composition);
check('30d share reflects the range', month.models.find((entry) => entry.model === 'mid-model').share > 0.6, month.models);

// The trend keeps per-day numbers (the wire shape did not change).
check('daily models are plain token counts', weekSettled.daily.every((day) => Object.values(day.models).every((value) => typeof value === 'number')), weekSettled.daily.map((day) => day.models));
check('unused ranges still echo the request', week.selection.range === 7, week.selection);

for (const dispose of disposers.slice().reverse()) dispose();
rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('range OK:', JSON.stringify({
  lifetimeTokens: weekSettled.summary.totalTokens,
  weekModels: weekSettled.models.map((entry) => entry.model),
  weekTokens: weekSettled.rangeTokens,
  monthModels: month.models.map((entry) => entry.model),
  monthTokens: month.rangeTokens,
}));
