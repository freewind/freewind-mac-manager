# 通用数据库管理

这份文档说明「数据库」页与 database 域端点的用途、边界、上限、执行方式、自动验收证据，
以及还没有做的人工验收。它管的是**应用自身 SQLite 的真实内容**，不是给业务域写的管理接口。

## 入口

| 入口 | 位置 |
| --- | --- |
| 侧栏菜单 | 「数据库」（`FeatureKey = database`） |
| 深链 | `?feature=database&dbTable=<表名>` |
| 导航状态 | `dbTable` / `dbPage` / `dbPageSize` / `dbFilters` / `dbSorts`（JSON），其余参数原样保留 |

刷新、分享链接与浏览器前进后退都能恢复；切换表会清空旧筛选、排序与页码（页大小作为显示偏好保留）。
记录值与签名不写进 URL。

## 能做与不能做

| 能做 | 不能做 |
| --- | --- |
| 列出库里所有表与视图，读取结构与能力（字段、主键、唯一约束、外键、反向引用、触发器、生成列、默认值） | 整表清空、按条件批量修改（删除只按完整主键逐条定位） |
| 分页浏览记录、按列筛选与排序、查看单条记录详情 | 执行任意 SQL、DDL（建表、改表、建索引） |
| 新增、修改、删除记录（完整主键 + 记录签名定位） | 修改表结构或迁移数据 |
| 显示只读对象与禁用原因 | 维护业务不变量、其他域的签名或时间戳 |

表名与列名只来自 SQLite 自己的元信息（`pragma_table_list` / `table_xinfo` / `index_list` /
`index_xinfo` / `foreign_key_list` 与 `sqlite_schema`），没有表名白名单，也没有按表写死的代码：
**新增普通业务表只需要刷新表列表**，不需要新的管理代码。

## 端点与状态码

| 方法与路径 | 语义 |
| --- | --- |
| `GET /api/database/tables` | 表与视图列表（含四种操作的能力与禁用原因；不逐表 COUNT，`rowCount` 恒为 `null`） |
| `GET /api/database/tables/:table` | 单表结构：字段、约束、主键、触发器、反向引用、结构签名 |
| `GET /api/database/tables/:table/records?page&pageSize&filters[]&sorts[]` | 分页记录（含稳定排序、有界计数） |
| `GET /api/database/tables/:table/record?key[0][column]&key[0][value][type]&key[0][value][value]` | 单条记录（复合主键按数组给全） |
| `POST /api/database/tables/:table/records` | 新增，`201` + 创建后的记录（含签名） |
| `PATCH /api/database/tables/:table/records` | 修改（body 带完整主键与 `expectedSignature`），`200` + 修改后的记录 |
| `POST /api/database/tables/:table/records/delete` | 批量删除动作（单条就是一个元素），`200` + 已删除主键列表 |

| 码 | 含义 |
| --- | --- |
| `200` / `201` | 读取成功；写入已完成并返回结果 |
| `400` | 入参非法（页大小、筛选数量、未知列、生成列/主键/BLOB 被写入、值超限） |
| `401` | 缺少访问密码（全部 7 个端点都在认证之后挂载） |
| `403` | 该表不允许这个操作（视图、虚拟表、影子表、系统表、没有可靠主键的表） |
| `404` | 表或记录不存在 |
| `409` | 状态冲突：签名过期、唯一/非空/CHECK/外键/触发器约束、批量删除里有一条冲突 |
| `429` | 查询或写入排队已满（请求没有开始执行） |
| `500` | 未预期错误；写入超时返回 `executionStatus: "unknown"` |

## 只读规则与原因

| 对象 | 依据 | 结果 |
| --- | --- | --- |
| 视图（`type=view`） | 没有可直接写入的存储 | 只读，原因 `view` |
| 虚拟表（如 fts5） | 没有普通存储 | 只读，原因 `virtual_table` |
| 影子表（`type=shadow`） | 虚拟表的实现细节 | 只读，原因 `shadow_table` |
| SQLite 内部表（`sqlite_*`） | 不对外暴露写操作 | 只读，原因 `system_table` |
| 没有显式可靠非空唯一主键的普通表 | 无法安全定位单条记录 | 只读，原因 `no_primary_key` |
| 生成列（`hidden=2/3`） | 由数据库计算 | 列级不可写，原因 `generated` |
| 虚拟表隐藏列（`hidden=1`） | 不参与普通读写 | 列级不可写，原因 `hidden` |
| BLOB 列（亲和性 blob） | 首期只读 | 列级不可写，原因 `blob_read_only` |

主键是否「可靠」的判定：`WITHOUT ROWID` 表的主键隐含非空；单列 `INTEGER PRIMARY KEY`
且没有对应 pk 索引时是 rowid 别名，永远非空；其余情况要求每个主键列都显式 `NOT NULL`。
**不使用隐藏 rowid 冒充主键**——没有可靠主键的表只读。

## 值语义

| 情况 | 展示 | 提交 |
| --- | --- | --- |
| 省略字段（新增） | 表单显示「用默认值」 | 不出现在请求里，交给数据库 `DEFAULT` |
| 显式 NULL | `NULL` | `{ "type": "null" }` |
| 空字符串 | 「空字符串」 | `{ "type": "text", "value": "" }` |
| 文本 | 原样，长内容折叠可展开 | `{ "type": "text", "value": … }` |
| 整数 | 十进制字符串（**不转 Number**） | `{ "type": "integer", "value": "9007199254740993" }` |
| 实数 | 数值文本 | `{ "type": "real", "value": 1.5 }` |
| BLOB | `BLOB N 字节` | 只读，写入被拒 |
| 生成列 | 计算后的值 | 不可写 |
| JSON 文本 | 原文 + 「JSON」标注，**不改写原字符串** | 按原文提交 |

整数用十进制字符串是硬约束：`number` 存不下 int64，超过 2^53 会静默丢精度。
提交侧只做存储层判断，不按声明类型假装业务 schema：`TEXT` 列里的 `"7"` 不会被强制转成数字，
整数列里的 `"12a"` 按文本原样提交（SQLite 的亲和性转换本来就是这么做的）。

## 约束与并发

- 修改与删除都必须带**完整主键**与 `expectedSignature`（32 位十六进制，由整行可见列算出）。
  事务内先按主键读出整行再比对签名：记录已变化、已消失或表结构变化（可见列集合变了）都会
  返回 `409` / `404`，不会覆盖别人的修改。
- 删除是**全成功或全回滚**：批量里任何一条冲突或不存在都返回 `409` / `404`，一条都不会被删。
  200 响应的 `conflicts` / `failed` 因此恒为空，客户端也不会伪造部分成功。
- 约束冲突按语义分类：唯一、非空、CHECK、外键、触发器都是 `409`；错误文案只保留「表.列」
  这类结构信息，不回传被写入的原值与内部 SQL。
- 一次写入整体在 `BEGIN IMMEDIATE` 事务里完成；数据库繁忙（锁等待超时）返回 `409`。

## 结果未知怎么处理

超时、子进程异常退出、响应丢失时，写入**可能已经提交**，因此：

- 服务端返回 `500` 且 `executionStatus: "unknown"`，不返回「失败」。
- 客户端不自动重发（写 mutation `retry: false`、`networkMode: "always"`，不排队重放），
  界面把「结果未知」留在页内，并提供**只读的「重新读取核实」**入口。
- 核实只重新读取数据，不会因为看到相似值就宣称成功；新增尤其不会自动再次插入。
  是否继续由用户点「已核对，继续」显式决定。
- 离线时前端直接拒绝发送（`当前离线，操作未发送`），恢复联网也不会补发。

## 上限

| 项 | 值 | 超出的结果 |
| --- | --- | --- |
| 页大小 | ≤ 100（默认 50） | `400` |
| 页码 | ≤ 100000 | `400` |
| 筛选条件数 | ≤ 8 | `400` |
| 排序字段数 | ≤ 4 | `400` |
| 单值 | 文本 ≤ 64KiB；BLOB ≤ 64KiB（原始字节） | `400`（不截断原值） |
| 单次响应 | ≤ 2MiB | `400`，且**在提交前**判断（写入会回滚） |
| 一次删除 | ≤ 100 条，且不允许重复目标 | `400` |
| 有界计数 | 10000 行 / 1000ms | 超出时 `total: null`（显示「数量未知」，不冒充 0） |
| 查询子进程 | 5 秒上限，并发 2，队列 8 | 超时 → `500` unknown；排队满 → `429` |
| 写入子进程 | 5 秒上限，并发 1，队列 8 | 同上 |

只读查询有界重试（最多 2 次，且只重试网络错误与 5xx）；写入不重试。

## 执行方式

同步 sqlite 会阻塞事件循环，因此查询与写入都在**一次性子进程**里执行（与任务子进程同一套
模式，不引入 worker_threads）：

- 父进程通过 stdin 发一行受校验的查询/写入结构（没有 SQL 文本字段），子进程回一行 JSON。
- 子进程用只读连接（`readOnly` + `PRAGMA query_only`）查询、用可写连接写入；写入全程一个事务，
  进程结束即关闭连接，未提交事务由 SQLite 自动回滚。
- 父进程按超时终止子进程（SIGTERM → SIGKILL），并发与队列有上限，忙时直接 `429`。
- 每次写操作都重新读取真实元信息校验表、列、主键与能力，不缓存表结构。

## 自动验收证据

验收标准逐条对应到可观察的测试。命令：

```bash
pnpm test                                   # 全量
pnpm vitest run src/server/database/acceptance.test.ts   # 本次端到端验收
```

| # | 验收标准 | 证据（文件 › 用例名） | 断言结果 |
| --- | --- | --- | --- |
| 1 | 运行期间新增普通单主键表与非空复合主键表，刷新即可查询/新增/修改/删除 | `src/server/database/acceptance.test.ts` › 验收 1：启动后新建的表无需任何新代码就能查询、新增、修改、删除 | 应用启动后 `CREATE TABLE` 两张新表 → `GET /tables` 立即可见、结构能力四项全允许；单主键表增/查/改/删后 `count(*) = 0`；复合主键表两个键都给全才能读改删 |
| 2 | 默认值、NULL、空串、大整数、生成列、BLOB 语义正确且不丢精度 | `acceptance.test.ts` › 验收 2：显示与提交语义正确，大整数不丢精度；`mutations.test.ts` › insertRecord 的默认值/大整数用例；`values.test.ts` › 整数十进制字符串用例 | 省略列 → 默认值 `默认名`；`note` 为 `{type:"null"}`；空串为 `{type:"text",value:""}`；`9007199254740993` 原样往返；生成列读回 `3` 且写入被 `400` 拒绝；BLOB 读回 `QUJD`、写入 `400` |
| 3 | 系统表、虚拟表、影子表、视图、无可靠主键表拒写；恶意表列名与注入输入不能变成 SQL | `acceptance.test.ts` › 验收 3 的两条用例；`metadata.test.ts` › never pretends the hidden rowid is a primary key / marks views, virtual tables…；`query.test.ts` › treats injection text as a literal value | 5 类对象写入均为 `403`（虚拟表影子表按能力返回）；`no_pk` 的能力里带 `no_primary_key` 原因且表内 0 行；带空格/引号的表列名可正常写入；`inject_demo; DROP TABLE …` 表名 → `404`、恶意列名 → `400`、注入文本按字面值存回 |
| 4 | 过期签名 409 不覆盖；约束冲突被拒；批量删除一条失败整体回滚 | `acceptance.test.ts` › 验收 4 的三条用例；`mutations.test.ts` › rejects a stale signature… / rolls the whole batch back… | 另一个连接改过之后用旧签名 `PATCH` → `409` + `executionStatus: not_started`，库里仍是「别人改的」；唯一 → `409`（文案含「唯一约束」且不含原值）、CHECK → `409`、非空 → `409`；批量删除第 3 条冲突 → `409` 且 3 条都还在 |
| 5 | 离线或重复点击不产生多次写入；结果未知不自动重发、不误报成功 | `acceptance.test.ts` › 验收 5：写入超时按结果未知上报，且没有写入任何数据；`mutation-runner.test.ts` › reports a timeout as unknown and never retries；`DatabasePage.test.tsx` › 重复点击只发送一次 / 结果未知时不重发，只能重新读取核实且不宣称成功；`client-api/database.test.ts` › does not send an offline write | 写入超时 → `500` + `executionStatus: unknown`，表内 0 行；假 worker 的启动日志只 1 次（不重发）；组件层重复点击只调用 1 次；离线时客户端未发出请求；结果未知时按钮禁用、`toast.success` 未调用、核实只触发重新读取 |
| 6 | 认证保护全部库端点；子进程有超时与有界并发；超时与繁忙可区分 | `acceptance.test.ts` › 验收 6 的三条用例；`query-runner.test.ts` › runs 2 at a time, queues 8 and refuses the rest with 429 / kills a worker that exceeds the timeout…；`mutation-runner.test.ts` › 同名前两条 | 7 个端点无密码都是 `401` 且响应体不含表名；查询并发/队列为 0 时 `GET /tables` → `429`（无 `executionStatus`）；页大小 101 / 删除 101 条 / 9 个筛选都是 `400` |
| 7 | 页面入口、表切换、筛选分页、详情、新增、修改、删除与历史返回在组件测试中通过 | `DatabasePage.test.tsx`（23 条）、`RecordList.test.tsx`（12 条）、`RecordFormDialog.test.tsx`（13 条）、`DeleteRecordsDialog.test.tsx`（8 条）、`AppSidebar.test.tsx` › 功能分组里有数据库入口 | 入口可点、切表清空旧筛选、筛选与翻页写进 URL 并触发新查询、详情打开/关闭/返回键关浮层、新增 201 后关闭并重读、修改只提交变化字段、单条与批量删除提交完整主键与签名、取消不发请求 |
| 8 | `pnpm typecheck` / `lint` / `build` / `test` 通过且既有域未被破坏 | 命令输出（见下） | 见「检查结果」 |

### 检查结果（本次验收运行）

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 数据库域 17 个测试文件 / 230 条用例全部通过；全量 124 个文件通过、1 个失败（他人未提交的 `PiPage.test.tsx`） |
| `pnpm typecheck` | 我的文件 0 错误；全项目仅 `src/web/features/pi/PiPage.test.tsx` 有 2 个错误（他人未提交改动） |
| `pnpm lint` | 我的 40 个文件 0 问题；全项目 0 error、9 条既有 `noDocumentCookie` 警告 |
| `pnpm build` | 全部构建步骤通过：前端 + `main` / `task-worker` / `query-worker` / `mutation-worker` 四个 SSR 产物齐全（`pnpm build` 的 typecheck 环节当前被他人未提交的 `PiPage.test.tsx` 挡住，故按同样命令逐步执行） |
| `pnpm generate:openapi` | 已重新生成 `generated/openapi.yaml`；`generated/` 在 `.gitignore` 里，没有需要提交的生成物 |

## 人工验收步骤（未执行）

以下都需要真实浏览器与手机，本任务未启动浏览器，保持待验收：

1. 手机打开「数据库」页：确认 320px 下没有页面级横向溢出，宽表只有局部横向滚动。
2. 选表 → 展开表结构：确认只读表显示禁用原因，生成列/BLOB 列在表单里只读。
3. 筛选 + 排序 + 翻页：确认 URL 变化、刷新与系统返回能恢复；切表后旧条件被清空。
4. 新增一条记录（含 NULL、空串、大整数）→ 保存：确认列表重新读取后能看到，字段语义正确。
5. 修改一条记录并制造冲突（先在另一个连接改掉）→ 确认 409 文案留在表单里、草稿还在。
6. 勾选当前页若干条 → 删除：确认确认框写明表名、数量与级联/触发器影响，成功后列表不再显示。
7. 断网后提交：确认直接拒绝、不排队；恢复联网后不自动重发。
8. 制造超时（例如锁住数据库）后提交：确认提示「结果未知」，只提供核实入口，不自动重试。
9. PWA 安装后重复第 1-3 步，确认独立启动形态与返回行为正常。

## 已知边界

- **不做业务校验**：这里直接改底层表，不会维护其他域的签名、时间戳或业务不变量；外键级联与
  写触发器的影响只在确认框里提示（来自元信息里的 `referencedBy` 与 `triggers`），不代为处理。
- **CHECK 表达式不在元信息里**：`constraints.checks` 恒为空（解析 DDL 需要理解 SQL），冲突时靠
  服务端的 `409` 文案提示。
- **结构过期判定**：客户端用打开对话框时记录的 `tableDetail.signature` 比对；真正的并发保护
  仍是服务端的 `expectedSignature` + `409`。
- **入参校验失败的响应体**是 ts-rest 默认的 ZodError 结构（`{issues, name}`），不是契约声明的
  `{message}`；这是全项目既有行为，前端只会显示「请求失败（HTTP 400）」。
- **UI 一次只支持一个排序条件**（后端与契约支持最多 4 个）。
- **批量删除只针对当前页勾选的记录**，不会跨页累积。
- 浏览器与真机适配（320px、44px 触控、PWA 安装、弱网）尚未验收，见
  [手机与弱网验收矩阵](./mobile-verification.md)。
- 全项目 `pnpm typecheck` 与 `pnpm test` 目前仍有他人未提交改动造成的失败（`PiPage.test.tsx`
  及其类型错误），与本域无关；本域自己的 17 个测试文件与 40 个 lint 目标全部干净。
