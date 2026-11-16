// Revision-gated folds: across a restart, a session whose log did not change must
// not be read again, and every way that judgement can be wrong must fall back to
// reading. Each phase gets its own DSH_HOME so one phase cannot inherit another's
// stamps.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homes = [];
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-usage-gate-'));
  homes.push(home);
  process.env.DSH_HOME = home;
  return home;
}

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

const DAY = 86400000;
const now = Date.now() - 60 * 1000;

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

/**
 * A ctx over a mutable corpus plus a fake persistence service.
 *
 * `snapshots` maps a session id to the snapshot `sessionPersistence.list()` reports;
 * a missing entry means the backend does not know that session (or has no service).
 */
function harness({ corpus, snapshots, persistence = 'jsonl', observe = null, failReads = new Set() }) {
  const registered = [];
  const disposers = [];
  const listeners = new Set();
  const counts = { list: 0, read: 0, stat: 0, observe: 0 };
  const sessions = new Map(Object.entries(corpus));
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
        return [...sessions.keys()].map((id) => ({
          header: sessions.get(id).session,
          live: sessions.get(id).live === true,
          persisted: true,
        }));
      },
      readSession: async (id) => {
        counts.read += 1;
        if (failReads.has(id)) throw new Error('log busy');
        const entry = sessions.get(id);
        if (!entry) throw new Error('missing session');
        return { session: entry.session, inheritedEventCount: 0, events: entry.events };
      },
    },
  };
  if (observe !== null) {
    ctx.sessionQuery.observeSession = async (id) => {
      counts.observe += 1;
      const cursor = observe(id);
      if (cursor === undefined) throw new Error('no session');
      return {
        source: 'live',
        header: sessions.get(id).session,
        inheritedEventCount: 0,
        get events() { throw new Error('the gate must not materialize events'); },
        cursor,
        retain() { return this; },
        [Symbol.dispose]() {},
      };
    };
  }
  if (persistence !== null) {
    ctx.get = (name) => {
      if (name !== 'sessionPersistence') return undefined;
      return {
        list: async () => {
          counts.stat += 1;
          const out = [];
          for (const [id, snapshot] of Object.entries(snapshots())) {
            out.push({
              header: sessions.get(id) ? sessions.get(id).session : { id, cwd: 'E:\\work' },
              revision: snapshot.rev,
              sizeBytes: snapshot.size,
              location: { kind: snapshot.kind ?? 'jsonl', path: `E:\\logs\\${id}.jsonl.zstd` },
            });
          }
          return out;
        },
      };
    };
  }
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
    sessions,
    disposers,
    emit: (event, sessionId) => {
      for (const listener of listeners) {
        listener({ id: sessionId, header: { id: sessionId, cwd: 'E:\\work' } }, event);
      }
    },
  };
}

async function settle(get, url) {
  let payload = await get(url);
  let guard = 0;
  while (payload.scanning && guard < 200) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    payload = await get(url);
  }
  return payload;
}

/** Two sessions, each folded once, then a clean unload that writes folds.json. */
async function seed({ rev = 'r1', size = 100, events } = {}) {
  freshHome();
  const log = events ?? [message(1, now - DAY, 'model-a', 6, 4)];
  const probe = harness({
    corpus: {
      'session-1': { session: { id: 'session-1', cwd: 'E:\\work' }, events: log },
      'session-2': { session: { id: 'session-2', cwd: 'E:\\work' }, events: [message(1, now, 'model-b', 30, 20)] },
    },
    snapshots: () => ({
      'session-1': { rev, size },
      'session-2': { rev, size },
    }),
  });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const payload = await settle(probe.get, '/usage-stats/summary?range=7');
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  return { probe, payload, foldsFile: join(process.env.DSH_HOME, 'usage-stats', 'folds.json') };
}

function reopen({ rev, size, events, kind = 'jsonl', observe, failReads = new Set(), persistence = 'jsonl' }) {
  const probe = harness({
    corpus: {
      'session-1': { session: { id: 'session-1', cwd: 'E:\\work' }, events: events ?? [message(1, now - DAY, 'model-a', 6, 4)] },
      'session-2': { session: { id: 'session-2', cwd: 'E:\\work' }, events: [message(1, now, 'model-b', 30, 20)] },
    },
    snapshots: () => ({
      'session-1': { rev, size, kind },
      'session-2': { rev, size, kind },
    }),
    observe,
    failReads,
    persistence,
  });
  return probe;
}

// --- 1. an unchanged corpus is not read again --------------------------------
{
  const { payload, foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  check('seed folded both sessions', payload.summary.totalTokens === 60, payload.summary.totalTokens);
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('seed wrote a stamp per session', saved.sessions['session-1'].rev === 'rev-a', saved.sessions['session-1']);
  check('seed wrote the size beside the stamp', saved.sessions['session-1'].size === 100, saved.sessions['session-1']);
  check('seed wrote the backend kind', saved.sessions['session-1'].kind === 'jsonl', saved.sessions['session-1']);

  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const warm = await settle(probe.get, '/usage-stats/summary?range=7');
  check('unchanged corpus answered from the stored folds', warm.summary.totalTokens === 60, warm.summary.totalTokens);
  check('unchanged corpus read no log', probe.counts.read === 0, probe.counts);
  check('unchanged corpus still listed once', probe.counts.list === 1, probe.counts);
  check('unchanged corpus asked for stamps once', probe.counts.stat === 1, probe.counts);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
}

// --- 2. a changed revision re-reads exactly that session ---------------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  // Only session-2 moved.
  writeFileSync(foldsFile, JSON.stringify({
    ...saved,
    sessions: {
      'session-1': saved.sessions['session-1'],
      'session-2': { ...saved.sessions['session-2'], rev: 'stale-rev' },
    },
  }));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const warm = await settle(probe.get, '/usage-stats/summary?range=7');
  check('changed session is re-read', probe.counts.read === 1, probe.counts);
  check('unchanged session is not re-read', warm.summary.totalTokens === 60, warm.summary.totalTokens);
  // The file is written by the debounced flush, so a clean unload is what makes
  // the on-disk state observable.
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  const after = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('re-read session gets the fresh stamp', after.sessions['session-2'].rev === 'rev-a', after.sessions['session-2']);
  check('untouched session keeps its stamp', after.sessions['session-1'].rev === 'rev-a', after.sessions['session-1']);
}

// --- 3. a size mismatch re-reads even when the revision matches --------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  writeFileSync(foldsFile, JSON.stringify({
    ...saved,
    sessions: {
      ...saved.sessions,
      'session-1': { ...saved.sessions['session-1'], size: 999 },
    },
  }));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  await settle(probe.get, '/usage-stats/summary?range=7');
  check('size mismatch forces a read', probe.counts.read === 1, probe.counts);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
}

// --- 4. an untrusted backend kind is never skipped ---------------------------
{
  await seed({ rev: 'rev-a', size: 100 });
  const probe = reopen({ rev: 'rev-a', size: 100, kind: 'sqlite' });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  await settle(probe.get, '/usage-stats/summary?range=7');
  check('unknown backend kind reads everything', probe.counts.read === 2, probe.counts);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
}

// --- 5. no persistence service behaves exactly like before -------------------
{
  await seed({ rev: 'rev-a', size: 100 });
  const probe = reopen({ rev: 'rev-a', size: 100, persistence: null });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const warm = await settle(probe.get, '/usage-stats/summary?range=7');
  check('no persistence service still folds correctly', warm.summary.totalTokens === 60, warm.summary.totalTokens);
  check('no persistence service reads every log', probe.counts.read === 2, probe.counts);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
}

// --- 6. a fold-semantics bump re-folds everything ---------------------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  writeFileSync(foldsFile, JSON.stringify({ ...saved, logic: 0 }));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const warm = await settle(probe.get, '/usage-stats/summary?range=7');
  check('a logic bump re-reads every log', probe.counts.read === 2, probe.counts);
  check('a logic bump keeps the numbers correct', warm.summary.totalTokens === 60, warm.summary.totalTokens);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  const after = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('a completed full pass records the new logic', after.logic === 1, after.logic);
}

// --- 7. a stamp is never written for a fold that did not happen -------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  // Forget session-1's stamp, and make its read fail: nothing may reinstate it.
  writeFileSync(foldsFile, JSON.stringify({
    ...saved,
    sessions: {
      'session-1': { seq: saved.sessions['session-1'].seq, cell: saved.sessions['session-1'].cell },
      'session-2': saved.sessions['session-2'],
    },
  }));
  const failing = reopen({ rev: 'rev-b', size: 200, failReads: new Set(['session-1']) });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(failing.ctx);
  const afterFail = await settle(failing.get, '/usage-stats/summary?range=7');
  check('a failed read keeps the previous numbers', afterFail.summary.totalTokens === 60, afterFail.summary.totalTokens);
  for (const dispose of failing.disposers.slice().reverse()) dispose();
  const written = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('a failed read must not record a stamp', written.sessions['session-1'].rev === undefined, written.sessions['session-1']);

  // The same session read successfully afterwards does earn one.
  const working = reopen({ rev: 'rev-b', size: 200 });
  const second = await import(`../index.js?gate=${Math.random()}`);
  second.apply(working.ctx);
  await settle(working.get, '/usage-stats/summary?range=7');
  for (const dispose of working.disposers.slice().reverse()) dispose();
  const healed = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('a later successful read records the stamp', healed.sessions['session-1'].rev === 'rev-b', healed.sessions['session-1']);
}

// --- 8. a live session is gated by its cursor, not by a file stamp ----------
{
  freshHome();
  const log = [message(1, now - DAY, 'model-a', 6, 4), message(2, now, 'model-a', 60, 40)];
  // `cursor` is the last observed event seq: the folded log ends at seq 2.
  const first = harness({
    corpus: { 'session-1': { session: { id: 'session-1', cwd: 'E:\\work' }, events: log, live: true } },
    snapshots: () => ({ 'session-1': { rev: 'rev-a', size: 100 } }),
    observe: () => 2,
  });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(first.ctx);
  const seeded = await settle(first.get, '/usage-stats/summary?range=7');
  check('live seed folded the log', seeded.summary.totalTokens === 110, seeded.summary.totalTokens);
  for (const dispose of first.disposers.slice().reverse()) dispose();

  // Same cursor (the fold ends at seq 2) and an unchanged file: skip.
  const sameCursor = harness({
    corpus: { 'session-1': { session: { id: 'session-1', cwd: 'E:\\work' }, events: log, live: true } },
    snapshots: () => ({ 'session-1': { rev: 'rev-a', size: 100 } }),
    observe: () => 2,
  });
  const second = await import(`../index.js?gate=${Math.random()}`);
  second.apply(sameCursor.ctx);
  const skipped = await settle(sameCursor.get, '/usage-stats/summary?range=7');
  check('a live session whose cursor matches is not re-read', sameCursor.counts.read === 0, sameCursor.counts);
  check('a skipped live session keeps its numbers', skipped.summary.totalTokens === 110, skipped.summary.totalTokens);
  for (const dispose of sameCursor.disposers.slice().reverse()) dispose();

  // A cursor ahead of the stored fold means the log grew while we were away.
  const movedOn = harness({
    corpus: { 'session-1': { session: { id: 'session-1', cwd: 'E:\\work' }, events: log, live: true } },
    snapshots: () => ({ 'session-1': { rev: 'rev-b', size: 300 } }),
    observe: () => 5,
  });
  const third = await import(`../index.js?gate=${Math.random()}`);
  third.apply(movedOn.ctx);
  await settle(movedOn.get, '/usage-stats/summary?range=7');
  check('a live session whose cursor moved is re-read', movedOn.counts.read === 1, movedOn.counts);
  for (const dispose of movedOn.disposers.slice().reverse()) dispose();
}

// --- 9. refresh ignores every stamp ----------------------------------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  await settle(probe.get, '/usage-stats/summary?range=7');
  check('the warm start read nothing', probe.counts.read === 0, probe.counts);
  // `refresh=1` is honoured on the first request only; polling it again would
  // legitimately start a new full pass every time.
  await probe.get('/usage-stats/summary?range=7&refresh=1');
  const forced = await settle(probe.get, '/usage-stats/summary?range=7');
  check('refresh re-reads every log', probe.counts.read === 2, probe.counts);
  check('refresh keeps the numbers', forced.summary.totalTokens === 60, forced.summary.totalTokens);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  const after = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('refresh restamps', after.sessions['session-1'].rev === 'rev-a', after.sessions['session-1']);
  check('refresh keeps the seed logic', after.logic === saved.logic, after.logic);
}

// --- 10. the weekly backstop re-reads once ---------------------------------
{
  const { foldsFile } = await seed({ rev: 'rev-a', size: 100 });
  const saved = JSON.parse(readFileSync(foldsFile, 'utf8'));
  writeFileSync(foldsFile, JSON.stringify({ ...saved, lastFullAt: Date.now() - 8 * DAY }));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const warm = await settle(probe.get, '/usage-stats/summary?range=7');
  check('a week-old stamp set is re-read once', probe.counts.read === 2, probe.counts);
  check('the weekly backstop keeps the numbers', warm.summary.totalTokens === 60, warm.summary.totalTokens);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  const after = JSON.parse(readFileSync(foldsFile, 'utf8'));
  check('the weekly backstop refreshes its timestamp', after.lastFullAt > saved.lastFullAt, [after.lastFullAt, saved.lastFullAt]);
}

// --- 11. an older file is upgraded, not discarded --------------------------
{
  const home = freshHome();
  const dir = join(home, 'usage-stats');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const cell = {
    tokens: 60, input: 36, output: 24, cacheRead: 0, cacheWrite: 0,
    requests: 2, messages: 2, cwd: 'E:\\work', sub: false, seq: 1, days: {}, models: {},
  };
  writeFileSync(join(dir, 'folds.json'), JSON.stringify({
    version: 1,
    sessions: { 'session-1': { seq: 1, cell } },
  }));
  const probe = reopen({ rev: 'rev-a', size: 100 });
  const module = await import(`../index.js?gate=${Math.random()}`);
  module.apply(probe.ctx);
  const first = await probe.get('/usage-stats/summary?range=7');
  check('a version 1 file still warms the first paint', first.summary.totalTokens === 60, first.summary.totalTokens);
  const settled = await settle(probe.get, '/usage-stats/summary?range=7');
  check('a version 1 file is re-read once', probe.counts.read >= 1, probe.counts);
  check('a version 1 file keeps correct numbers after the pass', settled.summary.totalTokens === 60, settled.summary.totalTokens);
  for (const dispose of probe.disposers.slice().reverse()) dispose();
  const after = JSON.parse(readFileSync(join(dir, 'folds.json'), 'utf8'));
  check('the upgraded file records stamps', after.sessions['session-1'].rev === 'rev-a', after.sessions['session-1']);
}

for (const home of homes) rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('gate OK:', JSON.stringify({ scenarios: 11 }));
