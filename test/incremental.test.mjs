// Incremental aggregation: once a session is folded, its usage must keep growing
// from the live `session/event` feed alone — no re-read, no periodic rescan — and
// the result must equal a full fold of the same events.
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-usage-incremental-'));
process.env.DSH_HOME = home;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

const DAY = 86400000;

function message(seq, time, model, input, output) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { role: 'assistant', source: { kind: 'model', provider: 'p', model } },
      stream: [],
      usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
  };
}

const now = Date.now() - 60 * 1000;
const firstTwo = [message(1, now - 2 * DAY, 'model-a', 6, 4), message(2, now - DAY, 'model-b', 3, 2)];
const third = message(3, now, 'model-a', 60, 40);

/** A ctx whose corpus is a mutable set of sessions, with call counters. */
function harness({ events, failReads = false }) {
  const registered = [];
  const disposers = [];
  const listeners = new Set();
  const counts = { list: 0, read: 0 };
  const corpus = new Map([['session-1', { session: { id: 'session-1', cwd: 'E:\\work' }, events }]]);
  const ctx = {
    effect: (callback) => {
      const dispose = callback();
      const wrapped = typeof dispose === 'function' ? dispose : () => {};
      disposers.push(wrapped);
      return wrapped;
    },
    on: (name, handler) => {
      if (name === 'session/event') listeners.add(handler);
      return () => { listeners.delete(handler); };
    },
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    connection: { requestRejection: () => undefined },
    sessionQuery: {
      listSessions: async () => {
        counts.list += 1;
        return [...corpus.keys()].map((id) => ({ header: { id, cwd: 'E:\\work' }, live: false, persisted: true }));
      },
      readSession: async (id) => {
        counts.read += 1;
        if (failReads) throw new Error('log busy');
        const entry = corpus.get(id);
        if (!entry) throw new Error('missing session');
        return { session: entry.session, inheritedEventCount: 0, events: entry.events };
      },
    },
  };
  const get = (url) => new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      setHeader() {},
      end(chunk) {
        try { resolve(JSON.parse(String(chunk || '{}'))); } catch (cause) { reject(cause); }
      },
    };
    Promise.resolve(registered[registered.length - 1].handler({ method: 'GET', url, headers: {} }, res)).catch(reject);
  });
  return {
    ctx,
    get,
    counts,
    disposers,
    corpus,
    emit: (event, sessionId = 'session-1') => {
      for (const listener of listeners) {
        listener({ id: sessionId, header: { id: sessionId, cwd: 'E:\\work' } }, event);
      }
    },
  };
}

async function settle(get, url) {
  let payload = await get(url);
  let guard = 0;
  while (payload.scanning && guard < 100) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    payload = await get(url);
    guard += 1;
  }
  return payload;
}

// Each phase gets its own DSH_HOME: a persisted fold from another phase would
// legitimately win over a smaller log (that is the cursor protection working).
const homes = { live: mkdtempSync(join(tmpdir(), 'dsh-incr-live-')), full: mkdtempSync(join(tmpdir(), 'dsh-incr-full-')), fresh: mkdtempSync(join(tmpdir(), 'dsh-incr-fresh-')) };
function useHome(path) {
  process.env.DSH_HOME = path;
}

// --- 1. live events grow the aggregate without any re-read ---------------------
useHome(homes.live);
const live = harness({ events: firstTwo });
const liveModule = await import('../index.js?incr=live');
liveModule.apply(live.ctx);
const initial = await settle(live.get, '/usage-stats/summary?range=7');
check('first pass folds the log', initial.summary.totalTokens === 15, initial.summary.totalTokens);
check('first pass read the log once', live.counts.read === 1, live.counts);

live.emit(third);
const grown = await live.get('/usage-stats/summary?range=7');
check('live event is counted immediately', grown.summary.totalTokens === 115, grown.summary.totalTokens);
check('live event did not trigger a re-read', live.counts.read === 1, live.counts);
check('live event did not trigger a new listing', live.counts.list === 1, live.counts);
const morning = grown.daily.find((day) => day.models['model-a'] !== undefined && day.tokens > 50);
check('live event landed on its own day', morning !== undefined, grown.daily.map((day) => day.tokens));

// --- 2. equality with a full fold of the same events --------------------------
useHome(homes.full);
const full = harness({ events: [...firstTwo, third] });
const fullModule = await import('../index.js?incr=full');
fullModule.apply(full.ctx);
const folded = await settle(full.get, '/usage-stats/summary?range=7');
for (const field of ['totalTokens', 'inputTokens', 'outputTokens', 'requests', 'messages', 'sessions']) {
  check(`incremental equals fold: ${field}`, grown.summary[field] === folded.summary[field], [grown.summary[field], folded.summary[field]]);
}
check('incremental equals fold: models', JSON.stringify(grown.models) === JSON.stringify(folded.models), [grown.models, folded.models]);
check('incremental equals fold: daily', JSON.stringify(grown.daily) === JSON.stringify(folded.daily), 'daily differs');
check('incremental equals fold: composition', JSON.stringify(grown.composition) === JSON.stringify(folded.composition), [grown.composition, folded.composition]);
check('incremental equals fold: range tokens', grown.rangeTokens === folded.rangeTokens, [grown.rangeTokens, folded.rangeTokens]);
check('incremental equals fold: heatmap', JSON.stringify(grown.heatmap) === JSON.stringify(folded.heatmap), 'heatmap differs');

// --- 3. warm start: persisted folds answer before any read succeeds -----------
useHome(homes.live);
for (const dispose of live.disposers.slice().reverse()) dispose();
const foldsFile = join(homes.live, 'usage-stats', 'folds.json');
check('folds are persisted on unload', existsSync(foldsFile), existsSync(foldsFile));
const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
const foldsBytes = readFileSync(foldsFile).length;
check('folds file has a version', saved.version === 1, saved.version);
check('folds file keeps the folded cell', saved.sessions['session-1'] && saved.sessions['session-1'].cell.tokens === 115, Object.keys(saved.sessions));

const warm = harness({ events: [...firstTwo, third], failReads: true });
const warmModule = await import('../index.js?incr=warm');
warmModule.apply(warm.ctx);
const firstPaint = await warm.get('/usage-stats/summary?range=7');
check('warm start renders persisted numbers at once', firstPaint.summary.totalTokens === 115, firstPaint.summary.totalTokens);
const warmSettled = await settle(warm.get, '/usage-stats/summary?range=7');
check('a failed read keeps the persisted numbers', warmSettled.summary.totalTokens === 115, warmSettled.summary.totalTokens);
check('a failed read is not retried on every request', warm.counts.read >= 1, warm.counts);

// --- 4. a brand new session triggers exactly one pass ------------------------
useHome(homes.fresh);
const fresh = harness({ events: firstTwo });
const freshModule = await import('../index.js?incr=fresh');
freshModule.apply(fresh.ctx);
const seeded = await settle(fresh.get, '/usage-stats/summary?range=7');
check('fresh corpus folded', seeded.summary.totalTokens === 15, seeded.summary.totalTokens);
const listBefore = fresh.counts.list;
const readBefore = fresh.counts.read;

// A second session appears: its first live event cannot be applied (no cell), so
// the next request folds just that one.
const secondEvents = [message(1, now, 'model-c', 30, 20)];
fresh.corpus.set('session-2', { session: { id: 'session-2', cwd: 'E:\\work' }, events: secondEvents });
fresh.emit(secondEvents[0], 'session-2');
const withNew = await settle(fresh.get, '/usage-stats/summary?range=7');
check('new session triggered one listing', fresh.counts.list === listBefore + 1, fresh.counts);
check('new session was read once', fresh.counts.read === readBefore + 1, fresh.counts);
check('new session usage is included', withNew.summary.totalTokens === 65, withNew.summary.totalTokens);
check('known session was not re-read', withNew.summary.sessions === 2, withNew.summary.sessions);

useHome(homes.fresh);
for (const dispose of warm.disposers.slice().reverse()) dispose();
for (const dispose of full.disposers.slice().reverse()) dispose();
for (const dispose of fresh.disposers.slice().reverse()) dispose();
for (const dir of Object.values(homes)) rmSync(dir, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('incremental OK:', JSON.stringify({
  foldedTokens: initial.summary.totalTokens,
  afterLiveEvent: grown.summary.totalTokens,
  readSessions: live.counts.read,
  listings: live.counts.list,
  warmStartTokens: firstPaint.summary.totalTokens,
  foldsBytes,
  sessionsAfterNew: withNew.summary.sessions,
}));
