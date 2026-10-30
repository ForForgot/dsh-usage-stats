// Host-side checks for the scan lifecycle: a failed fold must not look like a
// successful refresh, must retry on its own, and must not leave stale state.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-usage-scan-'));
process.env.DSH_HOME = home;

const failures = [];
/** Predicate style: pass a condition plus an optional detail for the report. */
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

function makeHarness() {
  const registered = [];
  const disposers = [];
  let listener = null;
  const calls = { list: 0, read: 0 };
  const ctx = {
    effect: (callback) => {
      const dispose = callback();
      const wrapped = typeof dispose === 'function' ? dispose : () => {};
      disposers.push(wrapped);
      return wrapped;
    },
    on: (name, handler) => {
      if (name === 'session/event') listener = handler;
      return () => { listener = null; };
    },
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    connection: { requestRejection: () => undefined },
    sessionQuery: {
      listSessions: async () => {
        calls.list += 1;
        if (ctx.sessionQuery.mode === 'fail') throw new Error('persistence offline');
        return ctx.sessionQuery.records;
      },
      readSession: async (id) => {
        calls.read += 1;
        return ctx.sessionQuery.sessions[id];
      },
      mode: 'fail',
      records: [],
      sessions: {},
    },
  };
  const get = (url) => new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      setHeader() {},
      end(chunk) {
        const body = chunk === undefined ? '' : String(chunk);
        try { resolve(JSON.parse(body)); } catch (cause) { reject(cause); }
      },
    };
    Promise.resolve(registered[registered.length - 1].handler({ method: 'GET', url, headers: {} }, res)).catch(reject);
  });
  return { ctx, get, calls, disposers, emit: (session, event) => listener(session, event) };
}

// 1. A failing scan reports the error, leaves `updatedAt` empty, and does not
//    hammer the persistence layer on every poll.
const failing = makeHarness();
const failingModule = await import('../index.js?scan=fail');
failingModule.apply(failing.ctx);

const failed = await failing.get('/usage-stats/summary?range=7');
await new Promise((resolve) => setTimeout(resolve, 40));
const settled = await failing.get('/usage-stats/summary?range=7');
check('failed scan reports the error', typeof settled.error === 'string' && settled.error.length > 0, settled.error);
check('failed scan is not scanning', settled.scanning === false, settled.scanning);
check('failed scan leaves updatedAt empty', settled.updatedAt === null, settled.updatedAt);
check('failed scan keeps the attempt count', failing.calls.list === 1, failing.calls.list);
check('failed scan does not rescan within the cooldown', failing.calls.list === 1, failing.calls.list);
check('failed payload has no stale freshness', failed.updatedAt === null, failed.updatedAt);

// A forced refresh retries immediately.
await failing.get('/usage-stats/summary?range=7&refresh=1');
check('forced refresh retries after a failure', failing.calls.list === 2, failing.calls.list);

// 2. Recovery: the same instance folds once persistence answers again.
const recovery = makeHarness();
recovery.ctx.sessionQuery.mode = 'ok';
recovery.ctx.sessionQuery.records = [{ header: { id: 's1', cwd: 'E:\\work' } }];
recovery.ctx.sessionQuery.sessions.s1 = {
  session: { id: 's1', cwd: 'E:\\work' },
  inheritedEventCount: 0,
  events: [{
    type: 'assistant/message',
    seq: 1,
    time: Date.now(),
    data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' } }, stream: [], usage: { inputTokens: 10, outputTokens: 5 } },
  }],
};
const recoveryModule = await import('../index.js?scan=recover');
recoveryModule.apply(recovery.ctx);
const recovered = await recovery.get('/usage-stats/summary?range=7');
await new Promise((resolve) => setTimeout(resolve, 40));
const afterRecovery = await recovery.get('/usage-stats/summary?range=7');
check('successful scan clears the error', afterRecovery.error === null, afterRecovery.error);
check('successful scan sets updatedAt', typeof afterRecovery.updatedAt === 'number', afterRecovery.updatedAt);
check('successful scan reports its duration', typeof afterRecovery.lastScanMs === 'number' && afterRecovery.lastScanMs >= 0, afterRecovery.lastScanMs);
check('successful scan folds the session', afterRecovery.summary.totalTokens === 15, afterRecovery.summary.totalTokens);
check('payload while scanning is still usable', typeof recovered.scanning === 'boolean', typeof recovered.scanning);

// 3. Unload must drop the in-memory call window, so a later enable reads the
//    file again instead of inheriting rows the process happened to keep.
const ring = makeHarness();
const ringModule = await import('../index.js?scan=ring');
ringModule.apply(ring.ctx);
ring.emit({ id: 's1', header: { id: 's1', cwd: 'E:\\work' } }, {
  type: 'assistant/message',
  seq: 5,
  time: Date.now(),
  data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' } }, stream: [], usage: { inputTokens: 3, outputTokens: 2 } },
});
const beforeUnload = await ring.get('/usage-stats/summary?range=7');
check('live call captured', beforeUnload.calls.length === 1, beforeUnload.calls.length);

const cacheFile = join(home, 'usage-stats', 'recent-calls.json');
for (const dispose of ring.disposers.slice().reverse()) dispose();
check('unload persisted the window', existsSync(cacheFile) === true, existsSync(cacheFile));
rmSync(cacheFile, { force: true });

// Same module instance, second enable, file gone: the window must be empty.
ring.disposers.length = 0;
ringModule.apply(ring.ctx);
const afterReenable = await ring.get('/usage-stats/summary?range=7');
check('re-enable does not inherit stale rows', afterReenable.calls.length === 0, afterReenable.calls.length);

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('scan OK:', JSON.stringify({
  failedAttempts: failing.calls.list,
  error: settled.error ? 'reported' : 'missing',
  updatedAtAfterFailure: settled.updatedAt,
  recoveredTokens: afterRecovery.summary.totalTokens,
  lastScanMs: afterRecovery.lastScanMs,
  callsAfterReenable: afterReenable.calls.length,
}));
