# Changelog

All notable changes to this package. Versions follow [semver](https://semver.org/).

## 2.2.0 — 2026-11-16

A restart no longer re-reads session logs that did not change. Requires DSH
`0.2.2-rc.3` or newer for the saving; older hosts keep the previous behaviour.

- **Revision-gated folds.** On each start the host asks `sessionPersistence.list()`
  for one revision per session (directory metadata plus each log's header frame —
  no body decompression) and compares it with the revision stored next to the
  saved fold. Unchanged → skipped. Measured on a 24-session corpus: 2.3 s of
  reading (137 MB plaintext, 38k events) against 4 ms of metadata.
- **Live sessions use their cursor instead.** A running session's artifact may
  trail its memory, so a file revision says nothing about it; `observeSession()`
  answers from `session.seq` without copying the event array or touching disk.
- **Every uncertainty reads.** A skip needs `location.kind === 'jsonl'` plus a
  complete revision and `sizeBytes` on both sides. A different backend, an older
  host, a missing service, a failed or timed-out read, or a malformed stamp all
  fall back to reading, so the worst case is the old cost rather than a frozen
  number.
- **Stamps travel with their fold.** A revision is recorded only beside a fold
  that actually happened; a session that was skipped or failed to read never
  inherits one, because that would tell the next start a log state had been
  folded when it had not.
- **`FOLD_LOGIC_VERSION`.** Changing what a fold means now distrusts every stored
  revision and forces one full re-fold, instead of carrying numbers the current
  code would never produce.
- **Weekly full pass.** Revision comparability across processes is a property of
  the JSONL backend, not a promise of the service contract; after seven days
  without one, the next start re-reads everything.
- **`folds.json` version 2**: adds `logic`, `lastFullAt`, and a per-session
  `rev` / `size` / `kind`. A version 1 file is upgraded in place (its cells still
  warm the first paint, and every session is read once to establish a stamp).
  Downgrading is safe: a 2.1.x build ignores the new file and re-folds.
- New `test/gate.test.mjs` (11 scenarios); `npm test` now runs eight suites.

## 2.1.1 — 2026-10-30

Security and repository hygiene. No behaviour change in the panel, no API change.

- Test fixtures no longer carry a private gateway/provider fingerprint (`provider` /
  `model` identifiers are neutral placeholders).
- `.gitignore` now covers local credential material: `.npmrc`, `.env*`, `*.pem`,
  `*.key`, `*.p12`, `*.pfx`, `credentials*`.
- New `npm run check:secrets` (also part of `npm test` and both CI workflows): scans
  tracked files for npm/GitHub tokens, private-key blocks, `_authToken` and
  `secret`/`password` assignments, bearer headers, and absolute Windows user paths.
- README documents the credential boundary: the plugin reads no credential file and no
  API-key environment variable, and writes only `$DSH_HOME/usage-stats/*.json`.
- Repository history was rewritten so a personal email address no longer appears in any
  commit or tag (commit SHAs change; published artifacts are unaffected).
- CI: `publish.yml` publishes from `v*` tags through npm trusted publishing (OIDC) into
  the staged-publish queue, with tag/version and duplicate-version guards.

## 2.1.0 — 2026-10-30

First release candidate for public distribution on DeepSeek Harness 0.2.1-rc.x.

### Data layer

- **Incremental aggregation.** Usage is now maintained from the live `session/event`
  feed (`applyEventToCell`, shared with the full-log fold) instead of rescanning
  every log on a timer. A normal request reads memory only.
- **Persisted folds.** Per-session folds are mirrored to
  `$DSH_HOME/usage-stats/folds.json` (≈1 KB per session, debounced, atomic,
  flushed on unload/exit), so the first paint after a restart is already populated.
- **One fold pass per process start**, plus a pass for sessions that appear later;
  `?refresh=1` re-reads everything for reconciliation.
- **Concurrency safety.** Live events that land while a log is being read are
  buffered and replayed at commit time (`commitFold`), a fold never rolls an
  advanced cell back, and a batch's slow session can no longer swallow a fast
  session's events.
- **Bounded failures.** `listSessions`/`readSession` time out after 60 s, a failed
  attempt keeps the last good fold, and retries respect a 15 s cooldown.

### Reporting

- Cards are lifetime figures; the trend, model donut and token composition follow
  the selected range (7 / 30 days); the heatmap covers the last year.
- Trend chart: bars for 7 days, monotone lines for 30 days, per-range switch;
  area-free Fritsch–Carlson interpolation, no overshoot.
- Model donut and its rows share one slice list (top 3 + "other models").
- Call details: rolling window of the last 100 observed calls, 20 per page,
  kept across restarts, with the upstream-reported model shown when it differs.
- CSV export carries a UTF-8 BOM and neutralizes formula-looking cells.

### Known limitations

- The first pass after a process start reads every session once: `SessionRecord`
  exposes no lastSeq/mtime, so the plugin cannot tell whether a log grew while the
  app was closed. `folds.json` makes that pass invisible in the UI.
- `folds.json` / `recent-calls.json` are global to `DSH_HOME`, not per profile, and
  `folds.json` is rewritten as a whole.
- The call window never backfills history: it starts with the first call observed
  after installation.
- Charts are mouse-only for per-day values; the heatmap and trend expose a single
  summary to screen readers.

## 2.0.0 — 2026-10-23

- Rebuilt the panel on the layout of lanlandeli/dsh-usage-stats (MIT) for
  DeepSeek Harness 0.2.x: sidebar entry + full-size page, six cards, one-year
  heatmap, daily trend, model donut, token composition, call details, filters and
  export.
- v2 payload contract (`version: 2`) and a version gate in the client.
