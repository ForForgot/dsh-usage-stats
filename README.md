# 使用统计 · dsh-usage-stats

DeepSeek Harness 桌面版（Web UI）的用量仪表盘插件：侧边栏多一个 **使用统计** 面板，
点开是一整页用量看板 —— 六张累计指标卡、近一年热力图、按天 Token 趋势（柱状 / 折线可切）、
模型占比环形图、Token 构成、调用明细（最近 100 次，20 条一页），
支持工作区/任务筛选、刷新与 CSV / JSON 导出。

界面与信息结构参考 [lanlandeli/dsh-usage-stats](https://github.com/lanlandeli/dsh-usage-stats)（MIT）；
数据层是按 dsh 0.2.1-rc.2 的现行接口重写的，不依赖它的旧运行时。

## 数据来源

- 聚合（累计 / 热力图 / 趋势 / 模型占比）来自会话日志：每条 `assistant/message` 事件携带
  provider 上报的 `usage`（input / output / cache-read / cache-write）与 `source.model`。
- **调用明细不是扫描出来的**：它来自宿主实时的 `session/event` 提交流，是一个容量 100 的
  滚动窗口（本文档下方说明）。
- token 数 = input + output + cache 读 + cache 写；reasoning 已含在 output 内，不重复计。
- 分叉会话通过 `inheritedEventCount` 跳过继承前缀，父子不重复计入。
- 全部在本机计算，配置与索引文件只写在本机 `$DSH_HOME`，不上传任何服务器。

## 结构

| 位置 | 作用 |
|---|---|
| `index.js`（宿主半） | 注册 `GET /usage-stats/summary`：增量聚合（live 事件累加 + 一次性补扫 + `folds.json` 持久化），实时调用窗口，导出与筛选选项 |
| `client.js`（浏览器半） | 在 `sidebar.panellist` 加导航图标、在 `main` 注册 `usage-stats` 整页面板并渲染看板 |
| `cordis.patch.yml` | 装配一行宿主入口；浏览器半由 `dsh.client` 声明被发现 |

接口位于 `ctx.connection.requestRejection` 之后才响应，与其它 `/api` 路由同一道
Host/Origin 与登录令牌围栏。

## 安装

发布到 npm 之后：

```powershell
dsh plugin --profile desktop add @forforgot/dsh-usage-stats -w
```

从本地目录（开发/未发布时）：

```powershell
dsh plugin --profile desktop add "<此目录>" -w
```

或在 Harness 内由插件管理器以本地目录安装为本 bundle。装完 **完全退出 Harness Desktop
再启动**（宿主半是进程内模块），浏览器 `Ctrl+F5` 刷新一次。

兼容性由 `package.json` 的 `peerDependencies` 声明（`>=0.2.0-0 <0.3.0-0`，包含 0.2.x 预发布版）；
运行时大版本不匹配时，插件管理器会在安装阶段拒绝，而不是装完才坏。
清单里的 `dsh.client.inject` 只列“必须先加载”的包（layout / sidebar）；浏览器半用到的
`slots` / `locale` / `layout` 服务由 client runtime 提供，插件在自身 `inject` 里声明并等待它们就绪。

已验证的运行时：**DSH 0.2.1-rc.2、0.2.1-rc.3**（Windows Desktop）。两次升级都实测过：Loader 行
`fiberPhase: active`、路由 401、`sidebar.panellist` 与 `main` 的 slot 注册 active、聚合卡片有数据、
实时调用明细能取到升级后产生的调用。

## 口径与细节

- **聚合是增量维护的，不是每次打开都重扫**：宿主订阅 `session/event`，每提交一条
  `assistant/message` 就把它累加进对应会话的折叠结果（`applyEventToCell`，与整段折叠
  `foldSession` 共用同一段逻辑，连"没有 usage 的消息也计入 messages"这种细节都共用）。因此：
  - 运行期间**没有任何定时全量扫描**（旧版本每 5 分钟一次，已移除）；
  - 打开面板读的是内存里的折叠结果，**不读日志**；单次请求成本是
    `O(会话数 + 活跃天数 × 模型数)`，不是常数（当前 11 个会话实测约 2 ms）；
  - **进程重启后第一次会完整校验一遍**（逐个 `readSession`），这是当前唯一的一次全量读取：
    重启后 `scanned` 是空的，且 `SessionRecord` 没有变更戳可判断"关闭期间是否变过"；
  - 运行期间新出现的会话只补扫它自己（多批并行读取，`BATCH_SIZE = 4`）；
  - 已折叠的结果镜像到 `$DSH_HOME/usage-stats/folds.json`（约 1 KB/会话，防抖 2 秒、
    卸载与退出时 flush），所以**重启后第一次打开立刻就有数字**，校验在后台完成后再校正。
  - 折叠期间到达的实时事件不会丢也不会重复：该会话整个"正在读 → 结果发布"窗口都标记为
    folding，事件先按会话缓冲（`tail`），在同步的提交阶段（`commitFold`）按 `event.seq`
    重放；比快照新的内存结果也不会被旧快照覆盖。批量读取时慢会话不会拖累快会话的事件。
- 工具栏的**刷新**按钮是真正的**全量重折**（`?refresh=1` 会忽略"已折过"的缓存逐个重读），
  可用来在怀疑数字不对时强制对账。
  会话列表还没拿到时显示 `正在读取会话列表…`，补扫时显示 `正在汇总 n/m 个会话…`；
  两者都不会误报「没有可展示的用量数据」——只要实时调用窗口里有记录，明细就照常显示。
- **范围选择器管的是图表区**：趋势图、模型用量（环形图 + 右侧模型行）、Token 构成都按所选
  区间（最近 7 / 30 天）现算；**6 张卡片保持历史累计**（"最常用模型"也按全历史排名），
  热力图固定是近一年。切换范围时环形图的中心总数与各模型占比一起变（`rangeTokens` 是区间总量，
  卡片上的 `summary.totalTokens` 是全历史总量，两者本来就不该相等）。
- 趋势图 7 天默认柱状、30 天默认折线，右上角可在两种图形间切换，切换只影响当前范围。
- **每次进入这个面板都从「最近 7 天 + 柱状图」开始**：范围与图形是面板内的临时状态，
  切走再回来不会记住上次选到 30 天／折线（面板切换时组件会重新挂载，0.2.1-rc.3 上实测）。
  面板重新挂载时也会重新取一次数据，但因为聚合是增量维护的，那一次请求只读内存。
- 「Tokens 用量」卡片的主数字是 `输入 + 输出 + 缓存读 + 缓存写`，副标题把三项都写出来，
  避免把总数误当成「输入+输出」而对不上（在走缓存的会话里，缓存读取通常是大头）。
- 环形图与右侧模型行用**同一份切片**：Top 3 + 「其他模型」，颜色一一对应，不会出现
  「右侧列出 6 个模型、环图只有 3 个扇区」的错位。
- 趋势图的模型序列取自**当前区间**（而非历史 Top N）：只在最近几天活跃的模型照样有线和图例；
  超出配色数量的模型会并成「其他模型」一个序列，避免多模型撞同一个颜色。
- 折线的形态参考 ZCode 与 kindred-7 的用法：**Fritsch–Carlson 单调三次插值**（等价于 Recharts
  `type="monotone"`，不会像 Catmull-Rom 那样过冲）、1.6px 线宽、只画水平虚线网格、
  Y 轴上限取**单模型单日峰值**（而非当天总量，否则多模型曲线会被压扁）、x 轴每约 6 天一个
  日期标签、悬停显示竖向参考线 + 该日各模型数值（≤14 天时另有小圆点）。
- 日期按宿主本地时区切分（与桌面客户端同一时钟）。
- 热力图窗口长度由宿主提供（payload 的 `heatmapWeeks`），客户端不再自己写死 53 列；
  左侧的星期缩写由 `Intl.DateTimeFormat` 按当前语言生成。
- **主任务 / 子任务**按 DSH 的语义划分：`origin === 'subagent'` 或有正的 `delegationDepth`
  才算子任务；**用户手动 fork 出来的会话仍算主任务**（它带 `parentSession`，但那是分叉标记，
  只用于跳过继承前缀去重，不参与这条分类）。
- 键盘可达性：热力图整体作为一个图片暴露给读屏（`role="img"` + 一句话摘要），
  371 个格子与柱状图的柱子都不进 Tab 序，避免按几百次 Tab 才能到翻页按钮；调用明细表格
  带 `scope="col"` 表头、翻页按钮有焦点描边；扫描进度不逐条朗读（`aria-live` 只在扫描结束后
  生效），悬停气泡会被夹在视口内，不会在角落格子上跑到屏幕外。**已知限制**：热力图与趋势图
  的单日数值只能用鼠标悬停查看，键盘与读屏用户拿到的是整图摘要而不是逐日数值。
- 导出 CSV 会加 UTF-8 BOM（Excel 打开中文路径不乱码），对以 `= + - @` 开头的单元格加 `'`
  前缀，避免模型名/路径被 Excel 当公式执行。
- 会话日志**读不出来**（损坏、迁移中、临时占用）时该会话保留上一次的统计值，不会把已计入的
  用量从总量里抹掉，并在 15 秒冷却后重试；而**会话被删除**（不再出现在 `listSessions` 里）时，
  它的折叠结果会在下一次补扫/刷新时一并移除——统计跟着对话走。
- **调用明细**是实时滚动窗口，不参与日志扫描：宿主订阅 `session/event`，每提交一条
  带 `usage` 的 `assistant/message` 就记一条，容量由宿主给出（payload 的 `callsLimit`，
  当前 100，超出即滚出最早一条）。
  - 窗口镜像到 `$DSH_HOME/usage-stats/recent-calls.json`（约 20 KB，原子写、1.5 s 防抖；
    插件卸载（禁用/升级）时再 flush 一次）。注意这是**全局文件**，多个 profile 共用；
    进程被强杀时最多丢失最后 1.5 秒的记录。
  - 页面 20 条一页，列顺序为 时间 / 模型 / 输入 / 输出 / 缓存率 / **步骤耗时** / 供应商，
    不做筛选、排序或归组；耗时取 `step/start` → `assistant/message`，即**整个 step 的墙钟
    时间（含工具执行与重试）**，不是单次模型请求的延迟；模型列在两者不同时显示
    `请求的模型 → 上游自报的模型`。
  - **上游模型名是尽力而为**：取自 `assistant/message` 的
    `source.replayState.response.responseModel`，这是 llm-pi-ai 适配器保留的原始响应字段；
    取不到时整列只显示请求路由，每条记录同时带 `modelSource: 'upstream' | 'route'`，
    鼠标悬停模型列会显示来源。网关若把别名写回 `model`，这里同样只能看到别名。
  - **清空历史明细**：先完全退出 Harness，再删除该文件；在运行中删除没有用——内存里的窗口会在下一次落盘时把它连同新记录一起写回来。
- 插件版本与宿主接口不匹配时（例如刚更新还没重启），页面会提示「插件已更新，请重启」；
  只缺调用明细时，那一块会单独提示需要重启，其余照常显示。
- 扫描失败不会伪装成刷新：`updatedAt` 只在**成功**折叠或实时事件改变数字时前进，失败时保留上一次
  成功时间（首次就失败则为空），并显示错误横幅；冷却 15 秒后由页面轮询自动重试，也可以点「重试」立即再试。
  payload 里的 `lastScanMs` 是上一次成功折叠的耗时，用来判断语料规模带来的开销。
- **界面上不显示「更新于 xx:xx」**：聚合成是实时维护的，一个时间戳只会让人误以为数字是旧的。
  工具栏只在补扫进行时显示进度文案，其余时候留空；`updatedAt` 仍保留在 payload 里供排障用。
  想强制对账就用工具栏的**刷新**。
- `filters.scopes` 的计数与 `summary.sessions` 用同一条判定（有用量的会话），两者不会互相矛盾。

## 已知限制与后续计划

- **启动后仍有一次补扫**：`sessionQuery.listSessions()` 返回的 `SessionRecord` 只有
  `{ header, live, persisted, formatStatus }`，**没有 lastSeq / eventCount / mtime 之类的变更戳**，
  所以进程重启后无法用公开 API 判断"这个会话在关闭期间有没有长出新事件"，只能把没折过的会话
  各读一次。收益已经在的：**运行期间零定时扫描**；启动那一次会完整校验全部会话，
  **运行期间新出现的会话只补扫它自己**。
  - 想连这一次也省掉，需要按日志文件的 size+mtime 判断（依赖 `$DSH_HOME/sessions/**` 的私有布局，
    布局一变就退化成全量扫描），或改用 DSH 的投影缓存
    （`sessionProjectionCache.cachedSnapshot(record.header, ['usage'])`，需要注册 `usage` 投影，
    且必须在真实环境验证 fork 前缀不被重复计入）。
- 增量折叠成立的前提是"该会话至少被完整折过一次"：未折过的会话若先收到实时事件，只登记为
  `pending`，等下一次请求补扫，不会用部分事件算出偏低的数字。`pending` 只在本轮 `listSessions`
  确实覆盖到它时才清除，所以"扫描期间新建的会话"不会被丢掉。**残留情况**：某个 `pending` 连续
  5 次都不出现在会话列表里（例如日志被外部拷贝进来、从未产生事件）就会被放弃，这类会话需要
  点一次「刷新」或重启才能进入统计。
- 读日志的两处调用都有 **60 秒超时**：`listSessions` 超时按整轮失败处理（保留 `scanning` 释放、
  冷却后重试），单个 `readSession` 超时按"读不出来"处理（保留旧折叠、计入 `unreadable` 重试），
  所以 persistence 卡住不会让进度条永远转。
- 明细窗口与折叠镜像都是**全局文件**而非按 profile 隔离，多 profile 会共用。
- 支持规模：折叠结果约占 1 KB/会话；日常请求**不读日志**，但 `buildSnapshot` 每次仍会遍历
  全部折叠结果与活跃天/模型（`O(会话 + 天 × 模型)`，当前 11 个会话约 2 ms），`folds.json`
  也是整体重写（7 KB/11 会话；上千会话时约 1 MB/2 秒，需要的话可改成分片写）。

## 自检

七个套件都不依赖浏览器，也不需要安装任何依赖；在仓库根目录直接跑：

```powershell
npm test                        # 依次跑下面七个
node test\host.test.mjs         # 宿主半：折叠口径、分叉/子任务分类、筛选、路由
node test\calls.test.mjs        # 调用明细：窗口上限、最新在前、耗时、上游模型、scope 过滤、重启恢复
node test\scan.test.mjs         # 扫描生命周期：失败上报、不伪装成刷新、冷却重试、卸载清空
node test\range.test.mjs        # 区间口径：环形图与构成跟随 7/30 天，卡片保持累计
node test\incremental.test.mjs  # 增量折叠：实时事件不再重读日志，且结果与整段折叠逐字段相等
node test\consistency.test.mjs  # 合并一致性：无 usage 消息、读取中/批量快慢窗口的 live 事件、pending 保留、force 重读、空语料
node test\client.test.mjs       # 浏览器半：渲染冒烟、格式化、CSV、气泡几何、中英文案完整性
```

CI 配置在 `.github/workflows/test.yml`（Ubuntu + Windows × Node 22/24，只跑 `npm test`）。
`client.test.mjs` 会在 `test` 下生成 `client.probe.mjs`（源码副本加测试探针），可随时删除。

## License

MIT，见 `LICENSE`。界面布局、CSS 度量和中英文案取自 lanlandeli/dsh-usage-stats（MIT），
原项目的版权与许可声明保留在 `NOTICE` 中；Host / Client 的实现是针对 DSH 0.2.x 接口的重写。
