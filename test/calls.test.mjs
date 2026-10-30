// Host-side check of the rolling call window: live intake, the 100-call cap,
// newest-first order, duration from step/start, upstream model extraction, the
// workspace/task filters, and the restart hand-off through the small cache file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-usage-calls-'));
process.env.DSH_HOME = home;

let listener = null;
const disposers = [];
const registered = [];

function makeContext() {
  return {
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
    // No session logs: the table must come from live events only.
    sessionQuery: {
      listSessions: async () => [],
      readSession: async () => { throw new Error('no logs'); },
    },
  };
}

const first = await import('../index.js');
first.apply(makeContext());

/** Always talk to the newest module instance: the restart checks below replace it. */
function currentRoute() {
  return registered[registered.length - 1];
}

function get(url) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(key, value) { this.headers[key] = value; },
      end(chunk) {
        this.body = chunk === undefined ? '' : String(chunk);
        try { resolve(JSON.parse(this.body)); } catch (cause) { reject(cause); }
      },
    };
    Promise.resolve(currentRoute().handler({ method: 'GET', url, headers: {} }, res)).catch(reject);
  });
}

const BASE = Date.now() - 150 * 1000;

const failures = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function emit(index, withReplay = true) {
  const sessionId = index % 2 === 0 ? 'session-even' : 'session-odd';
  const cwd = index % 2 === 0 ? 'E:\\work\\alpha' : 'E:\\work\\beta';
  const session = { id: sessionId, header: { id: sessionId, cwd } };
  const seq = 100 + index;
  listener(session, { type: 'step/start', seq: seq - 1, time: BASE + index * 1000 - 250, data: { turn: 1, step: seq } });
  listener(session, {
    type: 'assistant/message',
    seq,
    time: BASE + index * 1000,
    data: {
      turn: 1,
      step: seq,
      message: {
        role: 'assistant',
        source: {
          kind: 'model',
          provider: 'gateway-alpha',
          model: 'route-model-a',
          ...(withReplay
            ? { replayState: { blocks: [], response: { model: 'route-model-a', responseModel: 'deepseek-flash' } } }
            : {}),
        },
      },
      stream: [],
      usage: { inputTokens: 100 + index, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 0 },
    },
  });
}

// A live subagent call is classified by `origin`, so the scope filter finds it.
// Sent first, so the 100-call cap evicts it before the ordering checks below.
listener({ id: 'session-sub', header: { id: 'session-sub', cwd: 'E:\\work\\alpha', origin: 'subagent' } }, {
  type: 'assistant/message',
  seq: 900,
  time: BASE - 5000,
  data: {
    turn: 1,
    step: 900,
    message: { role: 'assistant', source: { kind: 'model', provider: 'gateway-alpha', model: 'route-model-a' } },
    stream: [],
    usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
});
const subBefore = await get('/usage-stats/summary?range=7&scope=sub');
const rootBefore = await get('/usage-stats/summary?range=7&scope=root');
check('scope=sub keeps the subagent call', subBefore.calls.length, 1);
check('scope=sub keeps the right row', subBefore.calls[0] && subBefore.calls[0].input, 7);
check('scope=root drops the subagent call', rootBefore.calls.length, 0);

for (let index = 0; index < 150; index += 1) emit(index);
// The newest call carries no upstream answer: its name can only come from the route.
emit(150, false);

const payload = await get('/usage-stats/summary?range=7');


check('calls capped at 100', payload.calls.length, 100);
check('newest first', payload.calls[0].time > payload.calls[99].time, true);
check('newest call is the last emitted', payload.calls[0].input, 100 + 150);
check('oldest kept call', payload.calls[99].input, 100 + 51);
check('duration from step/start', payload.calls[1].durationMs, 250);
check('upstream-reported model', payload.calls[1].actualModel, 'deepseek-flash');
check('route-only call has no upstream name', payload.calls[0].actualModel, '');
check('model source: route', payload.calls[0].modelSource, 'route');
check('model source: upstream', payload.calls[1].modelSource, 'upstream');
check('provider recorded', payload.calls[1].provider, 'gateway-alpha');
check('no effort field', 'effort' in payload.calls[0], false);
check('no cwd leaked into the row', 'cwd' in payload.calls[0], false);
check('call fields', Object.keys(payload.calls[0]).sort(), ['actualModel', 'cacheRead', 'cacheWrite', 'durationMs', 'input', 'model', 'modelSource', 'output', 'provider', 'time']);

// Log scan must stay empty: the table no longer depends on history.
check('scan has no sessions', payload.summary.sessions, 0);

// Workspace filter applies to the window.
const beta = await get(`/usage-stats/summary?range=7&cwd=${encodeURIComponent('E:\\work\\beta')}`);
check('cwd filter keeps half the window', beta.calls.length, 50);
check('cwd filter keeps the right rows', beta.calls.every((call) => call.input % 2 === 1), true);

// Disposing flushes the window to disk (no need to wait for the debounce).
for (const dispose of disposers.slice().reverse()) dispose();

const file = join(home, 'usage-stats', 'recent-calls.json');
let saved = null;
try {
  saved = JSON.parse(readFileSync(file, 'utf8'));
} catch (cause) {
  failures.push(`cache file missing: ${cause.message}`);
}
check('cache file version', saved && saved.version, 1);
check('cache file keeps 100 calls', saved && saved.calls.length, 100);
check('cache file newest last', saved && saved.calls[99].input, 100 + 150);
check('cache keeps the model source', saved && saved.calls[99].modelSource, 'route');

// Restart: a fresh module instance reading the same DSH_HOME must restore it.
listener = null;
registered.length = 0;
disposers.length = 0;
const second = await import('../index.js?restart=1');
second.apply(makeContext());
const restarted = await get('/usage-stats/summary?range=7');
check('restored after restart', restarted.calls.length, 100);
check('restored newest row', restarted.calls[0].input, 100 + 150);
check('restored oldest row', restarted.calls[99].input, 100 + 51);

// A file written by another schema must be ignored, not half-read.
writeFileSync(file, JSON.stringify({ version: 99, calls: [{ time: 1, input: 1 }] }), 'utf8');
listener = null;
registered.length = 0;
disposers.length = 0;
const third = await import('../index.js?restart=2');
third.apply(makeContext());
const ignored = await get('/usage-stats/summary?range=7');
check('unknown cache version ignored', ignored.calls.length, 0);

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('calls OK:', JSON.stringify({
  kept: payload.calls.length,
  newest: payload.calls[0].input,
  durationMs: payload.calls[0].durationMs,
  actualModel: payload.calls[0].actualModel,
  persisted: saved.calls.length,
  restored: restarted.calls.length,
}));
