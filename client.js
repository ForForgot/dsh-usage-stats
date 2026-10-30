/**
 * Browser half of the usage-statistics bundle.
 *
 * Registers one full-size main panel ("使用统计") beside the shipped panels,
 * plus its sidebar entry. The layout, sections, and copy follow
 * lanlandeli/dsh-usage-stats (MIT): a top bar with the page title, the
 * `应用用量` tab and `返回对话`; a range switch; workspace/task filters with
 * CSV/JSON export; six summary cards; a one-year activity heatmap; a stacked
 * daily token bar chart; a model-share donut; and the token composition.
 *
 * All numbers come pre-aggregated from the Host half
 * (`usage-stats/summary`), which folds the local Session logs.
 */
window.__ModuleLoader__.load({
  id: '@forforgot/dsh-usage-stats',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-usage-stats';
    const ROUTE = 'usage-stats/summary';
    const PANEL_ID = 'usage-stats';

    // ---------------------------------------------------------------------
    // Text
    // ---------------------------------------------------------------------

    const DICT = {
      'zh-CN': {
        'nav': '使用统计',
        'title': '使用统计',
        'tab.appUsage': '应用用量',
        'back': '返回对话',
        'range.label': '趋势范围',
        'range.7': '最近 7 天',
        'range.30': '最近 30 天',
        'range.days': '最近 {days} 天',
        'filter.workspace': '全部工作区',
        'filter.task': '全部任务',
        'filter.task.root': '仅主任务',
        'filter.task.sub': '仅子任务',
        'export.csv': 'CSV',
        'export.json': 'JSON',
        'card.tokens': 'Tokens 用量',
        'card.tokens.detail': '输入 {input} · 输出 {output} · 缓存 {cache}',
        'card.sessions': '会话数量',
        'card.sessions.detail': '{sub} 个子任务会话',
        'card.messages': '消息数量',
        'card.messages.detail': '{requests} 次模型请求',
        'card.activeDays': '活跃天数',
        'card.activeDays.detail': '最长连续 {days} 天',
        'card.streak': '当前连续天数',
        'card.streak.active': '今日已计入',
        'card.streak.gap': '今日尚未使用',
        'card.topModel': '最常用模型',
        'card.topModel.detail': '{share} 用量占比',
        'card.empty': '暂无数据',
        'heat.title': '活跃热力图',
        'heat.less': '较少',
        'heat.more': '较多',
        'heat.summary': '近一年活跃热力图，{days} 天有用量',
        'heat.cell': '{date}（{tokens} tokens · {requests} 次请求）',
        'trend.title': '按天 Token 趋势',
        'trend.noteBar': '按模型堆叠',
        'trend.noteLine': '每个模型一条线',
        'trend.bar': '柱状',
        'trend.line': '折线',
        'trend.mode': '图表类型',
        'refresh': '刷新',
        'trend.day': '{date} 合计 {tokens} tokens',
        'trend.empty': '所选区间暂无用量',
        'state.starting': '正在读取会话列表…',
        'model.title': '模型用量',
        'model.note': '所选区间的输入、输出与缓存合计',
        'model.meta': '{tokens} tokens · {requests} 次调用',
        'model.empty': '暂无模型数据',
        'model.other': '其他模型',
        'model.tokens': 'tokens',
        'composition.title': 'Token 构成',
        'composition.input': '输入',
        'composition.output': '输出',
        'composition.cacheRead': '缓存读取',
        'composition.cacheWrite': '缓存写入',
        'composition.scopeOnly': '所选区间',
        'calls.title': '调用明细',
        'calls.note': '最近 {limit} 次 · 最新在前 · 重启后保留',
        'calls.noteActual': '最近 {limit} 次 · {count} 条上游自报了不同模型',
        'calls.time': '时间',
        'calls.model': '模型',
        'calls.input': '输入',
        'calls.output': '输出',
        'calls.cacheRate': '缓存率',
        'calls.duration': '步骤耗时',
        'calls.provider': '供应商',
        'calls.modelFromUpstream': '模型名来自上游响应',
        'calls.modelFromRoute': '模型名来自请求路由（上游未自报）',
        'calls.subSecond': '<1 秒',
        'calls.page': '{start}–{end} / 共 {total} 条',
        'calls.prev': '上一页',
        'calls.next': '下一页',
        'calls.empty': '暂无调用记录',
        'calls.stale': '调用明细需要重启 DeepSeek Harness 后才会出现。',
        'state.loading': '正在读取本地会话历史…',
        'state.summarizing': '正在汇总 {done}/{total} 个会话…',
        'state.error': '读取用量数据失败：{message}',
        'state.retry': '重试',
        'state.empty': '还没有可展示的用量数据',
        'state.stale': '插件已更新，请重启 DeepSeek Harness 后刷新本页。',
        'state.renderFailed': '使用统计渲染失败',
      },
      'en-US': {
        'nav': 'Usage',
        'title': 'Usage',
        'tab.appUsage': 'App usage',
        'back': 'Back to chat',
        'range.label': 'Trend range',
        'range.7': 'Last 7 days',
        'range.30': 'Last 30 days',
        'range.days': 'Last {days} days',
        'filter.workspace': 'All workspaces',
        'filter.task': 'All tasks',
        'filter.task.root': 'Main tasks only',
        'filter.task.sub': 'Subtasks only',
        'export.csv': 'CSV',
        'export.json': 'JSON',
        'card.tokens': 'Tokens used',
        'card.tokens.detail': 'Input {input} · Output {output} · Cache {cache}',
        'card.sessions': 'Sessions',
        'card.sessions.detail': '{sub} subtask sessions',
        'card.messages': 'Messages',
        'card.messages.detail': '{requests} model requests',
        'card.activeDays': 'Active days',
        'card.activeDays.detail': 'Longest streak {days} days',
        'card.streak': 'Current streak',
        'card.streak.active': 'counted today',
        'card.streak.gap': 'not used today yet',
        'card.topModel': 'Top model',
        'card.topModel.detail': '{share} of usage',
        'card.empty': 'No data yet',
        'heat.title': 'Activity heatmap',
        'heat.less': 'Less',
        'heat.more': 'More',
        'heat.summary': 'Activity heatmap for the last year, {days} active days',
        'heat.cell': '{date} ({tokens} tokens · {requests} requests)',
        'trend.title': 'Daily token trend',
        'trend.noteBar': 'Stacked by model',
        'trend.noteLine': 'One line per model',
        'trend.bar': 'Bars',
        'trend.line': 'Lines',
        'trend.mode': 'Chart type',
        'refresh': 'Refresh',
        'trend.day': '{date}: {tokens} tokens',
        'trend.empty': 'No usage in this range',
        'model.title': 'Model usage',
        'model.note': 'Input, output and cache inside the selected range',
        'model.meta': '{tokens} tokens · {requests} calls',
        'model.empty': 'No model data',
        'model.other': 'Other models',
        'model.tokens': 'tokens',
        'composition.title': 'Token composition',
        'composition.input': 'Input',
        'composition.output': 'Output',
        'composition.cacheRead': 'Cache read',
        'composition.cacheWrite': 'Cache write',
        'composition.scopeOnly': 'Selected range',
        'calls.title': 'Call details',
        'calls.note': 'Newest {limit} · newest first · kept across restarts',
        'calls.noteActual': 'Newest {limit} · {count} report a different upstream model',
        'calls.time': 'Time',
        'calls.model': 'Model',
        'calls.input': 'Input',
        'calls.output': 'Output',
        'calls.cacheRate': 'Cache',
        'calls.duration': 'Step time',
        'calls.provider': 'Provider',
        'calls.modelFromUpstream': 'model name reported by the upstream response',
        'calls.modelFromRoute': 'model name from the request route (upstream silent)',
        'calls.subSecond': '<1s',
        'calls.page': '{start}–{end} of {total}',
        'calls.prev': 'Previous',
        'calls.next': 'Next',
        'calls.empty': 'No calls yet',
        'calls.stale': 'Call details appear after restarting DeepSeek Harness.',
        'state.starting': 'Reading the session list…',
        'state.loading': 'Reading local Session history…',
        'state.summarizing': 'Summarizing {done}/{total} sessions…',
        'state.error': 'Could not read usage data: {message}',
        'state.retry': 'Retry',
        'state.empty': 'No usage data to show yet',
        'state.stale': 'The plugin was updated. Restart DeepSeek Harness, then reload this page.',
        'state.renderFailed': 'The usage page failed to render',
      },
    };

    function dictFor(localeId) {
      if (DICT[localeId]) return DICT[localeId];
      if (String(localeId || '').toLowerCase().startsWith('zh')) return DICT['zh-CN'];
      return DICT['en-US'];
    }

    function fill(text, vars) {
      if (vars === undefined) return text;
      return String(text).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
    }

    // ---------------------------------------------------------------------
    // Formatting
    // ---------------------------------------------------------------------

    function isZh(localeId) {
      return String(localeId || '').toLowerCase().startsWith('zh');
    }

    /** Compact token count: 亿/万 in Chinese, K/M/B otherwise. */
    function tokenText(localeId, value) {
      const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      const trim = (text) => text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
      if (isZh(localeId)) {
        if (Math.abs(amount) >= 1e8) return `${trim((amount / 1e8).toFixed(2))}亿`;
        if (Math.abs(amount) >= 1e4) return `${trim((amount / 1e4).toFixed(1))}万`;
        return String(Math.round(amount));
      }
      const size = Math.abs(amount);
      if (size < 1000) return String(Math.round(amount));
      for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
        if (size >= scale) return `${trim((amount / scale).toFixed(Math.abs(amount / scale) >= 10 ? 1 : 2))}${suffix}`;
      }
      return String(Math.round(amount));
    }

    function countText(value) {
      const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      try {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount);
      } catch {
        return String(Math.round(amount));
      }
    }

    function percentText(share) {
      const value = typeof share === 'number' && Number.isFinite(share) ? share : 0;
      const percent = value * 100;
      const digits = percent >= 10 ? 1 : 2;
      return `${percent.toFixed(digits).replace(/\.0+$/, '')}%`;
    }

    function dayKeyOfDate(date) {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return `${date.getFullYear()}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
    }

    function parseDayKey(key) {
      const parts = String(key).split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }

    function formatDay(key, localeId, options) {
      if (!key) return '';
      try {
        return new Intl.DateTimeFormat(localeId || undefined, options || { month: 'short', day: 'numeric' }).format(parseDayKey(key));
      } catch {
        return String(key);
      }
    }

    /** Short tail of a workspace path, for the filter row. */
    function workspaceLabel(cwd) {
      if (!cwd) return '';
      const parts = String(cwd).split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 1) return cwd;
      return parts.slice(-2).join('/');
    }

    const MODEL_COLORS = ['#1677ff', '#2aa86f', '#b9d9ff', '#f0a03a', '#8e6bff', '#12b5b0'];

    /** Bucket for the models a chart folds together beyond its visible series. */
    const OTHER_MODEL = '__other__';

    function colorOf(index) {
      return MODEL_COLORS[index % MODEL_COLORS.length];
    }

    /** Models ordered by the usage inside `days`, busiest first. */
    function rangeModelRanking(days) {
      const totals = new Map();
      for (const day of days) {
        for (const [model, tokens] of Object.entries(day.models || {})) {
          totals.set(model, (totals.get(model) || 0) + tokens);
        }
      }
      return [...totals.entries()].sort((left, right) => right[1] - left[1]).map(([model]) => model);
    }

    /**
     * The three weekday labels beside the heatmap (Mon / Wed / Fri), formatted by
     * the active locale. A fixed Sunday reference week keeps this independent of
     * how many cells the payload happens to carry.
     */
    function weekdayLabelsOf(localeId) {
      try {
        const formatter = new Intl.DateTimeFormat(localeId, { weekday: 'short' });
        const sunday = new Date(2024, 0, 7);
        return [1, 3, 5].map((row) => formatter.format(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + row)));
      } catch {
        // An Intl implementation without this locale must not blank the heatmap.
        return ['', '', ''];
      }
    }

    // ---------------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------------

    /** Scan progress poll: quick enough to watch the background fold advance. */
    const SCAN_POLL_MS = 900;

    /** Idle refresh while the page is visible: keeps the live call window current. */
    const IDLE_POLL_MS = 60 * 1000;

    function useUsage(initial) {
      const [selection, setSelection] = React.useState(initial);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [nonce, setNonce] = React.useState(0);
      const forceRef = React.useRef(false);

      const refresh = React.useCallback(() => {
        forceRef.current = true;
        setNonce((value) => value + 1);
      }, []);

      React.useEffect(() => {
        let cancelled = false;
        let timer = null;
        let first = true;

        const visible = () => typeof document === 'undefined'
          || document.visibilityState !== 'hidden';

        const schedule = (delay) => {
          if (cancelled) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            void tick();
          }, delay);
        };

        const tick = async () => {
          const params = new URLSearchParams({
            range: String(selection.range),
            cwd: selection.cwd,
            scope: selection.scope,
          });
          if (first && forceRef.current) params.set('refresh', '1');
          first = false;
          forceRef.current = false;
          try {
            const response = await fetch(`${ROUTE}?${params.toString()}`, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (cancelled) return;
            setData(payload);
            setError(payload && payload.error ? String(payload.error) : null);
            if (payload && payload.scanning) schedule(SCAN_POLL_MS);
            else if (visible()) schedule(IDLE_POLL_MS);
          } catch (cause) {
            if (cancelled) return;
            setError(cause instanceof Error ? cause.message : String(cause));
            if (visible()) schedule(IDLE_POLL_MS);
          }
        };

        // Coming back to the page refreshes at once instead of waiting out the interval.
        const onVisibility = () => {
          if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
          if (visible()) {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            void tick();
          } else if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
        };

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility);
        }
        void tick();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility);
          }
        };
      }, [selection.range, selection.cwd, selection.scope, nonce]);

      return { selection, setSelection, data, error, refresh };
    }

    /** Trigger a client-side file download. */
    function download(name, text, type) {
      try {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch {
        // A blocked download must not break the page.
      }
    }

    function csvOf(data) {
      const days = (data && data.daily) || [];
      const models = (data && data.models) || [];
      const columns = models.map((entry) => entry.model);
      const lines = [];
      lines.push(['day', 'tokens', 'requests', ...columns].map(escapeCsv).join(','));
      for (const day of days) {
        lines.push([day.day, day.tokens, day.requests, ...columns.map((model) => (day.models && day.models[model]) || 0)]
          .map(escapeCsv)
          .join(','));
      }
      const summary = (data && data.summary) || {};
      lines.push('');
      lines.push(['metric', 'value'].join(','));
      for (const [key, value] of [
        ['total_tokens', summary.totalTokens],
        ['input_tokens', summary.inputTokens],
        ['output_tokens', summary.outputTokens],
        ['cache_read_tokens', summary.cacheReadTokens],
        ['cache_write_tokens', summary.cacheWriteTokens],
        ['sessions', summary.sessions],
        ['messages', summary.messages],
        ['requests', summary.requests],
        ['active_days', summary.activeDays],
        ['current_streak_days', summary.currentStreakDays],
        ['longest_streak_days', summary.longestStreakDays],
        ['top_model', summary.topModel ? summary.topModel.model : ''],
        ['range', data && data.selection ? data.selection.range : ''],
        ['cwd', data && data.selection ? data.selection.cwd : ''],
        ['scope', data && data.selection ? data.selection.scope : ''],
      ]) {
        lines.push([key, typeof value === 'number' ? value : String(value === undefined || value === null ? '' : value)].map(escapeCsv).join(','));
      }
      return `${lines.join('\n')}\n`;
    }

    /**
     * CSV cell escaping. Values a spreadsheet could evaluate as a formula are
     * prefixed with an apostrophe, so a model name or path starting with
     * `= + - @` stays text instead of running.
     */
    function escapeCsv(value) {
      let text = String(value === undefined || value === null ? '' : value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = String.raw`
.us-root {
  --us-bg: var(--dsw-alias-bg-base, #ffffff);
  --us-surface: var(--dsw-alias-bg-layer-1, #f5f5f5);
  --us-raised: var(--dsw-alias-bg-layer-2, #ffffff);
  --us-text: var(--dsw-alias-label-primary, #17191c);
  --us-muted: var(--dsw-alias-label-secondary, #747b86);
  --us-border: var(--dsw-alias-border-l1, #e4e7eb);
  --us-hover: var(--dsw-alias-bg-layer-2, #eef1f4);
  --us-accent: var(--dsw-alias-brand-primary, #1677ff);
  --us-shadow-soft: 0 1px 2px rgba(18, 26, 41, .03), 0 8px 28px rgba(18, 26, 41, .035);
  position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column;
  color: var(--us-text); background: var(--us-bg); font-size: 14px; line-height: 1.45; box-sizing: border-box;
}
.us-root *, .us-root *::before, .us-root *::after { box-sizing: border-box; }
.us-root button, .us-root select, .us-root table { font: inherit; color: inherit; }
.us-top { flex: none; min-height: 86px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px clamp(20px, 4vw, 52px) 8px; }
.us-heading { display: flex; align-items: flex-end; gap: 18px; min-width: 0; }
.us-title { font-size: clamp(26px, 2.8vw, 36px); line-height: 1.1; font-weight: 750; letter-spacing: -.045em; }
.us-tab { position: relative; padding: 0 2px 8px; font-size: 15px; white-space: nowrap; }
.us-tab::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 2px; background: currentColor; }
.us-back { height: 38px; flex: none; display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 12px; padding: 0 13px; color: var(--us-muted); background: transparent; cursor: pointer; transition: color 150ms ease, background 150ms ease, transform 150ms ease; }
.us-back:hover { color: var(--us-text); background: var(--us-hover); transform: translateX(-2px); }
.us-back:focus-visible { outline: 2px solid var(--us-accent); outline-offset: 2px; }
.us-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 6px clamp(20px, 4vw, 52px) 40px; }
.us-content { width: min(1180px, 100%); margin: 0 auto; }
.us-range-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 12px; }
.us-range-label { font-size: 15px; font-weight: 520; }
.us-segment { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--us-border); border-radius: 11px; background: var(--us-raised); }
.us-segment button { border: 0; min-width: 96px; padding: 6px 12px; border-radius: 8px; color: var(--us-muted); background: transparent; cursor: pointer; white-space: nowrap; }
.us-segment button[aria-pressed="true"] { color: var(--us-text); background: var(--us-hover); box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.us-segment button:focus-visible { outline: 2px solid var(--us-accent); outline-offset: 1px; }
.us-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px; margin-bottom: 14px; border: 1px solid color-mix(in srgb, var(--us-border) 72%, transparent); border-radius: 14px; background: color-mix(in srgb, var(--us-surface) 70%, transparent); }
.us-field { height: 36px; min-width: 150px; max-width: 260px; padding: 0 10px; border: 1px solid transparent; border-radius: 10px; background: var(--us-raised); cursor: pointer; outline: none; transition: border-color 140ms ease, box-shadow 140ms ease; }
.us-field:hover { border-color: var(--us-border); }
.us-field:focus-visible { border-color: var(--us-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--us-accent) 14%, transparent); }
.us-spacer { flex: 1 1 auto; }
.us-export { height: 36px; display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 10px; padding: 0 11px; background: transparent; color: var(--us-muted); cursor: pointer; font-size: 13px; transition: color 140ms ease, background 140ms ease; }
.us-export:hover { color: var(--us-text); background: var(--us-raised); }
.us-export:disabled { opacity: .45; cursor: default; background: transparent; color: var(--us-muted); }
.us-export:focus-visible { outline: 2px solid var(--us-accent); outline-offset: 2px; }
.us-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.us-card, .us-panel { border: 1px solid color-mix(in srgb, var(--us-border) 55%, transparent); background: var(--us-surface); border-radius: 16px; box-shadow: var(--us-shadow-soft); }
.us-card { min-height: 108px; padding: 16px 18px; transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease; }
.us-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--us-border) 88%, transparent); box-shadow: 0 2px 3px rgba(18,26,41,.04), 0 14px 36px rgba(18,26,41,.07); }
.us-card-label { display: flex; align-items: center; gap: 8px; color: var(--us-muted); font-size: 13.5px; }
.us-card-value { margin-top: 9px; font-size: clamp(26px, 2.5vw, 34px); line-height: 1.05; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.us-card-detail { margin-top: 7px; color: var(--us-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.us-panel { margin-top: 14px; padding: 17px 19px; overflow: hidden; }
.us-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.us-panel-title { font-size: 15.5px; font-weight: 620; }
.us-panel-note { color: var(--us-muted); font-size: 12px; }
.us-heat-panel { overflow: visible; }
.us-heat-scroll { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 2px 2px 12px; }
.us-heat-week { flex: none; display: grid; grid-template-rows: repeat(7, 1fr); gap: 3px; width: 24px; overflow: hidden; color: var(--us-muted); font-size: 10px; line-height: 1; }
.us-heat-week span:nth-child(1) { grid-row: 2; }
.us-heat-week span:nth-child(2) { grid-row: 4; }
.us-heat-week span:nth-child(3) { grid-row: 6; }
.us-heat-grid-wrap { flex: 1; min-width: 0; }
.us-heat-months { display: grid; grid-template-columns: repeat(53, minmax(0, 1fr)); gap: 2px; margin-bottom: 4px; height: 14px; color: var(--us-muted); font-size: 10px; }
.us-heat-months span { white-space: nowrap; }
.us-heat { display: grid; grid-template-rows: repeat(7, auto); grid-template-columns: repeat(53, minmax(0, 1fr)); grid-auto-flow: column; gap: clamp(2px, .26vw, 4px); width: 100%; }
.us-cell { width: 100%; max-width: 14px; aspect-ratio: 1; justify-self: center; border-radius: 3px; background: color-mix(in srgb, var(--us-border) 66%, transparent); }
.us-cell[data-level="1"] { background: #cfe4ff; }
.us-cell[data-level="2"] { background: #a4cdff; }
.us-cell[data-level="3"] { background: #6cadfc; }
.us-cell[data-level="4"] { background: #3389ec; }
.us-cell[data-level="5"] { background: #1068ca; }
.us-cell[data-future="true"] { opacity: 0; }
.us-cell-tip { cursor: default; outline: none; transition: transform 90ms ease, box-shadow 90ms ease; }
.us-cell-tip:hover, .us-cell-tip:focus-visible { transform: scale(1.14); box-shadow: 0 0 0 2px var(--us-bg), 0 0 0 3px var(--us-text); z-index: 3; }
.us-heat-legend { display: inline-flex; align-items: center; gap: 5px; color: var(--us-muted); font-size: 11.5px; }
.us-heat-legend .us-cell { width: 12px; height: 12px; max-width: none; }
.us-floating-tip { position: fixed; z-index: 200; transform: translate(-50%, -100%); width: max-content; max-width: min(340px, calc(100vw - 24px)); padding: 8px 10px; border: 1px solid var(--us-border); border-radius: 10px; color: var(--us-text); background: var(--us-raised); box-shadow: 0 12px 38px rgba(0,0,0,.16); font-size: 12px; line-height: 1.45; pointer-events: none; }
.us-trend-body { padding: 14px 8px 0; border-radius: 12px; background: color-mix(in srgb, var(--us-raised) 38%, transparent); }
.us-chart-frame { position: relative; height: 300px; }
.us-grid-lines { position: absolute; inset: 12px 14px 42px; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
.us-grid-lines i { display: block; width: 100%; border-top: 1px dashed color-mix(in srgb, var(--us-border) 72%, transparent); }
.us-chart { position: absolute; inset: 12px 14px 0; display: flex; align-items: stretch; gap: clamp(8px, 1.4vw, 24px); }
.us-chart[data-dense="true"] { gap: clamp(2px, .35vw, 6px); }
.us-bar-column { min-width: 0; flex: 1 1 0; display: grid; grid-template-rows: minmax(0, 1fr) 42px; align-items: end; }
.us-bar-wrap { width: min(66%, 72px); min-width: 3px; height: 100%; justify-self: center; display: flex; flex-direction: column-reverse; justify-content: flex-start; border-bottom: 1px solid color-mix(in srgb, var(--us-border) 90%, transparent); }
.us-chart[data-dense="true"] .us-bar-wrap { width: clamp(4px, 56%, 20px); }
.us-bar-hit { width: 100%; height: 100%; display: flex; flex-direction: column-reverse; justify-content: flex-start; border-radius: 3px 3px 0 0; outline: none; cursor: default; }
.us-bar-segment { flex: none; width: 100%; min-height: 1px; }
.us-bar-segment:last-child { border-radius: 3px 3px 0 0; }
.us-bar-hit:hover .us-bar-segment { filter: saturate(1.1) brightness(1.05); }
.us-date-label { align-self: start; justify-self: center; padding-top: 10px; color: var(--us-muted); font-size: 11.5px; line-height: 18px; text-align: center; white-space: nowrap; }
.us-panel-head-side { display: inline-flex; align-items: center; gap: 10px; }
.us-chart-toggle { display: inline-flex; gap: 4px; }
.us-chart-toggle button { height: 26px; padding: 0 10px; border: 1px solid var(--us-border); border-radius: 8px; background: var(--us-raised); color: var(--us-muted); cursor: pointer; font-size: 12px; line-height: 1; }
.us-chart-toggle button:hover { background: var(--us-hover); }
.us-chart-toggle button[aria-pressed="true"] { color: var(--us-text); border-color: var(--us-accent); }
.us-chart-toggle button:focus-visible { outline: 2px solid var(--us-accent); outline-offset: 2px; }
.us-line { display: block; width: 100%; height: auto; overflow: visible; }
.us-line text { fill: currentColor; opacity: .55; font-size: 9px; font-family: inherit; }
.us-line-grid { stroke: currentColor; opacity: .22; stroke-width: 1; stroke-dasharray: 3 4; }
.us-line-base { stroke: currentColor; opacity: .16; stroke-width: 1; }
.us-line-guide { stroke: currentColor; opacity: .28; stroke-width: 1; stroke-dasharray: 3 3; }
.us-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px; margin-top: 12px; color: var(--us-muted); font-size: 12.5px; }
.us-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; vertical-align: middle; }
.us-model-layout { display: grid; grid-template-columns: 220px 1fr; align-items: center; gap: 26px; }
.us-donut { width: 180px; aspect-ratio: 1; margin: auto; border-radius: 50%; display: grid; place-items: center; position: relative; }
.us-donut::after { content: ''; position: absolute; inset: 26px; border-radius: 50%; background: var(--us-surface); }
.us-donut-center { position: relative; z-index: 1; text-align: center; font-weight: 700; font-size: 22px; font-variant-numeric: tabular-nums; }
.us-donut-center small { display: block; margin-top: 2px; color: var(--us-muted); font-weight: 400; font-size: 11px; }
.us-model-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; padding: 11px 0; border-bottom: 1px solid color-mix(in srgb, var(--us-border) 70%, transparent); }
.us-model-row:last-child { border-bottom: 0; }
.us-model-name { font-weight: 580; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.us-model-meta, .us-model-percent { color: var(--us-muted); font-size: 12px; }
.us-model-percent { font-variant-numeric: tabular-nums; }
.us-breakdown { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.us-break-item { min-width: 0; padding: 4px 14px 2px; border-left: 1px solid color-mix(in srgb, var(--us-border) 65%, transparent); }
.us-break-item:first-child { padding-left: 0; border-left: 0; }
.us-break-item span { display: block; color: var(--us-muted); font-size: 12.5px; margin-bottom: 4px; }
.us-break-item strong { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.us-calls-scroll { overflow-x: auto; }
.us-calls { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.us-calls th { padding: 7px 10px; text-align: left; font-weight: 500; color: var(--us-muted); border-bottom: 1px solid var(--us-border); white-space: nowrap; }
.us-calls td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--us-border) 45%, transparent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.us-calls tbody tr:last-child td { border-bottom: 0; }
.us-calls th.us-num, .us-calls td.us-num { text-align: right; }
.us-calls td.us-model { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.us-calls td.us-provider { max-width: 200px; overflow: hidden; text-overflow: ellipsis; color: var(--us-muted); }
.us-calls td.us-model .us-model-alias { color: var(--us-muted); }
.us-calls td.us-model .us-arrow { color: var(--us-muted); }
.us-calls td.us-model .us-model-actual { font-weight: 600; }
.us-calls tbody tr:hover td { background: color-mix(in srgb, var(--us-raised) 45%, transparent); }
.us-calls-pager { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 12px; font-size: 12px; color: var(--us-muted); }
.us-calls-pager button { height: 30px; padding: 0 11px; border: 1px solid var(--us-border); border-radius: 8px; background: var(--us-raised); color: inherit; cursor: pointer; font-size: 12px; }
.us-calls-pager button:hover:not(:disabled) { background: var(--us-hover); }
.us-calls-pager button:disabled { opacity: .45; cursor: default; }
.us-calls-pager button:focus-visible { outline: 2px solid var(--us-accent); outline-offset: 2px; }
.us-state { min-height: 60vh; display: grid; place-items: center; color: var(--us-muted); text-align: center; padding: 40px 16px; }
.us-spinner { width: 26px; height: 26px; margin: 0 auto 12px; border: 3px solid var(--us-border); border-top-color: var(--us-accent); border-radius: 50%; animation: us-spin .8s linear infinite; }
.us-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 9px 12px; border: 1px solid var(--dsw-alias-state-error-primary, #e2564d); border-radius: 10px; color: var(--dsw-alias-state-error-primary, #e2564d); font-size: 12.5px; }
.us-error button { border: 1px solid currentColor; border-radius: 8px; padding: 3px 10px; background: transparent; color: inherit; cursor: pointer; }
@keyframes us-spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .us-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .us-model-layout { grid-template-columns: 1fr; }
  .us-breakdown { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 12px; }
  .us-chart-frame { height: 260px; }
}
@media (max-width: 620px) {
  .us-cards { grid-template-columns: minmax(0, 1fr); }
  .us-tab { display: none; }
  .us-field { max-width: none; flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
  .us-spinner { animation: none; }
  .us-card, .us-back, .us-cell-tip { transition: none; }
}
`;

    // ---------------------------------------------------------------------
    // Pieces
    // ---------------------------------------------------------------------

    function Card(props) {
      return h('div', { className: 'us-card' },
        h('div', { className: 'us-card-label' }, props.label),
        h('div', { className: 'us-card-value', title: props.title || undefined }, props.value),
        h('div', { className: 'us-card-detail' }, props.detail || '\u00a0'));
    }

    /**
     * Where the floating tooltip goes.
     *
     * The element is translated by -50%/-100%, so `left`/`top` are an *anchor*:
     * the box hangs centred above it. The anchor is what gets clamped, otherwise
     * a cell at the left edge would put half the box off-screen.
     */
    function tipPosition(tip, size) {
      const width = size && size.width > 0 ? size.width : 220;
      const height = size && size.height > 0 ? size.height : 96;
      const margin = 8;
      const viewportW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280;
      const viewportH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
      const leftMin = width / 2 + margin;
      const leftMax = viewportW - width / 2 - margin;
      const topMin = height + margin;
      const topMax = viewportH - margin;
      const left = Math.min(Math.max(tip.x, leftMin), Math.max(leftMin, leftMax));
      const top = Math.min(Math.max(tip.y - margin, topMin), Math.max(topMin, topMax));
      return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
    }

    function FloatingTip(props) {
      const tip = props.tip;
      const nodeRef = React.useRef(null);
      const [size, setSize] = React.useState(null);
      // Measure the real box, then clamp with its width/height instead of a guess.
      React.useLayoutEffect(() => {
        const node = nodeRef.current;
        if (!node || !tip) return;
        const rect = node.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) {
          setSize({ width: rect.width, height: rect.height });
        }
      }, [tip]);
      if (!tip) return null;
      return h('div', {
        className: 'us-floating-tip',
        ref: nodeRef,
        style: tipPosition(tip, size),
        role: 'tooltip',
      }, tip.content);
    }

    /** Six summary cards. */
    function SummaryCards(props) {
      const t = props.t;
      const localeId = props.localeId;
      const summary = props.summary;
      const topModel = summary.topModel;
      return h('div', { className: 'us-cards' },
        h(Card, {
          key: 'tokens',
          label: t('card.tokens'),
          value: tokenText(localeId, summary.totalTokens),
          title: `${countText(summary.totalTokens)} tokens`,
          detail: fill(t('card.tokens.detail'), {
            input: tokenText(localeId, summary.inputTokens),
            output: tokenText(localeId, summary.outputTokens),
            cache: tokenText(localeId, (summary.cacheReadTokens || 0) + (summary.cacheWriteTokens || 0)),
          }),
        }),
        h(Card, {
          key: 'sessions',
          label: t('card.sessions'),
          value: countText(summary.sessions),
          detail: fill(t('card.sessions.detail'), { sub: countText(summary.subSessions || 0) }),
        }),
        h(Card, {
          key: 'messages',
          label: t('card.messages'),
          value: countText(summary.messages),
          detail: fill(t('card.messages.detail'), { requests: countText(summary.requests) }),
        }),
        h(Card, {
          key: 'active',
          label: t('card.activeDays'),
          value: countText(summary.activeDays),
          detail: fill(t('card.activeDays.detail'), { days: countText(summary.longestStreakDays) }),
        }),
        h(Card, {
          key: 'streak',
          label: t('card.streak'),
          value: countText(summary.currentStreakDays),
          detail: summary.activeToday ? t('card.streak.active') : t('card.streak.gap'),
        }),
        h(Card, {
          key: 'top',
          label: t('card.topModel'),
          value: topModel ? (topModel.model === 'unknown' ? t('model.other') : topModel.model) : t('card.empty'),
          title: topModel ? topModel.model : undefined,
          detail: topModel ? fill(t('card.topModel.detail'), { share: percentText(topModel.share) }) : '\u00a0',
        }));
    }

    /** One-year activity heatmap. */
    function Heatmap(props) {
      const t = props.t;
      const localeId = props.localeId;
      const days = props.days || [];
      // The Host owns the window length; 53 is only the fallback for an older payload.
      const weeks = Number.isInteger(props.weeks) && props.weeks > 0 ? props.weeks : 53;
      const gridStyle = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
      const [tip, setTip] = React.useState(null);

      const model = React.useMemo(() => {
        if (days.length === 0) return null;
        const values = days.filter((entry) => entry.tokens > 0).map((entry) => entry.tokens).sort((a, b) => a - b);
        const at = (fraction) => (values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * fraction))]);
        const levels = { q1: at(0.25), q2: at(0.5), q3: at(0.75), max: values.length === 0 ? 0 : values[values.length - 1] };
        const cells = days.map((entry) => {
          let level = 0;
          if (entry.tokens > 0) {
            if (entry.tokens >= levels.max) level = 5;
            else if (entry.tokens > levels.q3) level = 4;
            else if (entry.tokens > levels.q2) level = 3;
            else if (entry.tokens > levels.q1) level = 2;
            else level = 1;
          }
          return { ...entry, level };
        });
        const months = [];
        let lastMonth = -1;
        let lastWeek = -99;
        for (let index = 0; index < cells.length; index += 7) {
          const week = index / 7;
          const date = parseDayKey(cells[index].day);
          if (date.getMonth() !== lastMonth) {
            if (week - lastWeek >= 3 && week <= weeks - 2) {
              months.push({ week, day: cells[index].day });
              lastWeek = week;
            }
            lastMonth = date.getMonth();
          }
        }
        return { cells, months, max: levels.max, weekdayLabels: weekdayLabelsOf(localeId) };
      }, [days, weeks, localeId]);

      const monthFormatter = React.useMemo(() => {
        try {
          return new Intl.DateTimeFormat(localeId || undefined, { month: 'short' });
        } catch {
          return null;
        }
      }, [localeId]);

      if (model === null) return null;

      const showTip = (event, cell) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTip({
          x: rect.left + rect.width / 2,
          y: rect.top,
          content: fill(t('heat.cell'), {
            date: formatDay(cell.day, localeId, { year: 'numeric', month: 'short', day: 'numeric' }),
            tokens: countText(cell.tokens),
            requests: countText(cell.requests),
          }),
        });
      };

      return h('div', { className: 'us-panel us-heat-panel' },
        h('div', { className: 'us-panel-head' },
          h('div', { className: 'us-panel-title' }, t('heat.title')),
          h('div', { className: 'us-heat-legend' },
            h('span', null, t('heat.less')),
            [1, 2, 3, 4, 5].map((level) => h('span', { key: `lg-${level}`, className: 'us-cell', 'data-level': String(level) })),
            h('span', null, t('heat.more')))),
        h('div', { className: 'us-heat-scroll' },
          h('div', { className: 'us-heat-week', 'aria-hidden': true },
            model.weekdayLabels.map((label, index) => h('span', { key: `w-${index}` }, label))),
          h('div', { className: 'us-heat-grid-wrap' },
            h('div', { className: 'us-heat-months', style: gridStyle },
              model.months.map((entry) => h('span', {
                key: `m-${entry.day}`,
                style: { gridColumn: String(entry.week + 1) },
              }, monthFormatter ? monthFormatter.format(parseDayKey(entry.day)) : String(parseDayKey(entry.day).getMonth() + 1)))),
            h('div', {
              className: 'us-heat',
              style: gridStyle,
              role: 'img',
              'aria-label': fill(t('heat.summary'), {
                days: countText(model.cells.filter((cell) => cell.tokens > 0).length),
              }),
            },
              model.cells.map((cell) => h('span', {
                key: cell.day,
                className: 'us-cell us-cell-tip',
                'data-level': String(cell.level),
                'data-future': cell.future ? 'true' : undefined,
                'aria-hidden': true,
                onMouseEnter: cell.future ? undefined : (event) => showTip(event, cell),
                onMouseLeave: () => setTip(null),
              }))))),
        h(FloatingTip, { tip }));
    }

    /** Stacked daily token bars per model. */
    const LINE_W = 760;
    const LINE_H = 200;
    const LINE_PAD = { left: 44, right: 8, top: 10, bottom: 18 };

    /** Tooltip payload for one day, shared by both chart modes. */
    function trendTip(t, localeId, day, colorFor, x, y, nameOf) {
      const label = typeof nameOf === 'function' ? nameOf : (model) => model;
      const rows = Object.keys(day.models || {})
        .map((model) => ({ model, tokens: day.models[model] }))
        .sort((left, right) => right.tokens - left.tokens)
        .slice(0, 6);
      const content = h('div', null,
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, fill(t('trend.day'), {
          date: formatDay(day.day, localeId, { month: 'short', day: 'numeric' }),
          tokens: countText(day.tokens),
        })),
        rows.length === 0
          ? null
          : rows.map((row) => h('div', {
            key: row.model,
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
          },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } },
            h('span', { className: 'us-dot', style: { background: colorFor(row.model) } }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label(row.model))),
          h('span', { style: { fontVariantNumeric: 'tabular-nums' } },
            countText(row.tokens),
            h('span', { style: { color: 'var(--us-muted)', marginLeft: '3px' } }, t('model.tokens'))))));
      return { x, y, content };
    }

    /**
     * Monotone cubic path — the same curve Recharts' `type="monotone"` draws
     * (d3's `curveMonotoneX`, Fritsch–Carlson tangents). A local extremum gets a
     * zero tangent, so the curve never overshoots the data the way a
     * Catmull-Rom spline does.
     */
    function monotonePath(points) {
      const count = points.length;
      if (count === 0) return '';
      if (count === 1) return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

      const secants = new Array(count - 1);
      for (let index = 0; index < count - 1; index += 1) {
        const dx = points[index + 1].x - points[index].x;
        secants[index] = dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx;
      }

      // Tangent per point: flat at a turning point, otherwise the mean slope.
      const tangents = new Array(count);
      tangents[0] = secants[0];
      tangents[count - 1] = secants[count - 2];
      for (let index = 1; index < count - 1; index += 1) {
        if (secants[index - 1] * secants[index] <= 0) {
          tangents[index] = 0;
        } else {
          tangents[index] = (secants[index - 1] + secants[index]) / 2;
        }
      }

      // Fritsch–Carlson limiter: keep each segment monotone.
      for (let index = 0; index < count - 1; index += 1) {
        if (secants[index] === 0) {
          tangents[index] = 0;
          tangents[index + 1] = 0;
          continue;
        }
        const first = tangents[index] / secants[index];
        const second = tangents[index + 1] / secants[index];
        const length = Math.hypot(first, second);
        if (length > 3) {
          const scale = 3 / length;
          tangents[index] = scale * first * secants[index];
          tangents[index + 1] = scale * second * secants[index];
        }
      }

      let path = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
      for (let index = 0; index < count - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        const dx = (to.x - from.x) / 3;
        const c1y = from.y + tangents[index] * dx;
        const c2y = to.y - tangents[index + 1] * dx;
        path += ` C${(from.x + dx).toFixed(2)} ${c1y.toFixed(2)} ${(to.x - dx).toFixed(2)} ${c2y.toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
      }
      return path;
    }

    /** One line per model over the current range. */
    function TrendLines(props) {
      const t = props.t;
      const localeId = props.localeId;
      const days = props.days || [];
      const order = props.order || [];
      const colorFor = props.colorFor;
      const nameOf = typeof props.nameOf === 'function' ? props.nameOf : (model) => model;
      const [hover, setHover] = React.useState(null);
      const [tip, setTip] = React.useState(null);

      const series = order.map((model) => ({
        model,
        color: colorFor(model),
        values: days.map((day) => (day.models && typeof day.models[model] === 'number' ? day.models[model] : 0)),
      }));

      let max = 0;
      for (const item of series) for (const value of item.values) if (value > max) max = value;

      const count = days.length;
      const plotW = LINE_W - LINE_PAD.left - LINE_PAD.right;
      const plotH = LINE_H - LINE_PAD.top - LINE_PAD.bottom;
      const step = count <= 1 ? plotW : plotW / (count - 1);
      const xAt = (index) => LINE_PAD.left + (count <= 1 ? plotW / 2 : index * step);
      const yAt = (value) => LINE_PAD.top + plotH - (max > 0 ? (value / max) * plotH : 0);

      const ticks = [0, 0.5, 1];
      const labelStep = Math.max(1, Math.ceil(count / 6));
      const showDots = count <= 14;

      const onMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect || !rect.width) return;
        const x = ((event.clientX - rect.left) / rect.width) * LINE_W;
        const index = Math.max(0, Math.min(count - 1, Math.round((x - LINE_PAD.left) / (step || 1))));
        setHover(index);
        setTip(trendTip(t, localeId, days[index], colorFor, event.clientX, rect.top + 12, nameOf));
      };

      const onLeave = () => {
        setHover(null);
        setTip(null);
      };

      const grid = ticks.map((fraction) => {
        const y = LINE_PAD.top + plotH * (1 - fraction);
        return h('g', { key: `tick-${fraction}` },
          h('line', {
            className: fraction === 0 ? 'us-line-base' : 'us-line-grid',
            x1: LINE_PAD.left,
            x2: LINE_W - LINE_PAD.right,
            y1: y,
            y2: y,
          }),
          h('text', { x: LINE_PAD.left - 6, y: y + 3, textAnchor: 'end' }, tokenText(localeId, max * fraction)));
      });

      const guide = hover === null || days[hover] === undefined
        ? null
        : h('line', {
          className: 'us-line-guide',
          x1: xAt(hover),
          x2: xAt(hover),
          y1: LINE_PAD.top,
          y2: LINE_PAD.top + plotH,
        });

      const lines = series.map((item) => h('path', {
        key: `line-${item.model}`,
        d: monotonePath(item.values.map((value, index) => ({ x: xAt(index), y: yAt(value) }))),
        fill: 'none',
        stroke: item.color,
        strokeWidth: 1.6,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }));

      const dots = showDots
        ? series.map((item) => item.values.map((value, index) => (value > 0
          ? h('circle', { key: `dot-${item.model}-${index}`, cx: xAt(index), cy: yAt(value), r: 2, fill: item.color })
          : null)))
        : null;

      const activeDots = hover === null
        ? null
        : series.map((item) => (item.values[hover] > 0
          ? h('circle', {
            key: `active-${item.model}`,
            cx: xAt(hover),
            cy: yAt(item.values[hover]),
            r: 4,
            fill: item.color,
            stroke: 'var(--us-surface)',
            strokeWidth: 1.5,
          })
          : null));

      const xLabels = days.map((day, index) => {
        if (index % labelStep !== 0 && index !== count - 1) return null;
        return h('text', {
          key: `x-${day.day}`,
          x: xAt(index),
          y: LINE_H - 5,
          textAnchor: 'middle',
        }, formatDay(day.day, localeId, { month: 'numeric', day: 'numeric' }));
      });

      return h('div', { className: 'us-trend-body' },
        h('svg', {
          className: 'us-line',
          viewBox: `0 0 ${LINE_W} ${LINE_H}`,
          role: 'img',
          'aria-label': t('trend.title'),
          onMouseMove: onMove,
          onMouseLeave: onLeave,
        }, grid, guide, lines, dots, activeDots, xLabels),
        h(FloatingTip, { tip }));
    }

    /** Daily trend panel: stacked bars, or one line per model. */
    function TrendChart(props) {
      const t = props.t;
      const localeId = props.localeId;
      const data = props.data;
      const daily = (data && data.daily) || [];
      // The live selection wins over the echoed payload: the chart must follow the
      // click immediately, and the default mode must match the range being shown.
      const range = typeof props.range === 'number'
        ? props.range
        : (data && data.selection ? data.selection.range : 30);
      const [override, setOverride] = React.useState(null);
      // Default per range: a week reads as bars, a month reads as lines.
      const mode = override && override.range === range ? override.type : (range === 7 ? 'bar' : 'line');
      const [tip, setTip] = React.useState(null);

      // Series come from the selected range, not the lifetime ranking: a model
      // that only became busy inside the window still needs a line, a legend
      // entry and its own colour.
      const rangeModels = rangeModelRanking(daily);
      const visible = rangeModels.slice(0, MODEL_COLORS.length - 1);
      const order = rangeModels.length > visible.length ? [...visible, OTHER_MODEL] : visible;
      const nameOf = (model) => (model === OTHER_MODEL ? t('model.other') : model);
      const colorFor = (model) => colorOf(Math.max(0, order.indexOf(model)));
      const groupDay = (day) => {
        const grouped = Object.create(null);
        for (const [model, tokens] of Object.entries(day.models || {})) {
          const key = order.includes(model) ? model : OTHER_MODEL;
          grouped[key] = (grouped[key] || 0) + tokens;
        }
        return { ...day, models: grouped };
      };
      const groupedDays = daily.map(groupDay);

      let max = 0;
      for (const day of daily) if (day.tokens > max) max = day.tokens;
      const hasData = max > 0;
      const dense = daily.length > 10;
      const step = daily.length > 14 ? 5 : 1;

      const showBarTip = (event, day) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTip(trendTip(t, localeId, day, colorFor, rect.left + rect.width / 2, rect.top, nameOf));
      };

      const toggle = h('div', { className: 'us-chart-toggle', role: 'group', 'aria-label': t('trend.mode') },
        ['bar', 'line'].map((type) => h('button', {
          key: type,
          type: 'button',
          'aria-pressed': mode === type ? 'true' : 'false',
          onClick: () => setOverride({ range, type }),
        }, t(`trend.${type}`))));

      const header = h('div', { className: 'us-panel-head' },
        h('div', { className: 'us-panel-title' }, t('trend.title')),
        h('div', { className: 'us-panel-head-side' },
          h('span', { className: 'us-panel-note' }, t(mode === 'bar' ? 'trend.noteBar' : 'trend.noteLine')),
          toggle));

      const barBody = h('div', { className: 'us-trend-body' },
        h('div', { className: 'us-chart-frame' },
          h('div', { className: 'us-grid-lines' }, [0, 1, 2, 3].map((index) => h('i', { key: `grid-${index}` }))),
          h('div', { className: 'us-chart', 'data-dense': dense ? 'true' : undefined },
            groupedDays.map((day, index) => h('div', { className: 'us-bar-column', key: day.day },
              h('div', { className: 'us-bar-wrap' },
                h('div', {
                  className: 'us-bar-hit',
                  role: 'img',
                  'aria-label': fill(t('trend.day'), {
                    date: formatDay(day.day, localeId, { month: 'short', day: 'numeric' }),
                    tokens: countText(day.tokens),
                  }),
                  onMouseEnter: (event) => showBarTip(event, day),
                  onMouseLeave: () => setTip(null),
                },
                Object.keys(day.models || {})
                  .filter((model) => (day.models[model] || 0) > 0)
                  .sort((left, right) => (day.models[right] || 0) - (day.models[left] || 0))
                  .map((model) => h('span', {
                    key: model,
                    className: 'us-bar-segment',
                    style: {
                      height: max > 0 ? `${((day.models[model] || 0) / max) * 100}%` : '0%',
                      background: colorFor(model),
                    },
                  })))),
              index % step === 0 || index === daily.length - 1
                ? h('div', { className: 'us-date-label' }, formatDay(day.day, localeId, { month: 'numeric', day: 'numeric' }))
                : h('div', { className: 'us-date-label' }, '')))),
          h(FloatingTip, { tip })));

      const lineBody = h(TrendLines, { t, localeId, days: groupedDays, order, colorFor, nameOf });

      return h('div', { className: 'us-panel' },
        header,
        hasData
          ? (mode === 'bar' ? barBody : lineBody)
          : h('div', { className: 'us-state', style: { minHeight: '180px' } }, t('trend.empty')),
        hasData
          ? h('div', { className: 'us-legend' },
            order.map((model) => h('span', { key: model },
              h('span', { className: 'us-dot', style: { background: colorFor(model) } }),
              nameOf(model))))
          : null);
    }

    /** Model share donut with the per-model rows beside it. */
    function ModelPanel(props) {
      const t = props.t;
      const localeId = props.localeId;
      const models = props.models || [];
      const total = props.total || 0;

      if (models.length === 0) {
        return h('div', { className: 'us-panel' },
          h('div', { className: 'us-panel-head' }, h('div', { className: 'us-panel-title' }, t('model.title'))),
          h('div', { className: 'us-state', style: { minHeight: '160px' } }, t('model.empty')));
      }

      // One list for both halves: the donut and the rows beside it must agree on
      // which models exist and which colour each one owns.
      const shown = models.slice(0, 3);
      const restTokens = models.slice(3).reduce((sum, entry) => sum + entry.tokens, 0);
      const restRequests = models.slice(3).reduce((sum, entry) => sum + (entry.requests || 0), 0);
      const slices = shown.map((entry, index) => ({
        ...entry,
        // `unknown` is the Host's placeholder for a missing `source.model`; show it
        // the same way the summary card does instead of a raw literal.
        label: entry.model === 'unknown' ? t('model.other') : entry.model,
        color: colorOf(index),
      }));
      if (restTokens > 0) {
        slices.push({
          model: OTHER_MODEL,
          label: t('model.other'),
          tokens: restTokens,
          requests: restRequests,
          share: total > 0 ? restTokens / total : 0,
          color: colorOf(3),
        });
      }

      let cursor = 0;
      const stops = slices.map((slice) => {
        const from = cursor;
        cursor += slice.share * 100;
        return `${slice.color} ${from.toFixed(2)}% ${Math.min(100, cursor).toFixed(2)}%`;
      });
      const gradient = stops.length === 0 ? 'transparent' : `conic-gradient(${stops.join(', ')})`;

      return h('div', { className: 'us-panel' },
        h('div', { className: 'us-panel-head' },
          h('div', { className: 'us-panel-title' }, t('model.title')),
          h('div', { className: 'us-panel-note' }, t('model.note'))),
        h('div', { className: 'us-model-layout' },
          h('div', { className: 'us-donut', style: { background: gradient }, role: 'img', 'aria-label': t('model.title') },
            h('div', { className: 'us-donut-center' },
              tokenText(localeId, total),
              h('small', null, t('model.tokens')))),
          h('div', null,
            slices.map((slice) => h('div', { className: 'us-model-row', key: slice.model },
              h('div', null,
                h('div', { className: 'us-model-name', title: slice.model === OTHER_MODEL ? t('model.other') : slice.model },
                  h('span', { className: 'us-dot', style: { background: slice.color } }),
                  slice.label),
                h('div', { className: 'us-model-meta' }, fill(t('model.meta'), {
                  tokens: countText(slice.tokens),
                  requests: countText(slice.requests || 0),
                }))),
              h('div', { className: 'us-model-percent' }, percentText(slice.share)))))));
    }

    /** Input / output / cache read / cache write. */
    function CompositionPanel(props) {
      const t = props.t;
      const localeId = props.localeId;
      const composition = props.composition || {};
      const items = [
        ['composition.input', composition.input],
        ['composition.output', composition.output],
        ['composition.cacheRead', composition.cacheRead],
        ['composition.cacheWrite', composition.cacheWrite],
      ];
      return h('div', { className: 'us-panel' },
        h('div', { className: 'us-panel-head' },
          h('div', { className: 'us-panel-title' }, t('composition.title')),
          h('div', { className: 'us-panel-note' }, t('composition.scopeOnly'))),
        h('div', { className: 'us-breakdown' },
          items.map(([key, value]) => h('div', { className: 'us-break-item', key },
            h('span', null, t(key)),
            h('strong', { title: `${countText(value)} tokens` }, tokenText(localeId, value))))));
    }

    // ---------------------------------------------------------------------
    // Call details
    // ---------------------------------------------------------------------

    /** Fallback for the window size; the Host reports the real one as `callsLimit`. */
    const CALLS_LIMIT = 100;
    const CALLS_PAGE_SIZE = 20;

    /** Step duration, e.g. `<1s`, `1.4s`, `2m05s`. */
    function formatDuration(ms, t) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
      if (ms < 1000) return t('calls.subSecond');
      const seconds = ms / 1000;
      if (seconds < 60) return `${(Math.round(seconds * 10) / 10).toFixed(1).replace(/\.0$/, '')}s`;
      return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
    }

    /** Cache read share of everything the request paid input-side (one decimal). */
    function cacheRateText(call) {
      const denominator = (call.input || 0) + (call.cacheRead || 0) + (call.cacheWrite || 0);
      if (denominator <= 0) return '—';
      const percent = ((call.cacheRead || 0) / denominator) * 100;
      return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
    }

    /** Newest calls, 20 per page, display only. */
    function CallsPanel(props) {
      const t = props.t;
      const localeId = props.localeId;
      const [page, setPage] = React.useState(0);
      const list = Array.isArray(props.calls) ? props.calls : null;
      const limit = Number.isInteger(props.limit) && props.limit > 0 ? props.limit : CALLS_LIMIT;
      // A different window (new rows, a filter change) starts again at page 1
      // instead of keeping a page index that no longer exists. The oldest row is
      // part of the signature so a same-length window with a different tail also
      // resets.
      const signature = list === null
        ? 'pending'
        : `${list.length}:${list.length > 0 ? list[0].time : 0}:${list.length > 0 ? list[list.length - 1].time : 0}`;
      const previousSignature = React.useRef(signature);
      React.useEffect(() => {
        if (previousSignature.current === signature) return;
        previousSignature.current = signature;
        setPage(0);
      }, [signature]);
      const reportedCount = list === null ? 0 : list.filter((call) => call.actualModel).length;

      const header = h('div', { className: 'us-panel-head' },
        h('div', { className: 'us-panel-title' }, t('calls.title')),
        h('div', { className: 'us-panel-note' }, list === null
          ? ''
          : reportedCount > 0
            ? fill(t('calls.noteActual'), { limit, count: reportedCount })
            : fill(t('calls.note'), { limit })));

      if (list === null) {
        return h('div', { className: 'us-panel' }, header,
          h('div', { className: 'us-state', style: { minHeight: '120px' } }, t('calls.stale')));
      }
      if (list.length === 0) {
        return h('div', { className: 'us-panel' }, header,
          h('div', { className: 'us-state', style: { minHeight: '120px' } }, t('calls.empty')));
      }

      const pages = Math.max(1, Math.ceil(list.length / CALLS_PAGE_SIZE));
      const current = Math.min(Math.max(0, page), pages - 1);
      const offset = current * CALLS_PAGE_SIZE;
      const rows = list.slice(offset, offset + CALLS_PAGE_SIZE);

      const timeFormatter = React.useMemo(() => {
        try {
          return new Intl.DateTimeFormat(localeId || undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
        } catch {
          return null;
        }
      }, [localeId]);

      const timeOf = (call) => {
        const date = new Date(call.time);
        if (Number.isNaN(date.getTime())) return '—';
        return timeFormatter ? timeFormatter.format(date) : date.toLocaleString();
      };

      const columns = [
        { key: 'calls.time', align: '' },
        { key: 'calls.model', align: '' },
        { key: 'calls.input', align: 'us-num' },
        { key: 'calls.output', align: 'us-num' },
        { key: 'calls.cacheRate', align: 'us-num' },
        { key: 'calls.duration', align: 'us-num' },
        { key: 'calls.provider', align: '' },
      ];

      const modelCell = (call) => {
        const source = call.modelSource === 'upstream' ? t('calls.modelFromUpstream') : t('calls.modelFromRoute');
        if (!call.actualModel) {
          return h('td', { className: 'us-model', title: `${call.model}\n${source}` }, call.model);
        }
        return h('td', { className: 'us-model', title: `${call.model} → ${call.actualModel}\n${source}` },
          h('span', { className: 'us-model-alias' }, call.model),
          h('span', { className: 'us-arrow' }, ' → '),
          h('span', { className: 'us-model-actual' }, call.actualModel));
      };

      const bodyRows = rows.map((call, index) => h('tr', { key: `call-${offset + index}` },
        h('td', null, timeOf(call)),
        modelCell(call),
        h('td', { className: 'us-num' }, countText(call.input)),
        h('td', { className: 'us-num' }, countText(call.output)),
        h('td', { className: 'us-num' }, cacheRateText(call)),
        h('td', { className: 'us-num' }, formatDuration(call.durationMs, t)),
        h('td', { className: 'us-provider', title: call.provider || undefined }, call.provider || '—')));

      const pager = h('div', { className: 'us-calls-pager' },
        h('span', null, fill(t('calls.page'), { start: offset + 1, end: offset + rows.length, total: list.length })),
        h('button', {
          type: 'button',
          disabled: current === 0,
          onClick: () => setPage(Math.max(0, current - 1)),
        }, t('calls.prev')),
        h('button', {
          type: 'button',
          disabled: current >= pages - 1,
          onClick: () => setPage(Math.min(pages - 1, current + 1)),
        }, t('calls.next')));

      return h('div', { className: 'us-panel' },
        header,
        h('div', { className: 'us-calls-scroll' },
          h('table', { className: 'us-calls' },
            h('thead', null,
              h('tr', null, columns.map((column) => h('th', {
                key: column.key,
                scope: 'col',
                className: column.align || undefined,
              }, t(column.key))))),
            h('tbody', null, bodyRows))),
        pager);
    }

    // ---------------------------------------------------------------------
    // Page
    // ---------------------------------------------------------------------

    /** Renders a readable card instead of blanking the panel when a child throws. */
    class RenderBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-usage-stats] render failed', error);
        } catch {
          // logging must never be the second failure
        }
      }

      render() {
        if (!this.state.error) return this.props.children;
        const message = this.state.error && this.state.error.message
          ? this.state.error.message
          : String(this.state.error);
        const t = this.props.t;
        return h('div', {
          className: 'us-root',
          style: { padding: '24px', height: 'auto', fontFamily: 'var(--dsw-font-family, inherit)' },
        },
        h('style', { key: 'css' }, CSS),
        h('div', { className: 'us-error', style: { display: 'block' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, t ? t('state.renderFailed') : 'Usage page failed to render'),
          h('div', { style: { wordBreak: 'break-word', fontFamily: 'monospace' } }, message)));
      }
    }

    function UsagePage(props) {
      const t = props.t;
      const locale = props.locale;
      const onBack = props.onBack;
      const [revision, setRevision] = React.useState(0);
      const rootRef = React.useRef(null);
      // Every entry into the panel starts from the same view: last 7 days as
      // bars. The panel is remounted on each switch, so this is the whole state.
      const usage = useUsage({ range: 7, cwd: 'all', scope: 'all' });

      React.useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined;
        return locale.subscribe(() => setRevision((value) => value + 1));
      }, [locale]);

      // The shell owns the panel container's height. If it hands us a collapsed
      // box, claim a usable one instead of rendering an invisible page.
      React.useEffect(() => {
        const element = rootRef.current;
        if (!element || typeof element.getBoundingClientRect !== 'function') return;
        if (element.getBoundingClientRect().height < 120) {
          element.style.minHeight = '80vh';
          element.style.overflow = 'visible';
        }
      }, []);

      const localeId = React.useMemo(() => {
        try {
          return locale && locale.getSnapshot ? locale.getSnapshot().active : undefined;
        } catch {
          return undefined;
        }
      }, [locale, revision]);

      const data = usage.data;
      const stale = data !== null && data.version !== 2;
      const ready = data !== null && !stale;
      const summary = (ready && data.summary) || {};
      const filters = (ready && data.filters) || { cwds: [], scopes: { all: 0, root: 0, sub: 0 }, ranges: [7, 30] };
      const selection = usage.selection;
      const scanning = !!(ready && data.scanning);
      const progress = (ready && data.progress) || { done: 0, total: 0 };
      // "Nothing to show" only holds once the first scan has settled and the live
      // call window is empty too; otherwise a first visit would claim no data
      // while the fold is still running.
      const nothing = ready && !summary.totalTokens && !summary.messages
        && (!Array.isArray(data.calls) || data.calls.length === 0);
      const empty = ready && !scanning && nothing;
      const warming = ready && scanning && nothing;

      const setSelection = (patch) => usage.setSelection({ ...selection, ...patch });

      // Only work in progress is announced here. A "last updated" stamp would read
      // as "the numbers are old", while the aggregate is maintained live.
      const status = scanning
        ? (progress.total > 0
          ? fill(t('state.summarizing'), { done: progress.done, total: progress.total })
          : t('state.starting'))
        : '';

      const header = h('div', { className: 'us-top' },
        h('div', { className: 'us-heading' },
          h('div', { className: 'us-title' }, t('title')),
          h('div', { className: 'us-tab' }, t('tab.appUsage'))),
        h('button', { type: 'button', className: 'us-back', onClick: onBack },
          h('svg', {
            width: 16,
            height: 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          }, h('path', { d: 'm15 18-6-6 6-6' })),
          t('back')));

      // The Host owns the offered ranges; the client never assumes a set, and a
      // range without its own label falls back to a generic one.
      const ranges = Array.isArray(filters.ranges) && filters.ranges.length > 0 ? filters.ranges : [7, 30];
      const rangeLabelOf = (days) => {
        const key = `range.${days}`;
        const label = t(key);
        return label === key ? fill(t('range.days'), { days }) : label;
      };

      const rangeRow = h('div', { className: 'us-range-row' },
        h('div', { className: 'us-range-label' }, t('range.label')),
        h('div', { className: 'us-segment', role: 'group', 'aria-label': t('range.label') },
          ranges.map((days) => h('button', {
            key: days,
            type: 'button',
            'aria-pressed': selection.range === days ? 'true' : 'false',
            onClick: () => setSelection({ range: days }),
          }, rangeLabelOf(days)))));

      const workspaceSelect = h('select', {
        className: 'us-field',
        'aria-label': t('filter.workspace'),
        value: selection.cwd,
        onChange: (event) => setSelection({ cwd: event.target.value }),
      },
      h('option', { value: 'all' }, t('filter.workspace')),
      filters.cwds.map((entry) => h('option', { key: entry.cwd, value: entry.cwd }, workspaceLabel(entry.cwd))));

      const scopeSelect = h('select', {
        className: 'us-field',
        'aria-label': t('filter.task'),
        value: selection.scope,
        onChange: (event) => setSelection({ scope: event.target.value }),
      },
      h('option', { value: 'all' }, t('filter.task')),
      h('option', { value: 'root' }, t('filter.task.root')),
      h('option', { value: 'sub' }, t('filter.task.sub')));

      const downloadIcon = h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, h('path', { d: 'M12 3v12m0 0 4-4m-4 4-4-4M5 20h14' }));

      const csvButton = h('button', {
        type: 'button',
        className: 'us-export',
        onClick: () => download(`usage-stats-${selection.range}d.csv`, `\uFEFF${csvOf(data)}`, 'text/csv;charset=utf-8'),
      }, downloadIcon, t('export.csv'));

      const jsonButton = h('button', {
        type: 'button',
        className: 'us-export',
        onClick: () => download(`usage-stats-${selection.range}d.json`, `${JSON.stringify(data, null, 2)}\n`, 'application/json'),
      }, downloadIcon, t('export.json'));

      const refreshIcon = h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, h('path', { d: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5' }));

      const refreshButton = h('button', {
        type: 'button',
        className: 'us-export',
        disabled: scanning,
        onClick: usage.refresh,
      }, refreshIcon, t('refresh'));

      const toolbar = h('div', { className: 'us-toolbar' },
        workspaceSelect,
        scopeSelect,
        h('div', { className: 'us-spacer' }),
        h('span', { className: 'us-panel-note', 'aria-live': scanning ? 'off' : 'polite' }, status),
        refreshButton,
        csvButton,
        jsonButton);

      const errorNode = usage.error === null
        ? null
        : h('div', { className: 'us-error' },
          h('span', null, fill(t('state.error'), { message: usage.error })),
          h('button', { type: 'button', onClick: usage.refresh }, t('state.retry')));

      const staleNode = stale ? h('div', { className: 'us-state' }, t('state.stale')) : null;

      // A failed first request shows its error banner alone: a spinner next to it
      // would claim work that is not happening.
      const loadingNode = ready || stale || usage.error !== null
        ? null
        : h('div', { className: 'us-state' },
          h('div', null,
            h('div', { className: 'us-spinner' }),
            h('div', null, status || t('state.loading'))));

      // Built only once a payload exists: `data` is null during the first paint,
      // and nothing below may dereference it before `ready`.
      const panels = !ready
        ? null
        : empty
          ? h('div', { className: 'us-state' }, t('state.empty'))
          : warming
            ? h('div', { className: 'us-state' }, status || t('state.starting'))
            : h('div', null,
              h(SummaryCards, { t, localeId, summary }),
              h(Heatmap, { t, localeId, days: data.heatmap || [], weeks: data.heatmapWeeks }),
              h(TrendChart, { t, localeId, data, range: selection.range }),
              h(ModelPanel, {
                t,
                localeId,
                models: data.models || [],
                // The donut describes the selected range, so its centre is the
                // range total rather than the lifetime one shown on the cards.
                total: typeof data.rangeTokens === 'number' ? data.rangeTokens : (summary.totalTokens || 0),
              }),
              h(CompositionPanel, { t, localeId, composition: data.composition || {} }),
              h(CallsPanel, { t, localeId, calls: data.calls, limit: data.callsLimit }));

      const bodyNode = ready ? h('div', null, rangeRow, toolbar, panels) : null;

      return h('div', {
        className: 'us-root',
        ref: rootRef,
        'data-usage-stats': '',
        style: { fontFamily: 'var(--dsw-font-family, inherit)' },
      },
      h('style', { key: 'css' }, CSS),
      header,
      h('div', { className: 'us-scroll' },
        h('div', { className: 'us-content' },
          errorNode,
          staleNode,
          loadingNode,
          bodyNode)));
    }

    /** Sidebar entry icon; the sidebar owns the button. */
    function UsageIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18;
      const color = props && props.active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)';
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M4 19V10M10 19V5M16 19v-6M22 19H2' }));
    }

    // ---------------------------------------------------------------------
    // plugin
    // ---------------------------------------------------------------------

    return {
      name: NS,
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const locale = ctx.locale;

        ctx.effect(() => {
          const disposers = [];
          let ids = [];
          try {
            const snapshot = locale.getSnapshot ? locale.getSnapshot() : locale.getLocale();
            ids = (snapshot && snapshot.locales ? snapshot.locales : []).map((entry) => entry.id).filter(Boolean);
          } catch {
            ids = [];
          }
          for (const id of ids) {
            try {
              disposers.push(locale.register(NS, id, dictFor(id)));
            } catch {
              // Outside the built-in catalog: the page falls back to dictFor().
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch {
                // already gone
              }
            }
          };
        }, 'usage-stats: locale dictionaries');

        const bound = locale.bind(NS);
        const translate = (key, vars) => {
          let text;
          try {
            text = bound(key);
          } catch {
            text = key;
          }
          if (typeof text !== 'string' || text === key) {
            const fallback = dictFor(typeof document === 'undefined' ? 'en-US' : document.documentElement.lang);
            text = fallback[key] || key;
          }
          return fill(text, vars);
        };

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => translate('nav'),
        }, UsageIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, (ownerProps) => h(RenderBoundary, { t: translate }, h(UsagePage, {
          ...ownerProps,
          t: translate,
          locale,
          onBack: () => {
            try {
              ctx.layout.selectPanel('conversation');
            } catch {
              // The shell owns navigation; a refusal must not break the page.
            }
          },
        }))));
      },
    };
  },
});
