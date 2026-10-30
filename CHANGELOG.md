# Changelog

All notable changes to this package. Versions follow [semver](https://semver.org/).

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
