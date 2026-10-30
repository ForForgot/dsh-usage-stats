// Structural check of the browser half: evaluates the real client module and
// renders each view component once with a minimal hook shim, so a runtime
// error or a missing text/geometry path is caught without a browser.
// This is a correctness smoke test, not a visual verification.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');
const marker = '    return {\n      name: NS,';
if (!source.includes(marker)) throw new Error('probe injection point not found');
const probed = source
  .replace(
    marker,
    '    globalThis.__PROBE__ = { UsagePage, UsageIcon, RenderBoundary, SummaryCards, Heatmap, TrendChart, TrendLines, trendTip, monotonePath, ModelPanel, CompositionPanel, CallsPanel, Card, tokenText, countText, percentText, workspaceLabel, csvOf, formatDuration, cacheRateText, dictFor, fill, CSS, IDLE_POLL_MS, SCAN_POLL_MS, tipPosition, weekdayLabelsOf };\n' + marker,
  )
  // Test-only: start from a ready payload so the data-dependent branch renders.
  .replace(
    '      const [data, setData] = React.useState(null);',
    '      const [data, setData] = React.useState(globalThis.__PROBE_DATA__ === undefined ? null : globalThis.__PROBE_DATA__);',
  );
const probePath = join(here, 'client.probe.mjs');
writeFileSync(probePath, probed, 'utf8');

let fiber = null;

function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return previous === next;
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

function createReact() {
  class Component {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }

    setState(patch) {
      this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) };
    }
  }
  return {
    Component,
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props);
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { type, props: merged };
    },
    useState(initial) {
      const slot = fiber.slots[fiber.index] ?? (fiber.slots[fiber.index] = { value: typeof initial === 'function' ? initial() : initial });
      fiber.index += 1;
      return [slot.value, () => {}];
    },
    useReducer(reducer, initial) {
      fiber.index += 1;
      return [initial, () => {}];
    },
    useRef(initial) {
      const slot = fiber.slots[fiber.index] ?? (fiber.slots[fiber.index] = { current: initial });
      fiber.index += 1;
      return slot;
    },
    useMemo(factory, deps) {
      const slot = fiber.slots[fiber.index];
      if (!slot || !sameDeps(slot.deps, deps)) fiber.slots[fiber.index] = { value: factory(), deps };
      fiber.index += 1;
      return fiber.slots[fiber.index - 1].value;
    },
    useCallback(callback, deps) {
      return createReact().useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const slot = fiber.slots[fiber.index];
      if (!slot || !sameDeps(slot.deps, deps)) {
        fiber.slots[fiber.index] = { deps };
        const cleanup = effect();
        if (typeof cleanup === 'function') cleanup();
      }
      fiber.index += 1;
    },
    useLayoutEffect(effect, deps) {
      createReact().useEffect(effect, deps);
    },
    useSyncExternalStore(getSnapshot) {
      return getSnapshot();
    },
  };
}

const React = createReact();

function renderTree(element, out = { text: [], tags: [], elements: [] }) {
  if (element === null || element === undefined || element === false || element === true) return out;
  if (Array.isArray(element)) {
    for (const child of element) renderTree(child, out);
    return out;
  }
  if (typeof element === 'string' || typeof element === 'number') {
    out.text.push(String(element));
    return out;
  }
  const type = element.type;
  const props = element.props || {};
  if (typeof type === 'function' && type.prototype && typeof type.prototype.render === 'function') {
    const instance = new type(props);
    const previousFiber = fiber;
    fiber = { index: 0, slots: [] };
    let produced;
    try {
      produced = instance.render();
    } finally {
      fiber = previousFiber;
    }
    renderTree(produced, out);
    return out;
  }
  if (typeof type === 'function') {
    const previous = fiber;
    fiber = { index: 0, slots: [] };
    let produced;
    try {
      produced = type(props);
    } finally {
      fiber = previous;
    }
    renderTree(produced, out);
    return out;
  }
  out.tags.push(type);
  out.elements.push({ type, props });
  if (props.children !== undefined) renderTree(props.children, out);
  return out;
}

function findButton(out, className) {
  return out.elements.find((entry) => entry.type === 'button' && entry.props.className === className);
}

// --- module load -----------------------------------------------------------

const locale = {
  getSnapshot: () => ({ active: 'zh-CN', locales: [{ id: 'zh-CN' }, { id: 'en-US' }], revision: 1 }),
  getLocale: () => ({ active: 'zh-CN', locales: [{ id: 'zh-CN' }, { id: 'en-US' }], revision: 1 }),
  subscribe: () => () => {},
  register: () => () => {},
  bind: () => (key) => (key === 'nav' ? '使用统计' : key),
};

let plugin = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      plugin = definition.factory((name) => {
        if (name === 'react') return React;
        throw new Error(`unexpected require(${name})`);
      });
    },
  },
};
const documentListeners = [];
const documentAdds = [];
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  visibilityState: 'visible',
  addEventListener: (name, handler) => {
    documentAdds.push(name);
    documentListeners.push([name, handler]);
  },
  removeEventListener: (name, handler) => {
    const index = documentListeners.findIndex((entry) => entry[0] === name && entry[1] === handler);
    if (index >= 0) documentListeners.splice(index, 1);
  },
};

await import(`file://${probePath}`);
const probe = globalThis.__PROBE__;
if (!probe || !plugin) throw new Error('module did not expose its parts');

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
};

// --- plugin shape ----------------------------------------------------------

check('plugin injects slots+locale+layout', JSON.stringify(plugin.inject) === JSON.stringify(['slots', 'locale', 'layout']), JSON.stringify(plugin.inject));

const registrations = [];
let selectedPanel = null;
const ctx = {
  locale,
  layout: { selectPanel: (id) => { selectedPanel = id; } },
  effect: (callback) => { callback(); return () => {}; },
  slots: {
    inject: (key, callback) => { callback(); return () => {}; },
    register: (options, component) => { registrations.push({ options, component }); return () => {}; },
  },
};
plugin.apply(ctx);

check('two slot registrations', registrations.length === 2, String(registrations.length));
const navEntry = registrations.find((entry) => entry.options.name === 'sidebar.panellist');
const panelEntry = registrations.find((entry) => entry.options.name === 'main');
check('sidebar entry registered', navEntry !== undefined);
check('sidebar entry id', navEntry && navEntry.options.id, 'usage-stats');
check('sidebar entry order', navEntry && navEntry.options.order, 20);
check('sidebar entry label', navEntry && navEntry.options.label(), '使用统计');
check('main panel registered', panelEntry !== undefined);
check('main panel key', panelEntry && panelEntry.options.key, 'usage-stats');

const icon = renderTree(navEntry.component({ size: 18, active: true }));
check('icon renders svg', icon.tags.includes('svg'));
check('icon has path', icon.elements.some((entry) => entry.type === 'path'));

// --- formatting ------------------------------------------------------------

check('zh 亿', probe.tokenText('zh-CN', 130000000) === '1.3亿', probe.tokenText('zh-CN', 130000000));
check('zh 万', probe.tokenText('zh-CN', 8200000) === '820万', probe.tokenText('zh-CN', 8200000));
check('zh plain', probe.tokenText('zh-CN', 640) === '640', probe.tokenText('zh-CN', 640));
check('en K', probe.tokenText('en-US', 123456) === '123.5K', probe.tokenText('en-US', 123456));
check('count grouped', probe.countText(1234) === '1,234', probe.countText(1234));
check('percent one decimal', probe.percentText(0.82) === '82%', probe.percentText(0.82));
check('workspace label', probe.workspaceLabel('E:\\work\\alpha') === 'work/alpha', probe.workspaceLabel('E:\\work\\alpha'));

// --- fixtures --------------------------------------------------------------

const t = (key, vars) => probe.fill(probe.dictFor('zh-CN')[key] || key, vars);
const enT = (key, vars) => probe.fill(probe.dictFor('en-US')[key] || key, vars);

function dayKey(offset) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const daily = [];
for (let offset = -29; offset <= 0; offset += 1) {
  daily.push({
    day: dayKey(offset),
    tokens: offset === 0 ? 4200 : offset % 3 === 0 ? 0 : 1200 + offset * -10,
    requests: offset === 0 ? 3 : 1,
    models: offset % 3 === 0 ? {} : { 'deepseek-v4': 1000, 'deepseek-v4-mini': 200 },
  });
}

const heatmap = [];
for (let offset = -370; offset <= 0; offset += 1) {
  heatmap.push({ day: dayKey(offset), tokens: offset % 4 === 0 ? 0 : 500 + (offset + 370), requests: 1, future: false });
}

const payload = {
  version: 2,
  scanning: false,
  progress: { done: 12, total: 12 },
  error: null,
  updatedAt: Date.parse('2026-10-20T10:20:00+08:00'),
  selection: { range: 30, cwd: 'all', scope: 'all' },
  summary: {
    totalTokens: 130000000,
    inputTokens: 8200000,
    outputTokens: 4600000,
    cacheReadTokens: 120000000,
    cacheWriteTokens: 0,
    sessions: 24,
    subSessions: 3,
    messages: 175,
    requests: 96,
    activeDays: 6,
    currentStreakDays: 3,
    longestStreakDays: 9,
    activeToday: true,
    topModel: { model: 'deepseek-v4-flash', tokens: 106600000, requests: 80, share: 0.82 },
  },
  composition: { input: 8200000, output: 4600000, cacheRead: 120000000, cacheWrite: 0 },
  // The donut describes the selected range, so its centre total is smaller than
  // the lifetime figure on the cards.
  rangeTokens: 24000000,
  rangeRequests: 42,
  models: [
    { model: 'deepseek-v4-flash', tokens: 106600000, requests: 80, share: 0.82 },
    { model: 'deepseek-v4-pro', tokens: 23400000, requests: 16, share: 0.18 },
  ],
  daily,
  heatmap,
  filters: { cwds: [{ cwd: 'E:\\work\\alpha', sessions: 20, tokens: 1 }, { cwd: 'E:\\work\\beta', sessions: 4, tokens: 1 }], scopes: { all: 24, root: 21, sub: 3 }, ranges: [7, 30] },
};

// --- cards -----------------------------------------------------------------

const cards = renderTree(React.createElement(probe.SummaryCards, { t, localeId: 'zh-CN', summary: payload.summary, filters: payload.filters }));
for (const label of ['Tokens 用量', '会话数量', '消息数量', '活跃天数', '当前连续天数', '最常用模型']) {
  check(`card ${label}`, cards.text.includes(label), cards.text.join('|').slice(0, 240));
}
check('card total 1.3亿', cards.text.includes('1.3亿'), cards.text.join('|'));
check('card input/output/cache detail', cards.text.some((line) => line.includes('输入 820万 · 输出 460万 · 缓存 1.2亿')), cards.text.join('|'));
check('card top model name', cards.text.includes('deepseek-v4-flash'));
check('card top model share', cards.text.some((line) => line.includes('82% 用量占比')), cards.text.join('|'));
check('card streak active', cards.text.includes('今日已计入'));

// --- heatmap ---------------------------------------------------------------

const heat = renderTree(React.createElement(probe.Heatmap, { t, localeId: 'zh-CN', days: payload.heatmap.slice(-371) }));
check('heatmap title', heat.text.includes('活跃热力图'));
check('heatmap cells', heat.elements.filter((entry) => entry.props.className && String(entry.props.className).includes('us-cell-tip')).length === 371);
check('heatmap month labels', heat.elements.filter((entry) => entry.type === 'span' && entry.props.style && entry.props.style.gridColumn).length >= 6);
check('heatmap not in tab order', heat.elements.filter((entry) => entry.props.tabIndex !== undefined).length === 0);
check('heatmap grid is one image', heat.elements.some((entry) => entry.props.role === 'img' && typeof entry.props['aria-label'] === 'string'));
const heatCell = heat.elements.find((entry) => entry.props.className && String(entry.props.className).includes('us-cell-tip') && typeof entry.props.onMouseEnter === 'function');
check('heatmap hover handler', heatCell !== undefined);
if (heatCell) {
  heatCell.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 12, height: 12 }) } });
  heatCell.props.onMouseLeave();
}

// The grid follows the Host's window length, not a client-side constant.
const shortHeat = renderTree(React.createElement(probe.Heatmap, { t, localeId: 'zh-CN', days: payload.heatmap.slice(-14), weeks: 2 }));
const shortGrid = shortHeat.elements.find((entry) => entry.props.className === 'us-heat');
check('heatmap grid follows payload weeks', shortGrid && shortGrid.props.style.gridTemplateColumns === 'repeat(2, minmax(0, 1fr))', JSON.stringify(shortGrid && shortGrid.props.style));

// Weekday labels follow the locale instead of hard-coded Chinese glyphs.
const enHeat = renderTree(React.createElement(probe.Heatmap, { t: enT, localeId: 'en-US', days: payload.heatmap.slice(-14), weeks: 2 }));
check('heatmap weekday labels are localized', enHeat.text.includes('Mon') && enHeat.text.includes('Fri'), enHeat.text.join('|').slice(0, 160));

// Tooltip geometry: the anchor is clamped so the -50%/-100% box stays on screen.
globalThis.window.innerWidth = 1280;
globalThis.window.innerHeight = 800;
const boxOf = (position, size) => ({
  left: parseFloat(position.left) - size.width / 2,
  right: parseFloat(position.left) + size.width / 2,
  top: parseFloat(position.top) - size.height,
  bottom: parseFloat(position.top),
});
const size = { width: 240, height: 140 };
const cornerTopLeft = boxOf(probe.tipPosition({ x: 10, y: 12 }, size), size);
check('tooltip fits at the top-left corner',
  cornerTopLeft.left >= 7.9 && cornerTopLeft.top >= 7.9,
  JSON.stringify(cornerTopLeft));
const cornerBottomRight = boxOf(probe.tipPosition({ x: 1270, y: 795 }, size), size);
check('tooltip fits at the bottom-right corner',
  cornerBottomRight.right <= 1272.1 && cornerBottomRight.bottom <= 792.1 && cornerBottomRight.top >= 0,
  JSON.stringify(cornerBottomRight));
const fallbackSize = { width: 220, height: 96 };
const cornerUnmeasured = boxOf(probe.tipPosition({ x: 4, y: 4 }, null), fallbackSize);
check('tooltip fits before it is measured', cornerUnmeasured.left >= 7.9 && cornerUnmeasured.top >= 7.9, JSON.stringify(cornerUnmeasured));

// --- trend ----------------------------------------------------------------

// 30-day payload: lines by default.
const trend = renderTree(React.createElement(probe.TrendChart, { t, localeId: 'zh-CN', data: payload }));
check('trend title', trend.text.includes('按天 Token 趋势'));
check('trend defaults to lines for 30d', trend.elements.some((entry) => entry.props.className === 'us-line')
  && trend.elements.filter((entry) => entry.props.className === 'us-bar-column').length === 0, trend.elements.map((entry) => entry.props.className).join(','));
check('trend draws one path per model', trend.elements.filter((entry) => entry.type === 'path' && entry.props.stroke && entry.props.stroke !== 'currentColor').length >= 2);
check('trend legend', trend.text.includes('deepseek-v4') && trend.text.includes('deepseek-v4-mini'), trend.text.join('|').slice(-200));

// Series follow the selected range, not the lifetime ranking: a model that only
// appears in `daily` still gets a legend entry and a line.
const rangeOnlyModel = 'range-only-model';
check('fixture keeps the range-only model out of lifetime models', payload.models.some((entry) => entry.model === rangeOnlyModel) === false);
const rangePayload = {
  ...payload,
  daily: payload.daily.map((day) => ({ ...day, models: { ...day.models, [rangeOnlyModel]: 5000 } })),
};
const rangeTrend = renderTree(React.createElement(probe.TrendChart, { t, localeId: 'zh-CN', data: rangePayload }));
check('trend series follow the range', rangeTrend.text.includes(rangeOnlyModel), rangeTrend.text.join('|').slice(-240));
check('trend legend switches with the mode', rangeTrend.text.includes('每个模型一条线'), rangeTrend.text.join('|').slice(0, 240));
const toggles = trend.elements.filter((entry) => entry.type === 'button' && typeof entry.props['aria-pressed'] === 'string');
check('trend toggle present', toggles.length === 2, String(toggles.length));
check('trend line pressed for 30d', toggles[1] && toggles[1].props['aria-pressed'] === 'true');
if (toggles[0]) toggles[0].props.onClick();
const lineSvg = trend.elements.find((entry) => entry.props.className === 'us-line' && typeof entry.props.onMouseMove === 'function');
check('trend line hover handler', lineSvg !== undefined);
if (lineSvg) {
  lineSvg.props.onMouseMove({ clientX: 400, currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 40, width: 800, height: 200 }) } });
  lineSvg.props.onMouseLeave();
}
check('trend smooth path', trend.elements.filter((entry) => entry.type === 'path' && String(entry.props.d).includes(' C')).length >= 2,
  trend.elements.filter((entry) => entry.type === 'path').map((entry) => String(entry.props.d).slice(0, 40)).join(' | '));
check('trend horizontal grid', trend.elements.filter((entry) => entry.type === 'line' && (entry.props.className === 'us-line-grid' || entry.props.className === 'us-line-base')).length === 3);
check('trend x axis labels', trend.elements.filter((entry) => entry.type === 'text' && typeof entry.props.x === 'number' && entry.props.y > 150).length >= 4,
  String(trend.elements.filter((entry) => entry.type === 'text').length));

// Monotone interpolation: flat at turning points, never outside the data range.
const flatPath = probe.monotonePath([{ x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 100 }]);
const flatNumbers = flatPath.match(/-?\d+(?:\.\d+)?/g).map(Number);
check('monotone path stays inside the data range', flatNumbers.every((value) => value >= -0.01 && value <= 100.01), flatPath);
check('monotone path is cubic per segment', flatPath.split('C').length === 4, flatPath);
check('monotone flat segment is straight',
  probe.monotonePath([{ x: 0, y: 50 }, { x: 10, y: 50 }]) === 'M0.00 50.00 C3.33 50.00 6.67 50.00 10.00 50.00',
  probe.monotonePath([{ x: 0, y: 50 }, { x: 10, y: 50 }]));

// 7-day payload: bars by default.
const weekPayload = { ...payload, selection: { ...payload.selection, range: 7 }, daily: daily.slice(-7) };
const weekTrend = renderTree(React.createElement(probe.TrendChart, { t, localeId: 'zh-CN', data: weekPayload }));
check('trend defaults to bars for 7d', weekTrend.elements.filter((entry) => entry.props.className === 'us-bar-column').length === 7
  && !weekTrend.elements.some((entry) => entry.props.className === 'us-line'), String(weekTrend.elements.length));
check('trend bars not in tab order', weekTrend.elements.filter((entry) => entry.props.tabIndex !== undefined).length === 0);
const weekToggles = weekTrend.elements.filter((entry) => entry.type === 'button' && typeof entry.props['aria-pressed'] === 'string');
check('trend bar pressed for 7d', weekToggles[0] && weekToggles[0].props['aria-pressed'] === 'true');
if (weekToggles[1]) weekToggles[1].props.onClick();
const barHit = weekTrend.elements.find((entry) => entry.props.className === 'us-bar-hit' && typeof entry.props.onMouseEnter === 'function');
check('trend bar hover handler', barHit !== undefined);
if (barHit) {
  barHit.props.onMouseEnter({ currentTarget: { getBoundingClientRect: () => ({ left: 30, top: 40, width: 8, height: 100 }) } });
  barHit.props.onMouseLeave();
}

const emptyTrend = renderTree(React.createElement(probe.TrendChart, { t, localeId: 'zh-CN', data: { daily: daily.map((day) => ({ ...day, tokens: 0, models: {} })), models: [] } }));
check('trend empty copy', emptyTrend.text.includes('所选区间暂无用量'));

// --- model donut -----------------------------------------------------------

const donut = renderTree(React.createElement(probe.ModelPanel, { t, localeId: 'zh-CN', models: payload.models, total: payload.summary.totalTokens }));
check('donut title', donut.text.includes('模型用量'));
check('donut gradient', donut.elements.some((entry) => entry.props.style && String(entry.props.style.background).includes('conic-gradient')));
check('donut rows', donut.elements.filter((entry) => entry.props.className === 'us-model-row').length === 2);

// Rows and donut must describe the same slices: with >3 models the fourth row
// is the "other models" bucket, never a colour the donut does not show.
const manyModels = [
  { model: 'a', tokens: 50, requests: 5, share: 0.5 },
  { model: 'b', tokens: 30, requests: 3, share: 0.3 },
  { model: 'c', tokens: 15, requests: 2, share: 0.15 },
  { model: 'd', tokens: 5, requests: 1, share: 0.05 },
];
const manyDonut = renderTree(React.createElement(probe.ModelPanel, { t, localeId: 'zh-CN', models: manyModels, total: 100 }));
const manyRows = manyDonut.elements.filter((entry) => entry.props.className === 'us-model-row');
check('donut rows match the slices', manyRows.length === 4, String(manyRows.length));

// `unknown` is the Host's missing-model placeholder; the rows must label it the
// same way the summary card does, not echo the literal.
const unknownDonut = renderTree(React.createElement(probe.ModelPanel, {
  t,
  localeId: 'zh-CN',
  models: [{ model: 'unknown', tokens: 10, requests: 1, share: 1 }],
  total: 10,
}));
check('unknown model labelled like the card',
  unknownDonut.text.includes('其他模型') && !unknownDonut.text.includes('unknown'),
  unknownDonut.text.join('|').slice(0, 160));
check('donut other bucket labelled', manyDonut.text.includes('其他模型'), manyDonut.text.join('|').slice(0, 240));
check('donut other bucket keeps requests', manyDonut.text.includes('5 tokens · 1 次调用') || manyDonut.text.includes('5 tokens · 1 次调用'), manyDonut.text.join('|').slice(0, 240));
check('donut percentages', donut.text.includes('82%') && donut.text.includes('18%'));
check('donut center total', donut.text.includes('1.3亿'));
const emptyDonut = renderTree(React.createElement(probe.ModelPanel, { t, localeId: 'zh-CN', models: [], total: 0 }));
check('donut empty copy', emptyDonut.text.includes('暂无模型数据'));

// --- composition -----------------------------------------------------------

const composition = renderTree(React.createElement(probe.CompositionPanel, { t, localeId: 'zh-CN', composition: payload.composition, updatedAt: payload.updatedAt }));
check('composition title', composition.text.includes('Token 构成'));
for (const label of ['输入', '输出', '缓存读取', '缓存写入']) {
  check(`composition ${label}`, composition.text.includes(label), composition.text.join('|'));
}
check('composition cache read value', composition.text.includes('1.2亿'), composition.text.join('|'));

// --- page ------------------------------------------------------------------

globalThis.__PROBE_DATA__ = payload;
const page = renderTree(panelEntry.component({ t, locale, onBack: () => selectedPanel = 'conversation' }));
check('page title', page.text.includes('使用统计'));
check('page tab', page.text.includes('应用用量'));
check('page back label', page.text.includes('返回对话'));
check('page range tabs', page.text.includes('最近 7 天') && page.text.includes('最近 30 天'));
check('page workspace select', page.text.includes('全部工作区') && page.text.includes('work/alpha'));
check('page task select', page.text.includes('全部任务') && page.text.includes('仅主任务') && page.text.includes('仅子任务'));
check('page export buttons', page.text.includes('CSV') && page.text.includes('JSON'));
check('page panels', page.text.includes('活跃热力图') && page.text.includes('按天 Token 趋势') && page.text.includes('模型用量') && page.text.includes('Token 构成'));
check('page calls panel', page.text.includes('调用明细'), page.text.join('|').slice(-260));
check('page style tag', page.tags.includes('style'));
check('page no stale notice', !page.text.includes('插件已更新'));
const backButton = findButton(page, 'us-back');
check('page back button', backButton !== undefined);
if (backButton) {
  backButton.props.onClick();
  check('back selects conversation', selectedPanel === 'conversation', String(selectedPanel));
}
const toolbarButtons = page.elements.filter((entry) => entry.type === 'button' && entry.props.className === 'us-export');
check('page toolbar buttons', toolbarButtons.length === 3, String(toolbarButtons.length));

// No "last updated" stamp anywhere: the aggregate is live, and a timestamp reads
// as "these numbers are old". Only in-progress work is announced.
check('page shows no updated-at stamp',
  !page.text.some((line) => /更新于|Updated \d/.test(line)),
  JSON.stringify(page.text.filter((line) => /更新|Updated/.test(line))));
const statusNote = page.elements.find((entry) => entry.props.className === 'us-panel-note' && entry.props['aria-live'] !== undefined);
check('page status line is empty when idle', statusNote !== undefined && statusNote.props.children === '',
  JSON.stringify(statusNote && statusNote.props.children));
const compositionNote = page.elements.filter((entry) => entry.props.className === 'us-panel-note').map((entry) => entry.props.children);
check('composition note states the scope only', compositionNote.includes('所选区间'), JSON.stringify(compositionNote));

// The donut's centre is the range total, not the lifetime one printed on the card.
const donutCentres = page.elements.filter((entry) => entry.props.className === 'us-donut-center');
check('page donut centre uses the range total',
  donutCentres.length === 1 && page.text.includes('2400万'),
  JSON.stringify(page.text.filter((line) => line.includes('万')).slice(0, 4)));
check('page refresh button', toolbarButtons.some((entry) => entry.props.children && String(entry.props.children[1] || entry.props.children) === '刷新'), JSON.stringify(toolbarButtons.map((entry) => entry.props.disabled)));
const rangeButtons = page.elements.filter((entry) => entry.type === 'button' && typeof entry.props['aria-pressed'] === 'string');
const rangeLabels = rangeButtons.map((entry) => entry.props.children);
check('page range buttons', rangeLabels.includes('最近 7 天') && rangeLabels.includes('最近 30 天'), JSON.stringify(rangeLabels));

// Every entry into the panel opens on last 7 days, drawn as bars — even when the
// echoed payload still says 30 days (the live selection wins).
const rangeOnly = rangeButtons.filter((entry) => String(entry.props.children).startsWith('最近'));
const pressed = rangeOnly.filter((entry) => entry.props['aria-pressed'] === 'true').map((entry) => entry.props.children);
check('page opens on the 7-day range', pressed.length === 1 && pressed[0] === '最近 7 天', JSON.stringify(pressed));
check('page opens on the bar chart',
  page.elements.some((entry) => entry.props.className === 'us-bar-column') && !page.elements.some((entry) => entry.props.className === 'us-line'),
  String(page.elements.filter((entry) => entry.props.className === 'us-bar-column').length));
const forcedWeek = renderTree(React.createElement(probe.TrendChart, { t, localeId: 'zh-CN', data: payload, range: 7 }));
check('range prop overrides the echoed payload', forcedWeek.elements.some((entry) => entry.props.className === 'us-bar-column'), String(forcedWeek.elements.length));

// A range the Host adds later still gets a readable label instead of a raw key.
const wideRanges = { ...payload, filters: { ...payload.filters, ranges: [7, 30, 90] } };
globalThis.__PROBE_DATA__ = wideRanges;
const widePage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
const wideLabels = widePage.elements.filter((entry) => entry.type === 'button' && typeof entry.props['aria-pressed'] === 'string').map((entry) => entry.props.children);
check('unknown range falls back to a generic label', wideLabels.includes('最近 90 天'), JSON.stringify(wideLabels));
globalThis.__PROBE_DATA__ = payload;
const rangeRow = page.elements.find((entry) => entry.type === 'select');
check('page select present', rangeRow !== undefined);
if (rangeRow) rangeRow.props.onChange({ target: { value: 'E:\\work\\beta' } });

// Refresh cadence: fast while a scan runs, a slow idle poll otherwise.
check('scan poll interval', probe.SCAN_POLL_MS === 900, String(probe.SCAN_POLL_MS));
check('idle poll interval', probe.IDLE_POLL_MS === 60000, String(probe.IDLE_POLL_MS));
check('visibility listener registered', documentAdds.includes('visibilitychange'), JSON.stringify(documentAdds));

// First paint: no payload yet must show the loading state, never throw.
globalThis.__PROBE_DATA__ = null;
const freshPage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
check('fresh page loading copy', freshPage.text.includes('正在读取本地会话历史…'), freshPage.text.join('|').slice(0, 160));
check('fresh page not crashed', !freshPage.text.some((line) => line.includes('渲染失败')), freshPage.text.join('|').slice(0, 160));

// Old host payload (before the restart) must show the notice, not crash.
globalThis.__PROBE_DATA__ = { version: 1, scanning: false, totals: { tokens: 1 }, daily: {} };
const stalePage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
check('stale payload notice', stalePage.text.some((line) => line.includes('插件已更新')), stalePage.text.join('|').slice(0, 200));

// Empty ledger.
globalThis.__PROBE_DATA__ = {
  ...payload,
  summary: { ...payload.summary, totalTokens: 0, messages: 0 },
  models: [],
  daily: [],
};
const blankPage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
check('blank page empty copy', blankPage.text.includes('还没有可展示的用量数据'), blankPage.text.join('|').slice(0, 200));

// First visit: the fold is still running, so the page must say so instead of
// claiming there is nothing to show (and must not hide a live call window).
globalThis.__PROBE_DATA__ = {
  ...payload,
  scanning: true,
  progress: { done: 0, total: 0 },
  summary: { ...payload.summary, totalTokens: 0, messages: 0 },
  models: [],
  daily: [],
  calls: [],
};
const warmingPage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
check('warming page says it is starting', warmingPage.text.includes('正在读取会话列表…'), warmingPage.text.join('|').slice(0, 200));
check('warming page is not empty', !warmingPage.text.includes('还没有可展示的用量数据'), warmingPage.text.join('|').slice(0, 200));
check('scanning status is not announced',
  warmingPage.elements.filter((entry) => entry.props['aria-live'] !== undefined).every((entry) => entry.props['aria-live'] === 'off'),
  JSON.stringify(warmingPage.elements.filter((entry) => entry.props['aria-live'] !== undefined).map((entry) => entry.props['aria-live'])));

// A live call window alone is enough to render the panels.
globalThis.__PROBE_DATA__ = {
  ...payload,
  scanning: false,
  summary: { ...payload.summary, totalTokens: 0, messages: 0 },
  models: [],
  daily: [],
  calls: [{ time: Date.parse('2026-10-20T09:00:00+08:00'), model: 'm', actualModel: '', modelSource: 'route', provider: 'p', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, durationMs: 10 }],
};
const callsOnlyPage = renderTree(panelEntry.component({ t, locale, onBack: () => {} }));
check('calls-only page shows the table', callsOnlyPage.text.includes('调用明细'), callsOnlyPage.text.join('|').slice(0, 200));
check('calls-only page is not empty', !callsOnlyPage.text.includes('还没有可展示的用量数据'), callsOnlyPage.text.join('|').slice(0, 200));

// --- call details ----------------------------------------------------------

const callRows = [];
for (let index = 0; index < 37; index += 1) {
  callRows.push({
    time: Date.parse('2026-10-20T09:00:00+08:00') - index * 60000,
    model: 'route-model-a',
    actualModel: index === 0 ? 'claude-sonnet-4-6' : '',
    modelSource: index === 0 ? 'upstream' : 'route',
    provider: 'gateway-alpha',
    input: 1000 + index,
    output: 100 + index,
    cacheRead: 9000,
    cacheWrite: 0,
    durationMs: index === 0 ? 500 : 1500 + index,
  });
}

check('duration sub-second', probe.formatDuration(500, t) === '<1 秒', probe.formatDuration(500, t));
check('duration seconds', probe.formatDuration(1500, t) === '1.5s', probe.formatDuration(1500, t));
check('duration minutes', probe.formatDuration(125000, t) === '2m05s', probe.formatDuration(125000, t));
check('duration missing', probe.formatDuration(null, t) === '—', probe.formatDuration(null, t));
check('cache rate', probe.cacheRateText({ input: 1000, cacheRead: 9000, cacheWrite: 0 }) === '90%', probe.cacheRateText({ input: 1000, cacheRead: 9000, cacheWrite: 0 }));
check('cache rate keeps a decimal', probe.cacheRateText({ input: 178, cacheRead: 50000, cacheWrite: 0 }) === '99.6%', probe.cacheRateText({ input: 178, cacheRead: 50000, cacheWrite: 0 }));
check('cache rate one hundred', probe.cacheRateText({ input: 0, cacheRead: 40, cacheWrite: 0 }) === '100%', probe.cacheRateText({ input: 0, cacheRead: 40, cacheWrite: 0 }));
check('cache rate empty', probe.cacheRateText({ input: 0, cacheRead: 0, cacheWrite: 0 }) === '—');

const callsPanel = renderTree(React.createElement(probe.CallsPanel, { t, localeId: 'zh-CN', calls: callRows }));
const tableRows = callsPanel.elements.filter((entry) => entry.type === 'tr');
const pagerButtons = callsPanel.elements.filter((entry) => entry.type === 'button');
check('calls: header row plus one page', tableRows.length === 21, String(tableRows.length));
check('calls: page one rows', tableRows.slice(1).length === 20, String(tableRows.slice(1).length));
check('calls: pager text', callsPanel.text.some((line) => line.includes('1–20 / 共 37 条')), callsPanel.text.join('|').slice(-200));
const headerLabels = callsPanel.elements.filter((entry) => entry.type === 'th').map((entry) => entry.props.children);
check('calls: column order', JSON.stringify(headerLabels) === JSON.stringify(['时间', '模型', '输入', '输出', '缓存率', '步骤耗时', '供应商']), JSON.stringify(headerLabels));
check('calls: header cells scoped', callsPanel.elements.filter((entry) => entry.type === 'th').every((entry) => entry.props.scope === 'col'), String(callsPanel.elements.filter((entry) => entry.type === 'th').length));
const modelCells = callsPanel.elements.filter((entry) => entry.props.className === 'us-model');
check('calls: model title names the source', modelCells.some((entry) => String(entry.props.title).includes('上游响应'))
  && modelCells.some((entry) => String(entry.props.title).includes('请求路由')), JSON.stringify(modelCells.slice(0, 3).map((entry) => entry.props.title)));
check('calls: provider shown', callsPanel.text.includes('gateway-alpha'), callsPanel.text.join('|').slice(0, 400));
check('calls: no effort column', !callsPanel.text.includes('思考程度'), callsPanel.text.join('|').slice(0, 300));
check('calls: upstream model shown', callsPanel.text.includes('claude-sonnet-4-6'), callsPanel.text.join('|').slice(0, 400));
check('calls: arrow between names', callsPanel.elements.some((entry) => entry.props.className === 'us-arrow' && entry.props.children === ' → '));
check('calls: note counts reported models', callsPanel.text.some((line) => line.includes('1 条上游自报了不同模型')), callsPanel.text.join('|').slice(-200));
check('calls: two pager buttons', pagerButtons.length === 2, String(pagerButtons.length));
check('calls: prev disabled on first page', pagerButtons[0] && pagerButtons[0].props.disabled === true);
check('calls: next enabled', pagerButtons[1] && pagerButtons[1].props.disabled === false);
check('calls: no filter controls', callsPanel.elements.filter((entry) => entry.type === 'select').length === 0);
for (const button of pagerButtons) {
  if (!button.props.disabled) button.props.onClick();
}

const emptyCalls = renderTree(React.createElement(probe.CallsPanel, { t, localeId: 'zh-CN', calls: [] }));
check('calls: empty copy', emptyCalls.text.includes('暂无调用记录'), emptyCalls.text.join('|').slice(0, 200));
const staleCalls = renderTree(React.createElement(probe.CallsPanel, { t, localeId: 'zh-CN', calls: undefined }));
check('calls: stale copy', staleCalls.text.some((line) => line.includes('需要重启')), staleCalls.text.join('|').slice(0, 200));

// --- error boundary --------------------------------------------------------

const boundaryError = new Error('boom: something threw');
const caught = new probe.RenderBoundary({ t, children: null });
caught.state = probe.RenderBoundary.getDerivedStateFromError(boundaryError);
const caughtOut = renderTree(caught.render());
check('boundary shows title', caughtOut.text.includes('使用统计渲染失败'), caughtOut.text.join('|').slice(0, 200));
check('boundary shows message', caughtOut.text.some((line) => line.includes('boom')), caughtOut.text.join('|'));
const healthy = new probe.RenderBoundary({ t });
check('boundary passes children through', renderTree(healthy.render()).text.length === 0);

// --- csv -------------------------------------------------------------------

const csv = probe.csvOf(payload);
const csvLines = csv.trim().split('\n');
check('csv header', csvLines[0] === 'day,tokens,requests,deepseek-v4-flash,deepseek-v4-pro', csvLines[0]);
check('csv row count', csvLines.length > 35, String(csvLines.length));
check('csv summary block', csv.includes('total_tokens,130000000'), csv.slice(-260));

// A model or path that starts with a formula character must stay text.
const hostile = {
  ...payload,
  models: [{ model: '=HYPERLINK("http://x")', tokens: 10, requests: 1, share: 1 }],
  daily: payload.daily.map((day) => ({ ...day, models: { '=HYPERLINK("http://x")': 10 } })),
};
const hostileCsv = probe.csvOf(hostile);
check('csv neutralizes formulas', hostileCsv.includes("'=HYPERLINK"), hostileCsv.split('\n')[0]);
check('csv still quotes the cell', hostileCsv.split('\n')[0].includes('"\'=HYPERLINK(""http://x"")"'), hostileCsv.split('\n')[0]);

// --- dictionary parity -----------------------------------------------------

const zhKeys = Object.keys(probe.dictFor('zh-CN'));
const enKeys = new Set(Object.keys(probe.dictFor('en-US')));
const missing = zhKeys.filter((key) => !enKeys.has(key));
check('en dictionary complete', missing.length === 0, missing.join(','));
for (const key of zhKeys) {
  const zhText = probe.dictFor('zh-CN')[key];
  const enText = probe.dictFor('en-US')[key];
  if (typeof zhText !== 'string' || typeof enText !== 'string' || zhText.length === 0 || enText.length === 0) {
    failures.push(`empty translation for ${key}`);
  }
  if (/\{[a-zA-Z]+\}/.test(zhText) !== /\{[a-zA-Z]+\}/.test(enText)) {
    failures.push(`placeholder mismatch for ${key}: zh=${zhText} en=${enText}`);
  }
}

if (failures.length > 0) {
  console.error('FAILED\n' + failures.join('\n'));
  process.exit(1);
}
console.log('client half OK:', JSON.stringify({
  registrations: registrations.map((entry) => entry.options.name),
  heatCells: heat.elements.filter((entry) => String(entry.props.className || '').includes('us-cell-tip')).length,
  bars: trend.elements.filter((entry) => entry.props.className === 'us-bar-segment').length,
  keys: zhKeys.length,
}));
