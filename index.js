/**
 * Host half of the usage-statistics bundle.
 *
 * One authenticated route folds every local Session log into the dashboard
 * payload the browser page renders:
 *
 *   GET /usage-stats/summary[?range=7|30][&cwd=<path>|all][&scope=all|root|sub][&refresh=1]
 *
 * Each `assistant/message` event carries the provider-reported `usage`
 * (input / output / cache-read / cache-write) and the `source.model` the
 * request ran on, so the log is the only source of truth. Fork-inherited
 * prefixes are skipped through `inheritedEventCount`: a child log replays its
 * parent's events, and counting them twice would inflate the totals.
 *
 * The scan runs in the background in small batches; a request answers with
 * whatever is folded so far plus `scanning` / `progress`, so a large history
 * never blocks a page open.
 *
 * The call-detail table is not part of that scan: it is a rolling window of the
 * committed `assistant/message` events this process observed, kept in memory and
 * mirrored to a small JSON file so it survives a restart.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Cordis function-plugin name. */
export const name = 'usage-stats';

/**
 * The route carrier, the trust fence guarding it, the log reader, and the
 * committed-event feed the live call ring subscribes to.
 */
export const inject = ['webServer', 'connection', 'sessionQuery'];

/** Absolute pathname the Host registers; the browser addresses it document-relative. */
const ROUTE_PATH = '/usage-stats/summary';

/** After a failed scan, wait this long before retrying on a later request. */
const SCAN_RETRY_MS = 15 * 1000;

/** A single list/read call that takes longer counts as a failure, not a hang. */
const READ_TIMEOUT_MS = 60 * 1000;

/** Session logs read in parallel: enough to feel fast, small enough to stay quiet. */
const BATCH_SIZE = 4;

/** Heatmap window: 53 weeks, Sunday-first, the last column being this week. */
const HEATMAP_WEEKS = 53;

/** Ranges the dashboard offers, in days. */
const RANGES = [7, 30];

/** Newest calls kept for the detail table (a rolling window across restarts). */
const CALL_LIMIT = 100;

/** How long a persisted ring change waits before it is written out. */
const CALLS_FLUSH_MS = 1500;

/** Where the rolling call window survives a restart. */
const CALLS_FILE = 'usage-stats/recent-calls.json';

/** Schema of that file; a mismatch is ignored instead of half-read. */
const CALLS_FILE_VERSION = 1;

/** Where the per-session folds survive a restart. */
const FOLDS_FILE = 'usage-stats/folds.json';

/** Schema of that file, same contract as the call window. */
const FOLDS_FILE_VERSION = 1;

/** How long a fold change waits before it is written out. */
const FOLDS_FLUSH_MS = 2000;

/** Per-session folded usage, keyed by Session id. */
const cells = new Map();

/** Sessions whose log was folded end to end in this process (skip on later scans). */
const scanned = new Set();

/** Sessions that produced a live event while their cell was still unknown. */
const pending = new Set();

/** Persistence bookkeeping for `cells`. */
const folds = { loaded: false, dirty: false, flushTimer: null };

/**
 * The rolling call window: every committed assistant message the Host sees
 * while this plugin is loaded, newest last. A small JSON file keeps the tail
 * across restarts so the table does not start empty after every launch.
 */
const ring = {
  calls: [],
  stepStarts: new Map(),
  loaded: false,
  flushTimer: null,
  dirty: false,
};

/** Scan bookkeeping shared by every request. */
const state = {
  total: 0,
  done: 0,
  scanning: false,
  /** When the last successful fold finished; `null` until one succeeds. */
  finishedAt: 0,
  /** When the last attempt started, successful or not (retry cooldown). */
  lastAttemptAt: 0,
  /** Wall-clock duration of that successful fold, for diagnosing slow corpora. */
  lastScanMs: 0,
  /** When a live event last changed the aggregate (newer than `finishedAt`). */
  lastEventAt: 0,
  /** Sessions the last pass could not read; retried after the cooldown. */
  unreadable: 0,
  error: null,
};

/** Bumped to abandon an in-flight scan (new scan, or plugin unload). */
let generation = 0;

/** JSON response; usage facts are live, so nothing may be cached. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** A finite non-negative count, or zero. */
function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Local calendar day of one timestamp, as `YYYY-MM-DD`. */
function dayKeyOf(time) {
  const date = new Date(typeof time === 'number' && Number.isFinite(time) ? time : Date.now());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
}

/** Local midnight of the day `offset` days from today. */
function dayStart(offset) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** Sessions whose log is being read right now: their live events go to `tail`. */
const folding = new Set();

/** Live events that arrived during a fold, keyed by Session id, replayed after it. */
const tail = new Map();

/** How many listings may miss a pending Session before it is dropped. */
const PENDING_MAX_MISSES = 5;

/** Pending Session ids and how many listings in a row omitted them. */
const pendingMisses = new Map();

/**
 * Whether a Session is an agent-spawned subtask.
 *
 * A user fork also carries `parentSession`, but it is a branch of the user's own
 * work, not a subtask: `origin` is the only field DSH sets for subagents, and
 * `delegationDepth` counts how deep that delegation went. `parentSession` is
 * therefore used for prefix dedupe only, never for this classification.
 */
function isSubSession(header) {
  if (!header || typeof header !== 'object') return false;
  if (header.origin === 'subagent') return true;
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0;
}

/** One empty per-session fold. */
function emptyCell() {
  return {
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 0,
    messages: 0,
    cwd: '',
    sub: false,
    /** Sequence of the last event folded in, so a saved cell carries its cursor. */
    seq: 0,
    days: Object.create(null),
    models: Object.create(null),
  };
}

/**
 * Model identity inside a replay envelope, when the adapter kept one.
 *
 * The llm-pi-ai adapter stores `{ kind, api, model, responseModel, … }`:
 * `model` is the route that was requested and `responseModel` is what the
 * upstream answered with. The answered name wins.
 */
function reportedModelOf(value, depth) {
  if (depth > 3 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text.startsWith('{')) return '';
    try {
      return reportedModelOf(JSON.parse(text), depth + 1);
    } catch {
      return '';
    }
  }
  if (typeof value !== 'object') return '';
  if (typeof value.responseModel === 'string' && value.responseModel !== '') return value.responseModel;
  // A replay envelope keeps the provider answer under `response`; that is more
  // authoritative than a `model` sitting next to it (which may be the route).
  if (value.response) {
    const inner = reportedModelOf(value.response, depth + 1);
    if (inner) return inner;
  }
  if (typeof value.model === 'string' && value.model !== '') return value.model;
  if (value.message && typeof value.message === 'object') {
    const inner = reportedModelOf(value.message, depth + 1);
    if (inner) return inner;
  }
  return '';
}

/** The model the upstream response itself named, if the log kept it. */
function reportedModelOfEvent(data) {
  const source = data.message && data.message.source;
  const direct = reportedModelOf(source ? source.replayState : undefined, 0);
  if (direct !== '') return direct;
  const stream = data.stream;
  if (!Array.isArray(stream)) return '';
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (!record || record.type !== 'chunk') continue;
    const chunk = record.chunk;
    if (!chunk || chunk.type !== 'finish') continue;
    const found = reportedModelOf(chunk.replayState, 0);
    if (found !== '') return found;
  }
  return '';
}

/**
 * The rolling call window.
 *
 * Reads and writes live outside the log scan: the window holds the committed
 * `assistant/message` events this process observed, newest last, and mirrors
 * its tail to `$DSH_HOME/usage-stats/recent-calls.json` so a restart does not
 * blank the table. Everything here is best-effort — a read-only home directory
 * must leave the dashboard working.
 */

/** Absolute path of a state file under the Harness home. */
function stateFile(relative) {
  const home = process.env.DSH_HOME && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  return join(home, ...relative.split('/'));
}

/** Absolute path of the rolling-window file. */
function callsFile() {
  return stateFile(CALLS_FILE);
}

/** Write one JSON state file atomically; failures stay local. */
function writeJsonAtomic(file, value) {
  try {
    // These files name working directories and models, so keep them owner-only
    // where the platform honours modes.
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // A read-only DSH_HOME must not break the dashboard.
  }
}

/** Restore the persisted tail, once per process. */
function loadRing() {
  if (ring.loaded) return;
  ring.loaded = true;
  // Whatever this process saw before is not authoritative: a missing, unreadable
  // or foreign file must leave the window empty instead of keeping stale rows.
  ring.calls = [];
  try {
    const parsed = JSON.parse(readFileSync(callsFile(), 'utf8'));
    // A shape from another (or a future) build is ignored rather than guessed at.
    const versioned = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    if (versioned && parsed.version !== CALLS_FILE_VERSION) return;
    const list = Array.isArray(parsed) ? parsed : versioned && Array.isArray(parsed.calls) ? parsed.calls : [];
    const calls = list
      .filter((call) => call && typeof call.time === 'number' && Number.isFinite(call.time))
      .sort((left, right) => left.time - right.time);
    ring.calls = calls.slice(-CALL_LIMIT);
  } catch {
    // First run, an unreadable file, or an older shape: start empty.
  }
}

/** Write the window out atomically; failures stay local. */
function persistRing() {
  if (!ring.dirty) return;
  ring.dirty = false;
  writeJsonAtomic(callsFile(), { version: CALLS_FILE_VERSION, calls: ring.calls });
}

/** Debounced persist so a burst of calls writes once. */
function schedulePersist() {
  ring.dirty = true;
  if (ring.flushTimer !== null) return;
  ring.flushTimer = setTimeout(() => {
    ring.flushTimer = null;
    persistRing();
  }, CALLS_FLUSH_MS);
  if (typeof ring.flushTimer.unref === 'function') ring.flushTimer.unref();
}

/**
 * Rebuild a persisted cell.
 *
 * A parsed JSON object has ordinary prototypes, so the day/model maps are
 * recreated with `Object.create(null)` and every number is validated: a file from
 * another build (or a hand-edited one) must never contribute garbage totals.
 */
function hydrateCell(raw) {
  const cell = emptyCell();
  if (!raw || typeof raw !== 'object') return cell;
  cell.tokens = positive(raw.tokens);
  cell.input = positive(raw.input);
  cell.output = positive(raw.output);
  cell.cacheRead = positive(raw.cacheRead);
  cell.cacheWrite = positive(raw.cacheWrite);
  cell.requests = positive(raw.requests);
  cell.messages = positive(raw.messages);
  cell.cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
  cell.sub = raw.sub === true;
  cell.seq = typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : 0;
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const day of Object.keys(days)) {
    const bucket = days[day];
    if (!bucket || typeof bucket !== 'object') continue;
    const target = {
      tokens: positive(bucket.tokens),
      requests: positive(bucket.requests),
      input: positive(bucket.input),
      output: positive(bucket.output),
      cacheRead: positive(bucket.cacheRead),
      cacheWrite: positive(bucket.cacheWrite),
      models: Object.create(null),
    };
    const models = bucket.models && typeof bucket.models === 'object' ? bucket.models : {};
    for (const model of Object.keys(models)) {
      const usage = models[model];
      if (!usage || typeof usage !== 'object') continue;
      target.models[model] = { tokens: positive(usage.tokens), requests: positive(usage.requests) };
    }
    cell.days[day] = target;
  }
  const models = raw.models && typeof raw.models === 'object' ? raw.models : {};
  for (const model of Object.keys(models)) {
    const usage = models[model];
    if (!usage || typeof usage !== 'object') continue;
    cell.models[model] = { tokens: positive(usage.tokens), requests: positive(usage.requests) };
  }
  return cell;
}

/** Restore the persisted folds, once per process, so the first paint is warm. */
function loadFolds() {
  if (folds.loaded) return;
  folds.loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(stateFile(FOLDS_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.version !== FOLDS_FILE_VERSION) return;
    const sessions = parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
    for (const id of Object.keys(sessions)) {
      const entry = sessions[id];
      const cell = entry && entry.cell;
      if (!cell || typeof cell !== 'object' || typeof cell.tokens !== 'number') continue;
      cells.set(id, hydrateCell(cell));
    }
  } catch {
    // First run, an unreadable file, or an older shape: start empty.
  }
}

/** Write every known fold out atomically. */
function persistFolds() {
  if (!folds.dirty) return;
  folds.dirty = false;
  const sessions = {};
  for (const [id, cell] of cells) sessions[id] = { seq: cell.seq || 0, cell };
  writeJsonAtomic(stateFile(FOLDS_FILE), { version: FOLDS_FILE_VERSION, sessions });
}

/** Debounced persist so a burst of live events writes once. */
function scheduleFoldsPersist() {
  folds.dirty = true;
  if (folds.flushTimer !== null) return;
  folds.flushTimer = setTimeout(() => {
    folds.flushTimer = null;
    persistFolds();
  }, FOLDS_FLUSH_MS);
  if (typeof folds.flushTimer.unref === 'function') folds.flushTimer.unref();
}

/** Append one call, keeping the window at CALL_LIMIT. */
function pushCall(call) {
  ring.calls.push(call);
  if (ring.calls.length > CALL_LIMIT) ring.calls.splice(0, ring.calls.length - CALL_LIMIT);
  schedulePersist();
}

/** Keep the step-timing map bounded on very long sessions. */
function pruneStepStarts(now) {
  if (ring.stepStarts.size < 4096) return;
  for (const [key, started] of ring.stepStarts) {
    if (now - started > 3600000) ring.stepStarts.delete(key);
  }
}

/** Fold one committed Session event into the rolling window. */
function acceptLiveEvent(session, event) {
  if (!session || !event) return;
  const sessionId = typeof session.id === 'string' ? session.id : '';
  const data = event.data || {};
  if (event.type === 'step/start') {
    ring.stepStarts.set(`${sessionId}:${data.turn}:${data.step}`, event.time);
    pruneStepStarts(event.time);
    return;
  }
  if (event.type !== 'assistant/message') return;

  // Keep the aggregate current incrementally, and do it BEFORE the usage guards:
  // a message without usage still counts toward `messages`, exactly like a full
  // fold of the same log would count it.
  if (sessionId !== '') {
    if (folding.has(sessionId)) {
      // A fold pass is reading this log right now. Buffer instead of applying:
      // applying would be lost (the fold's cell replaces it) or doubled (replayed
      // after it), so the pass replays this list once it has written the cell.
      const buffered = tail.get(sessionId);
      if (buffered === undefined) tail.set(sessionId, [event]);
      else buffered.push(event);
    } else {
      const cell = cells.get(sessionId);
      if (cell === undefined) {
        // A session we never folded: it may hold earlier usage we did not observe,
        // so let the next pass fold it properly instead of counting a partial.
        pending.add(sessionId);
        pendingMisses.delete(sessionId);
      } else {
        applyLiveToCell(cell, event);
        scheduleFoldsPersist();
      }
    }
  }

  // The call window only lists calls that actually carried usage.
  const usage = data.usage;
  if (!usage || typeof usage !== 'object') return;
  const input = positive(usage.inputTokens);
  const output = positive(usage.outputTokens);
  const cacheRead = positive(usage.cacheReadTokens);
  const cacheWrite = positive(usage.cacheWriteTokens);
  if (input + output + cacheRead + cacheWrite <= 0) return;

  const source = data.message && data.message.source;
  const model = source && typeof source.model === 'string' && source.model !== '' ? source.model : 'unknown';
  const reported = reportedModelOfEvent(data);
  const header = session.header || {};
  const stepKey = `${sessionId}:${data.turn}:${data.step}`;
  const started = ring.stepStarts.get(stepKey);
  ring.stepStarts.delete(stepKey);
  pushCall({
    time: event.time,
    model,
    actualModel: reported !== '' && reported !== model ? reported : '',
    // Whether the name above came from the provider answer or only from the route.
    modelSource: reported !== '' ? 'upstream' : 'route',
    provider: source && typeof source.provider === 'string' ? source.provider : '',
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    sub: isSubSession(header),
    input,
    output,
    cacheRead,
    cacheWrite,
    durationMs: typeof started === 'number' && started > 0 && event.time >= started ? event.time - started : null,
  });
}

/** The window, filtered by the current selection, newest first. */
function callsFor(selection) {
  return ring.calls
    .filter((call) => selection.predicate({ cwd: call.cwd, sub: call.sub }))
    .slice(-CALL_LIMIT)
    .reverse()
    .map((call) => ({
      time: call.time,
      model: call.model,
      actualModel: call.actualModel,
      modelSource: call.modelSource === 'upstream' ? 'upstream' : 'route',
      provider: call.provider,
      input: call.input,
      output: call.output,
      cacheRead: call.cacheRead,
      cacheWrite: call.cacheWrite,
      durationMs: call.durationMs,
    }));
}

/**
 * Fold ONE committed event into a usage cell.
 *
 * The same function drives two paths that must agree: replaying a whole log
 * (`foldSession`) and the live `session/event` feed, which is why the aggregate
 * never needs a periodic rescan. Returns true when the event carried usage.
 */
function applyEventToCell(cell, event) {
  if (!cell || !event || event.type !== 'assistant/message') return false;
  cell.messages += 1;
  const data = event.data || {};
  const usage = data.usage;
  if (!usage || typeof usage !== 'object') return false;
  const input = positive(usage.inputTokens);
  const output = positive(usage.outputTokens);
  const cacheRead = positive(usage.cacheReadTokens);
  const cacheWrite = positive(usage.cacheWriteTokens);
  // Reasoning tokens are already part of outputTokens; never add them again.
  const tokens = input + output + cacheRead + cacheWrite;
  if (tokens <= 0) return false;
  const source = data.message && data.message.source;
  const model = source && typeof source.model === 'string' && source.model !== '' ? source.model : 'unknown';
  const reported = reportedModelOfEvent(data);
  const day = dayKeyOf(event.time);
  cell.tokens += tokens;
  cell.input += input;
  cell.output += output;
  cell.cacheRead += cacheRead;
  cell.cacheWrite += cacheWrite;
  cell.requests += 1;
  let bucket = cell.days[day];
  if (bucket === undefined) {
    bucket = cell.days[day] = {
      tokens: 0,
      requests: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      models: Object.create(null),
    };
  }
  bucket.tokens += tokens;
  bucket.requests += 1;
  bucket.input += input;
  bucket.output += output;
  bucket.cacheRead += cacheRead;
  bucket.cacheWrite += cacheWrite;
  // Aggregate under the model the upstream named, falling back to the route.
  const resolved = reported !== '' ? reported : model;
  const perModel = bucket.models[resolved] || (bucket.models[resolved] = { tokens: 0, requests: 0 });
  perModel.tokens += tokens;
  perModel.requests += 1;
  const modelBucket = cell.models[resolved] || (cell.models[resolved] = { tokens: 0, requests: 0 });
  modelBucket.tokens += tokens;
  modelBucket.requests += 1;
  return true;
}

/** Fold one Session log snapshot into its usage cell. */
function foldSession(snapshot) {
  const cell = emptyCell();
  if (!snapshot || !Array.isArray(snapshot.events)) return cell;
  const header = snapshot.session || {};
  cell.cwd = typeof header.cwd === 'string' ? header.cwd : '';
  cell.sub = isSubSession(header);
  const inherited = positive(snapshot.inheritedEventCount);
  const events = snapshot.events;
  for (let index = inherited; index < events.length; index += 1) {
    applyEventToCell(cell, events[index]);
  }
  cell.seq = seqOf(events);
  return cell;
}

/** The highest sequence number in a log, for the persisted fold cursor. */
function seqOf(events) {
  let seq = 0;
  for (const event of events) {
    if (event && typeof event.seq === 'number' && Number.isFinite(event.seq) && event.seq > seq) seq = event.seq;
  }
  return seq;
}

/**
 * Apply one live event to a cell and advance its cursor.
 *
 * The cursor is what makes the fold/live merge safe: a fold that is older than
 * the cell (because an event landed mid-read) must not be allowed to roll it back.
 */
function applyLiveToCell(cell, event) {
  applyEventToCell(cell, event);
  if (typeof event.seq === 'number' && Number.isFinite(event.seq) && event.seq > cell.seq) {
    cell.seq = event.seq;
  }
  state.lastEventAt = Date.now();
}

/**
 * Publish one folded cell, replaying whatever the live feed buffered for it.
 *
 * This runs synchronously and is the ONLY place `folding` is released, so no live
 * event can land between "the log is read" and "the fold is published" — that
 * window is exactly where a fast session's usage used to be lost while a slow
 * sibling in the same batch was still reading.
 */
function commitFold(id, cell) {
  const buffered = tail.get(id);
  tail.delete(id);
  const existing = cells.get(id);
  // Never roll an advanced cell back to an older fold.
  const target = existing !== undefined && existing.seq > cell.seq ? existing : cell;
  if (buffered !== undefined) {
    for (const event of buffered) {
      if (typeof event.seq === 'number' && event.seq > target.seq) applyLiveToCell(target, event);
    }
  }
  cells.set(id, target);
  folding.delete(id);
}

/** Replay (or hand to `pending`) anything still buffered, and stop folding. */
function flushFolding() {
  for (const id of [...folding]) {
    const buffered = tail.get(id);
    tail.delete(id);
    folding.delete(id);
    if (buffered === undefined) continue;
    const cell = cells.get(id);
    if (cell === undefined) {
      pending.add(id);
      continue;
    }
    for (const event of buffered) {
      if (typeof event.seq === 'number' && event.seq > cell.seq) applyLiveToCell(cell, event);
    }
  }
}

/** Reject when `promise` takes longer than `ms`, so a hung read cannot pin scanning. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('read timeout')), ms);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Streak facts over a set of day keys, ignoring zero days. */
function streaksOf(usedDays) {
  const sorted = [...usedDays].sort();
  let longest = 0;
  let longestFrom = null;
  let longestTo = null;
  let runStart = null;
  let previous = null;
  for (const day of sorted) {
    const date = new Date(`${day}T00:00:00`);
    const continueRun = previous !== null
      && Math.round((date - new Date(`${previous}T00:00:00`)) / 86400000) === 1;
    if (!continueRun) runStart = day;
    const length = Math.round((date - new Date(`${runStart}T00:00:00`)) / 86400000) + 1;
    if (length > longest) {
      longest = length;
      longestFrom = runStart;
      longestTo = day;
    }
    previous = day;
  }
  const set = new Set(sorted);
  const todayKey = dayKeyOf(dayStart(0).getTime());
  const yesterdayKey = dayKeyOf(dayStart(-1).getTime());
  const anchor = set.has(todayKey) ? todayKey : set.has(yesterdayKey) ? yesterdayKey : null;
  let current = 0;
  if (anchor !== null) {
    let cursor = new Date(`${anchor}T00:00:00`);
    for (;;) {
      const key = dayKeyOf(cursor.getTime());
      if (!set.has(key)) break;
      current += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
  }
  return { current, longest, longestFrom, longestTo, activeToday: set.has(todayKey) };
}

/** Resolve the requested filter to a predicate over cells. */
function selectionOf(query) {
  const range = RANGES.includes(query.range) ? query.range : 30;
  const cwd = typeof query.cwd === 'string' && query.cwd !== '' ? query.cwd : 'all';
  const scope = query.scope === 'root' || query.scope === 'sub' ? query.scope : 'all';
  const predicate = (cell) => {
    if (cwd !== 'all' && cell.cwd !== cwd) return false;
    if (scope === 'root' && cell.sub) return false;
    if (scope === 'sub' && !cell.sub) return false;
    return true;
  };
  return { range, cwd, scope, predicate };
}

/** Build the dashboard payload for one selection. */
function buildSnapshot(query) {
  const selection = selectionOf(query);
  const selected = [];
  for (const cell of cells.values()) {
    if (cell.messages === 0 && cell.tokens === 0) continue;
    if (!selection.predicate(cell)) continue;
    selected.push(cell);
  }

  const summary = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sessions: 0,
    subSessions: 0,
    messages: 0,
    requests: 0,
  };
  const dayTotals = new Map();
  const dayModels = new Map();
  const modelTotals = new Map();
  for (const cell of selected) {
    if (cell.tokens > 0) {
      summary.sessions += 1;
      if (cell.sub) summary.subSessions += 1;
    }
    summary.totalTokens += cell.tokens;
    summary.inputTokens += cell.input;
    summary.outputTokens += cell.output;
    summary.cacheReadTokens += cell.cacheRead;
    summary.cacheWriteTokens += cell.cacheWrite;
    summary.messages += cell.messages;
    summary.requests += cell.requests;
    for (const day of Object.keys(cell.days)) {
      const bucket = cell.days[day];
      const target = dayTotals.get(day) || {
        tokens: 0,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      target.tokens += bucket.tokens;
      target.requests += bucket.requests;
      target.input += bucket.input || 0;
      target.output += bucket.output || 0;
      target.cacheRead += bucket.cacheRead || 0;
      target.cacheWrite += bucket.cacheWrite || 0;
      dayTotals.set(day, target);
      let perModel = dayModels.get(day);
      for (const model of Object.keys(bucket.models)) {
        const usage = bucket.models[model];
        if (perModel === undefined) perModel = dayModels.set(day, Object.create(null)).get(day);
        const entry = perModel[model] || (perModel[model] = { tokens: 0, requests: 0 });
        entry.tokens += typeof usage === 'number' ? usage : usage.tokens || 0;
        entry.requests += typeof usage === 'number' ? 0 : usage.requests || 0;
      }
    }
    for (const model of Object.keys(cell.models)) {
      const source = cell.models[model];
      const target = modelTotals.get(model) || { tokens: 0, requests: 0 };
      target.tokens += source.tokens;
      target.requests += source.requests;
      modelTotals.set(model, target);
    }
  }

  const streaks = streaksOf(new Set([...dayTotals.keys()].filter((day) => dayTotals.get(day).tokens > 0)));

  // Lifetime model ranking: what the "most used model" card reports.
  const lifetimeModels = [...modelTotals.entries()]
    .map(([model, value]) => ({
      model,
      tokens: value.tokens,
      requests: value.requests,
      share: summary.totalTokens > 0 ? value.tokens / summary.totalTokens : 0,
    }))
    .sort((left, right) => right.tokens - left.tokens);

  // Trend series: zero-filled days for the selected range, per model.
  const rangeDays = [];
  for (let offset = selection.range - 1; offset >= 0; offset -= 1) {
    rangeDays.push(dayKeyOf(dayStart(-offset).getTime()));
  }

  const daily = rangeDays.map((day) => {
    const totals = dayTotals.get(day);
    const perModel = dayModels.get(day) || {};
    const models = {};
    for (const model of Object.keys(perModel)) models[model] = perModel[model].tokens;
    return {
      day,
      tokens: totals ? totals.tokens : 0,
      requests: totals ? totals.requests : 0,
      models,
    };
  });

  // Everything the range control governs is summed over those same days, so the
  // donut and the composition follow the picker instead of the whole history.
  const rangeTotals = { tokens: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const rangeModelTotals = new Map();
  for (const day of rangeDays) {
    const totals = dayTotals.get(day);
    if (totals) {
      rangeTotals.tokens += totals.tokens;
      rangeTotals.requests += totals.requests;
      rangeTotals.input += totals.input;
      rangeTotals.output += totals.output;
      rangeTotals.cacheRead += totals.cacheRead;
      rangeTotals.cacheWrite += totals.cacheWrite;
    }
    const perModel = dayModels.get(day);
    if (!perModel) continue;
    for (const model of Object.keys(perModel)) {
      const target = rangeModelTotals.get(model) || { tokens: 0, requests: 0 };
      target.tokens += perModel[model].tokens;
      target.requests += perModel[model].requests;
      rangeModelTotals.set(model, target);
    }
  }

  const models = [...rangeModelTotals.entries()]
    .map(([model, value]) => ({
      model,
      tokens: value.tokens,
      requests: value.requests,
      share: rangeTotals.tokens > 0 ? value.tokens / rangeTotals.tokens : 0,
    }))
    .sort((left, right) => right.tokens - left.tokens);

  // Heatmap: 53 Sunday-first weeks, the last column being this week.
  const today = dayStart(0);
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const start = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() - (HEATMAP_WEEKS - 1) * 7,
  );
  const heatmap = [];
  for (let index = 0; index < HEATMAP_WEEKS * 7; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const day = dayKeyOf(date.getTime());
    const totals = dayTotals.get(day);
    heatmap.push({
      day,
      tokens: totals ? totals.tokens : 0,
      requests: totals ? totals.requests : 0,
      future: date > today,
    });
  }

  // Filter options come from the whole corpus so the controls never vanish.
  // The scope counts use the same predicate as `summary.sessions` (a session
  // with any usage), so the two numbers can never contradict each other.
  const cwdTotals = new Map();
  let scopeAll = 0;
  let scopeRoot = 0;
  let scopeSub = 0;
  for (const cell of cells.values()) {
    if (cell.messages === 0 && cell.tokens === 0) continue;
    if (cell.tokens > 0) {
      scopeAll += 1;
      if (cell.sub) scopeSub += 1;
      else scopeRoot += 1;
    }
    if (cell.cwd === '') continue;
    const entry = cwdTotals.get(cell.cwd) || { cwd: cell.cwd, sessions: 0, tokens: 0 };
    entry.sessions += 1;
    entry.tokens += cell.tokens;
    cwdTotals.set(cell.cwd, entry);
  }
  const cwds = [...cwdTotals.values()].sort((left, right) => right.tokens - left.tokens);

  return {
    version: 2,
    scanning: state.scanning,
    progress: { done: state.done, total: state.total },
    error: state.error,
    // When the numbers last changed: a successful fold OR a live event, whichever
    // is newer. A failed attempt never advances it.
    updatedAt: Math.max(state.finishedAt, state.lastEventAt) || null,
    lastScanMs: state.lastScanMs,
    selection: { range: selection.range, cwd: selection.cwd, scope: selection.scope },
    summary: {
      ...summary,
      activeDays: dayTotals.size,
      currentStreakDays: streaks.current,
      longestStreakDays: streaks.longest,
      activeToday: streaks.activeToday,
      // The card is a lifetime figure, so it ranks over the whole history.
      topModel: lifetimeModels.length > 0 ? lifetimeModels[0] : null,
    },
    // Composition and models describe the selected range; the cards above stay
    // lifetime. `rangeTokens` is what the donut's centre and shares use.
    composition: {
      input: rangeTotals.input,
      output: rangeTotals.output,
      cacheRead: rangeTotals.cacheRead,
      cacheWrite: rangeTotals.cacheWrite,
    },
    lifetimeComposition: {
      input: summary.inputTokens,
      output: summary.outputTokens,
      cacheRead: summary.cacheReadTokens,
      cacheWrite: summary.cacheWriteTokens,
    },
    rangeTokens: rangeTotals.tokens,
    models,
    daily,
    heatmap,
    // The client lays the grid out from this, so the window length has one owner.
    heatmapWeeks: HEATMAP_WEEKS,
    callsLimit: CALL_LIMIT,
    calls: callsFor(selection),
    filters: {
      cwds,
      scopes: { all: scopeAll, root: scopeRoot, sub: scopeSub },
      ranges: RANGES,
    },
  };
}

/**
 * Start one background fold pass.
 *
 * Sessions already folded end to end in this process are skipped: their usage
 * arrives through `session/event` from now on. That makes a normal pass cost
 * O(new or unseen sessions) instead of O(corpus); `force` (the refresh button)
 * deliberately re-reads everything.
 */
function startScan(ctx, options = {}) {
  const force = options.force === true;
  generation += 1;
  const mine = generation;
  state.scanning = true;
  state.done = 0;
  state.total = 0;
  state.lastAttemptAt = Date.now();
  void (async () => {
    let ok = false;
    try {
      const records = await withTimeout(ctx.sessionQuery.listSessions(), READ_TIMEOUT_MS);
      if (mine !== generation) return;
      const ids = [];
      const seen = new Set();
      for (const record of records) {
        const id = record && record.header ? record.header.id : undefined;
        if (typeof id === 'string' && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      for (const id of [...cells.keys()]) {
        if (!seen.has(id)) {
          cells.delete(id);
          scanned.delete(id);
          pending.delete(id);
          pendingMisses.delete(id);
        }
      }
      // A forced pass re-reads everything, so `?refresh=1` really is a full re-fold
      // and can recover from state a bug left behind.
      const todo = force ? ids : ids.filter((id) => !scanned.has(id));
      state.total = todo.length;
      let unreadable = 0;
      for (let offset = 0; offset < todo.length; offset += BATCH_SIZE) {
        if (mine !== generation) return;
        const slice = todo.slice(offset, offset + BATCH_SIZE);
        // The read half stays pure: no `folding`/`tail` bookkeeping, no commit.
        const folded = await Promise.all(slice.map(async (id) => {
          folding.add(id);
          try {
            return [id, foldSession(await withTimeout(ctx.sessionQuery.readSession(id), READ_TIMEOUT_MS)), true];
          } catch {
            // An unreadable, migrating, or vanished log keeps its previous fold
            // instead of dropping already counted usage from the totals.
            return [id, cells.get(id) || emptyCell(), false];
          }
        }));
        if (mine !== generation) return;
        // Commit synchronously, and keep `folding` set until here: a live event for
        // a fast session must not slip into the window between its own read
        // finishing and this batch committing (it would be overwritten by the fold).
        for (const [id, cell, complete] of folded) {
          commitFold(id, cell);
          // A failed read stays unscanned so a later pass retries it.
          if (complete) scanned.add(id);
          else unreadable += 1;
        }
        state.done = Math.min(todo.length, offset + slice.length);
      }
      // Only forget pending ids the listing actually covered: a session created
      // while this pass was running is not in `ids` yet and must stay queued.
      for (const id of [...pending]) {
        if (seen.has(id)) {
          pending.delete(id);
          pendingMisses.delete(id);
          continue;
        }
        const misses = (pendingMisses.get(id) || 0) + 1;
        if (misses >= PENDING_MAX_MISSES) {
          pending.delete(id);
          pendingMisses.delete(id);
        } else {
          pendingMisses.set(id, misses);
        }
      }
      state.unreadable = unreadable;
      ok = true;
    } catch (cause) {
      // Any unexpected failure must still release the scanning flag, otherwise
      // no later request would ever start a scan again.
      if (mine === generation) {
        state.error = `scan failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
    } finally {
      // An abandoned pass must not leave sessions marked as folding: their live
      // events would buffer forever. Replay them into whatever cell exists.
      flushFolding();
      if (mine === generation) {
        state.scanning = false;
        if (ok) {
          // `finishedAt` is the last *successful* fold: it feeds `updatedAt`, so a
          // failed attempt must not claim the data was just refreshed.
          state.error = null;
          state.finishedAt = Date.now();
          state.lastScanMs = state.finishedAt - state.lastAttemptAt;
          scheduleFoldsPersist();
        }
      }
    }
  })();
}

/** Serve one summary request, folding only what is still unknown. */
function summaryFor(ctx, query, force) {
  if (!state.scanning) {
    const now = Date.now();
    const cooled = state.lastAttemptAt === 0 || now - state.lastAttemptAt > SCAN_RETRY_MS;
    // No time-based staleness: live events keep the cells current, so a pass is
    // only needed for work the live feed cannot supply — the first pass, a session
    // that appeared without a cell, or an attempt that failed / could not read.
    // (`scanned.size` is deliberately not used here: an empty corpus completes a
    // pass with nothing scanned, and would otherwise re-scan on every cooldown.)
    const firstPass = state.finishedAt === 0;
    const appeared = pending.size > 0;
    const retryable = cooled && (state.error !== null || state.unreadable > 0);
    const healthy = state.error === null;
    if (force) startScan(ctx, { force: true });
    else if ((healthy && (firstPass || appeared)) || retryable) startScan(ctx);
  }
  return buildSnapshot(query);
}

/** Read the filter query out of one request URL. */
function queryOf(req) {
  try {
    const url = new URL(String(req.url), 'http://localhost');
    const range = Number(url.searchParams.get('range'));
    return {
      range: RANGES.includes(range) ? range : 30,
      cwd: url.searchParams.get('cwd') || 'all',
      scope: url.searchParams.get('scope') || 'all',
      refresh: url.searchParams.get('refresh') === '1',
    };
  } catch {
    return { range: 30, cwd: 'all', scope: 'all', refresh: false };
  }
}

/** Host plugin body. */
export function apply(ctx) {
  const rejected = (req, res) => {
    const rejection = Reflect.get(ctx, 'connection').requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };
  ctx.effect(() => () => {
    // Unload abandons any in-flight scan so it cannot touch a dead context, and
    // drops the module-level fold cache: a later re-enable of this plugin runs
    // against a fresh scan instead of reusing cells nobody invalidated.
    generation += 1;
    state.scanning = false;
    state.done = 0;
    state.total = 0;
    state.finishedAt = 0;
    state.lastAttemptAt = 0;
    state.lastScanMs = 0;
    state.lastEventAt = 0;
    state.unreadable = 0;
    state.error = null;
    cells.clear();
    scanned.clear();
    pending.clear();
    pendingMisses.clear();
    folding.clear();
    tail.clear();
    folds.loaded = false;
    ring.stepStarts.clear();
    // Also drop the window itself: `loadRing` must repopulate it from disk, never
    // inherit rows from the previous enable.
    ring.calls.length = 0;
    ring.loaded = false;
  }, 'usage-stats: abandon scan');
  ctx.effect(() => {
    loadRing();
    loadFolds();
    // A hard `exit` skips the debounce timers, so flush on the way out too.
    const onExit = () => {
      for (const timer of [ring.flushTimer, folds.flushTimer]) {
        if (timer !== null) clearTimeout(timer);
      }
      ring.flushTimer = null;
      folds.flushTimer = null;
      persistRing();
      persistFolds();
    };
    process.once('exit', onExit);
    return () => {
      process.off('exit', onExit);
      // Flush the tail so a clean restart keeps the table filled, then forget it:
      // the next enable restores from the file, not from this process.
      if (ring.flushTimer !== null) {
        clearTimeout(ring.flushTimer);
        ring.flushTimer = null;
      }
      if (folds.flushTimer !== null) {
        clearTimeout(folds.flushTimer);
        folds.flushTimer = null;
      }
      persistRing();
      persistFolds();
      ring.calls.length = 0;
      ring.loaded = false;
    };
  }, 'usage-stats: rolling call window');
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      acceptLiveEvent(session, event);
    } catch {
      // A malformed event must never break the committed append.
    }
  }), 'usage-stats: live call feed');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req, res) => {
      if (rejected(req, res)) return;
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET');
        res.end();
        return;
      }
      const query = queryOf(req);
      try {
        sendJson(res, 200, summaryFor(ctx, query, query.refresh));
      } catch (cause) {
        sendJson(res, 500, {
          code: 'summary-failed',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  }), `usage-stats: GET ${ROUTE_PATH}`);
}
