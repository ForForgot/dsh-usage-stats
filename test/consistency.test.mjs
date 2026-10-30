// Merge consistency between the log fold and the live event feed: the cases
// where an incremental aggregate can silently lose or double count usage.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

function homeFor(name) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-consistency-${name}-`));
  process.env.DSH_HOME = dir;
  return dir;
}

function message(seq, time, model, usage) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { role: 'assistant', source: { kind: 'model', provider: 'p', model } },
      stream: [],
      ...(usage === null ? {} : { usage }),
    },
  };
}

const tokens = (input, output) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 });
const now = Date.now() - 1000;

/**
 * Corpus harness.
 * `listings` may be a function of the call index to script a changing listing;
 * `onRead` runs inside `readSession` so a live event can be committed mid-read;
 * `readDelay` (ms per id) makes one session read much slower than its batch peers.
 */
function harness({ sessions, listings, onRead, readDelay }) {
  const registered = [];
  const disposers = [];
  const listeners = new Set();
  const counts = { list: 0, read: 0 };
  const corpus = new Map(Object.entries(sessions).map(([id, events]) => [id, { session: { id, cwd: 'E:\\work' }, events: [...events] }]));
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
        if (typeof listings === 'function') return listings(counts.list).map((id) => ({ header: { id, cwd: 'E:\\work' }, live: false, persisted: true }));
        return [...corpus.keys()].map((id) => ({ header: { id, cwd: 'E:\\work' }, live: false, persisted: true }));
      },
      readSession: async (id) => {
        counts.read += 1;
        const entry = corpus.get(id);
        if (!entry) throw new Error('missing session');
        // Copy BEFORE the hook runs: the returned snapshot must not contain an
        // event committed while the read is in flight, or the tail replay path
        // would never be exercised.
        const snapshot = [...entry.events];
        if (readDelay && typeof readDelay[id] === 'number') {
          await new Promise((resolve) => setTimeout(resolve, readDelay[id]));
        }
        if (typeof onRead === 'function') onRead(id, counts.read);
        return { session: entry.session, inheritedEventCount: 0, events: snapshot };
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
    emit: (event, sessionId) => {
      for (const listener of listeners) {
        listener({ id: sessionId, header: { id: sessionId, cwd: 'E:\\work' } }, event);
      }
    },
  };
}

async function settle(get, url = '/usage-stats/summary?range=7') {
  let payload = await get(url);
  let guard = 0;
  while (payload.scanning && guard < 120) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    payload = await get(url);
    guard += 1;
  }
  return payload;
}

// --- 1. a message without usage still counts toward `messages` ----------------
{
  const home = homeFor('messages');
  const withUsage = message(1, now - 60000, 'model-a', tokens(9, 6));
  const withoutUsage = message(2, now - 30000, 'model-a', null);
  const live = harness({ sessions: { 'session-1': [withUsage, withoutUsage] } });
  const module = await import('../index.js?consistency=messages');
  module.apply(live.ctx);
  const folded = await settle(live.get);
  check('fold counts a usage-less message', folded.summary.messages === 2, folded.summary.messages);

  const liveOnly = message(3, now, 'model-a', null);
  live.corpus.get('session-1').events.push(liveOnly);
  live.emit(liveOnly, 'session-1');
  const afterLive = await live.get('/usage-stats/summary?range=7');
  check('live counts a usage-less message too', afterLive.summary.messages === 3, afterLive.summary.messages);
  check('tokens are unchanged by a usage-less message', afterLive.summary.totalTokens === 15, afterLive.summary.totalTokens);
  check('no re-read was needed', live.counts.read === 1, live.counts);

  // Reference: folding the same three events from a fresh corpus.
  const reference = harness({ sessions: { 'session-1': [withUsage, withoutUsage, liveOnly] } });
  const referenceModule = await import('../index.js?consistency=messages-ref');
  referenceModule.apply(reference.ctx);
  const referencePayload = await settle(reference.get);
  check('live messages equal folded messages', afterLive.summary.messages === referencePayload.summary.messages, [afterLive.summary.messages, referencePayload.summary.messages]);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  for (const dispose of reference.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 2. an event committed while the log is being read must survive -----------
{
  const home = homeFor('race');
  const first = message(1, now - 60000, 'model-a', tokens(9, 6));
  const midRead = message(2, now, 'model-a', tokens(60, 40));
  const live = harness({
    sessions: { 'session-1': [first] },
    onRead: (id) => {
      // Commit during the read: the fold's snapshot does not contain it yet.
      live.corpus.get(id).events.push(midRead);
      live.emit(midRead, id);
    },
  });
  const module = await import('../index.js?consistency=race');
  module.apply(live.ctx);
  const raced = await settle(live.get);
  check('event committed during the read is not lost', raced.summary.totalTokens === 115, raced.summary.totalTokens);
  check('raced event counted once', raced.summary.messages === 2, raced.summary.messages);
  const again = await live.get('/usage-stats/summary?range=7');
  check('raced event is not double counted', again.summary.totalTokens === 115, again.summary.totalTokens);
  check('race did not need a second read', live.counts.read === 1, live.counts);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 2b. batch window: a fast session's live event, while a slow peer reads --
{
  const home = homeFor('batch');
  const eventA = message(1, now - 60000, 'model-a', tokens(9, 6));
  const eventB = message(1, now - 60000, 'model-b', tokens(9, 6));
  const late = message(2, now, 'model-a', tokens(100, 50));
  const live = harness({
    sessions: { 'session-a': [eventA], 'session-b': [eventB] },
    readDelay: { 'session-b': 80 },
  });
  const module = await import('../index.js?consistency=batch');
  module.apply(live.ctx);
  // Lands after A's read resolved, while B is still inside its 80 ms read.
  const timer = setTimeout(() => {
    live.corpus.get('session-a').events.push(late);
    live.emit(late, 'session-a');
  }, 30);
  const payload = await settle(live.get);
  clearTimeout(timer);
  check('fast session keeps its event during a slow batch', payload.summary.totalTokens === 180, payload.summary.totalTokens);
  check('fast session counts that event once', payload.summary.messages === 3, payload.summary.messages);
  const again = await live.get('/usage-stats/summary?range=7');
  check('slow batch does not double count', again.summary.totalTokens === 180, again.summary.totalTokens);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 2c. batch window with an existing cell (the overwrite path) -------------
{
  const home = homeFor('batch-cell');
  const eventA = message(1, now - 60000, 'model-a', tokens(9, 6));
  const eventB = message(1, now - 60000, 'model-b', tokens(9, 6));
  const late = message(2, now, 'model-a', tokens(100, 50));
  const live = harness({
    sessions: { 'session-a': [eventA], 'session-b': [eventB] },
    readDelay: { 'session-b': 70 },
  });
  const module = await import('../index.js?consistency=batch-cell');
  module.apply(live.ctx);
  const seeded = await settle(live.get);
  check('batch-cell fixture folded', seeded.summary.totalTokens === 30, seeded.summary.totalTokens);

  // Force a re-read of both; commit the live event for A mid-batch. The fold
  // snapshot for A cannot contain it (it is only emitted, never appended).
  const timer = setTimeout(() => live.emit(late, 'session-a'), 25);
  await live.get('/usage-stats/summary?range=7&refresh=1');
  const refreshed = await settle(live.get);
  clearTimeout(timer);
  check('forced re-read keeps the event that landed mid-batch', refreshed.summary.totalTokens === 180, refreshed.summary.totalTokens);
  check('forced re-read did not lose messages', refreshed.summary.messages === 3, refreshed.summary.messages);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 3. a session created during a pass is not dropped from `pending` --------
{
  const home = homeFor('pending');
  const late = message(1, now, 'model-late', tokens(30, 20));
  let lateCommitted = false;
  const live = harness({
    sessions: {},
    // First listing is empty: the session does not exist yet.
    listings: (call) => (call === 1 ? [] : lateCommitted ? ['session-late'] : []),
  });
  const module = await import('../index.js?consistency=pending');
  module.apply(live.ctx);
  const empty = await settle(live.get);
  check('an empty corpus still completes a pass', empty.summary.totalTokens === 0, empty.summary.totalTokens);

  // The session is created after the listing was taken.
  live.corpus.set('session-late', { session: { id: 'session-late', cwd: 'E:\\work' }, events: [late] });
  lateCommitted = true;
  live.emit(late, 'session-late');
  const withLate = await settle(live.get);
  check('late session was folded later', withLate.summary.totalTokens === 50, withLate.summary.totalTokens);
  check('late session was listed again', live.counts.list >= 2, live.counts);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 4. ?refresh=1 re-reads sessions that were already folded ----------------
{
  const home = homeFor('refresh');
  const first = message(1, now - 60000, 'model-a', tokens(9, 6));
  const live = harness({ sessions: { 'session-1': [first] } });
  const module = await import('../index.js?consistency=refresh');
  module.apply(live.ctx);
  const before = await settle(live.get);
  check('refresh fixture folded', before.summary.totalTokens === 15, before.summary.totalTokens);
  const readsBefore = live.counts.read;

  // Usage appended behind our back (e.g. a log written by another process).
  live.corpus.get('session-1').events.push(message(2, now, 'model-a', tokens(60, 40)));
  // The force flag belongs to one request; the poll that follows it must not
  // keep forcing, or it would spin.
  await live.get('/usage-stats/summary?range=7&refresh=1');
  const refreshed = await settle(live.get);
  check('refresh re-read the log', live.counts.read === readsBefore + 1, live.counts);
  check('refresh picked up the new usage', refreshed.summary.totalTokens === 115, refreshed.summary.totalTokens);

  // A normal request must not re-read: the cell is current again.
  const readsAfter = live.counts.read;
  await live.get('/usage-stats/summary?range=7');
  check('a normal request does not re-read after refresh', live.counts.read === readsAfter, live.counts);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

// --- 5. an empty corpus does not re-scan on every cooldown -------------------
{
  const home = homeFor('empty');
  const live = harness({ sessions: {}, listings: () => [] });
  const module = await import('../index.js?consistency=empty');
  module.apply(live.ctx);
  await settle(live.get);
  check('empty corpus scanned once', live.counts.list === 1, live.counts);
  for (let index = 0; index < 4; index += 1) {
    await live.get('/usage-stats/summary?range=7');
  }
  check('empty corpus is not rescanned', live.counts.list === 1, live.counts);
  for (const dispose of live.disposers.slice().reverse()) dispose();
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('consistency OK:', JSON.stringify({ scenarios: 7 }));
