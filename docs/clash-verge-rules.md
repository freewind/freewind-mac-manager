# Clash 规则读写

这份文档说明 Clash Verge **全局 Merge 规则**的查看、编辑、保存，控制接口自动发现，
以及状态码、上限与已知限制。它管的是**全局 Merge（`uid: Merge`）这一个文件**，
不是订阅专属 merge，也不改 Clash Verge 的订阅与分组配置。

## 入口

| 入口 | 位置 |
| --- | --- |
| 页面 | 「Clash Verge」页（`FeatureKey = clash-verge`） |
| 面板 | 「全局 Merge」面板：查看 + 编辑 + 保存（[`MergeFilePanel`](../src/web/features/clash-verge/MergeFilePanel.tsx)） |
| 深链 | `?feature=clash-verge` |

## 能做与不能做

| 能做 | 不能做 |
| --- | --- |
| 读取全局 Merge 文件内容、大小与修改时间 | 修改订阅专属 merge（订阅内容由 Clash Verge 管理） |
| 整份保存全局 Merge（原子写、权限保留） | 触发 Clash Verge 重载内核配置（保存只落盘） |
| 读取状态、代理组、连接（控制接口可用时） | 执行任意 YAML 转换、校验业务语义（内容原样落盘） |
| 自动发现本机控制接口并读取运行状态 | 把控制接口地址发到本机回环之外 |

**保存只落盘**：保存成功的响应与面板提示都写明「需在 Clash Verge 中重载配置后生效」。
前端保存前会比对修改时间，外部有改动时要求显式覆盖，不静默覆盖。

## 配置项

| 环境变量 | 作用 |
| --- | --- |
| `CLASH_VERGE_PROFILE_DIR` | profiles 目录。默认 `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles` |
| `CLASH_VERGE_MERGE_FILE` | 全局 Merge 文件完整路径。默认 `<profiles>/Merge.yaml`。路径由服务端推导，客户端不传路径 |
| `CLASH_VERGE_CONTROLLER_UNIX_SOCKET` | 控制接口 unix socket。配置后最优先，不再自动发现 |
| `CLASH_VERGE_CONTROLLER_URL` | 控制接口回环 TCP 地址（`http://127.0.0.1:<端口>` 或 `http://[::1]:<端口>`）。非回环地址或带账号密码的 URL 直接拒绝 |
| `CLASH_VERGE_SECRET` | 可选。配置后才向控制接口发送 `Authorization: Bearer`。没有 secret 也能读（服务模式下 root 侧配置普通用户读不到是正常情形） |
| `CLASH_VERGE_AUTO_DISCOVER` | 填 `0` 关闭自动发现，只认显式配置 |

配置在项目根 `.env` 中维护，读取逻辑见 [`env.ts`](../src/server/env.ts)。

## 控制接口自动发现

实现见 [`discovery.ts`](../src/server/clash-verge/discovery.ts)，按顺序尝试，
命中一个通过 `/version` 身份校验（返回 `{version: string, meta: boolean}`）的目标即缓存：

1. **显式配置**：`CLASH_VERGE_CONTROLLER_UNIX_SOCKET` 优先，其次 `CLASH_VERGE_CONTROLLER_URL`。
   显式配置存在即权威，不再探测；配错时直接报错，绝不把请求（含 secret）发到外部主机。
2. **约定路径**：`/var/run/clash-verge-service/users/<uid>/verge-mihomo.sock`
   （服务模式，内核以 root 运行只开 socket，属主是当前用户）。
3. **用户态配置**：应用目录下 `config.yaml`、`clash-verge.yaml`、`verge.yaml` 里的
   `external-controller-unix` 与 `external-controller`（TCP 只在 `verge.enable_external_controller !== false` 时接受）。
4. **运行中进程参数**：`ps` 输出里 mihomo 进程行的 `-ext-ctl-unix` / `-ext-ctl`（只认回环地址）。

**两个红鲱鱼**不是控制接口，实现只取内核自己的 socket：

- `/var/run/clash-verge-service/service.sock`：Clash Verge 特权 helper 的 IPC；
- `singleton-instance.json`：Clash Verge App 的单实例通道（不是 socket，普通文件）。

探测行为：单候选超时 1.2 秒；命中缓存 30 秒；全部候选失败后退避 5 秒，
退避期内直接返回上次错误、不重跑发现。候选为 401/403 时说明目标确实是控制接口、
只是需要 secret，仍选中它，由上层给出认证提示。所有失败消息只记录候选地址，不含凭据。

## 端点与状态码

Merge 文件端点（[`routes/clash-verge.ts`](../src/shared/api-contract/routes/clash-verge.ts)）：

| 方法与路径 | 语义 |
| --- | --- |
| `GET /api/clash-verge/merge-file` | `200` + `{path, content, size, modified}`；`404` 找不到 Merge 文件（提示先在 Clash Verge 中生成）；`403` 符号链接、超出上限或不在配置目录 |
| `PUT /api/clash-verge/merge-file` | body `{content}`，整份替换；`200` + 提示消息（含重载说明）；`400` 内容超上限或 body 不合契约（请求校验失败返回序列化的 ZodError，逐条说明原因）；`403` 符号链接或越界 |

通用：`401` 未认证（`需要访问密码` / `密码错误` / 服务未配置密码）；
连续失败触发锁定返回 `429` + `Retry-After`；`500` 未预期异常（只回通用 message）。

状态与可用性（`GET /api/clash-verge/status` 等读端点）始终 `200`，
用 `availability.state` 表达控制接口情况，不把失败伪装成在线成功：

| 场景 | state | 说明 |
| --- | --- | --- |
| 控制接口正常应答 | `available` | 各分区数据完整 |
| 上游 401 或 403 | `unauthorized` | 控制接口认证失败（secret 缺失或不正确） |
| 上游 404 | `unavailable` | 该路径不存在，内核版本可能不支持 |
| 上游 429 | `unavailable` | 请求过于频繁 |
| 未发现接口或请求失败 | `unavailable` / `not_configured` | `not_configured` 表示没有可用目标且自动发现关闭 |

## 上限

- **保存内容**：最多 `256 × 1024` 字符（schema 与服务层双层拒绝，超限 `400` 且不落盘）。
- **读取文件**：先按字节预检（字符上限 × 4，UTF-8 最长 4 字节），再按字符复核；超限 `403` 拒绝读取。
- **请求与连接**：状态、代理组、连接等读端点由契约数组上限约束（如连接最多 200 条并标记 `truncated`）。

## 已知限制

- **竞态窗口**：读取后编辑再保存的窗口内，文件可能被 Clash Verge 或用户改动。
  前端保存前比对 `modified` 预检，服务端保存前再查一次符号链接；
  但预检与写入之间仍有窗口，服务端 PUT 不带版本校验，后写者整份覆盖。
- **无条件写**：保存即落盘，不校验 YAML 语义、不检查 Clash Verge 是否有未保存修改、
  不触发重载；无效内容由 Clash Verge 重载时自行拒绝。
- **只管全局 Merge**：订阅专属 merge 的读写不在本能力范围内。

## 自动验收证据

端到端验收（[`acceptance.test.ts`](../src/server/clash-verge/acceptance.test.ts)，12 条，
临时目录与本机回环替身，不读真实 Merge.yaml、不连真实控制接口）：

```bash
pnpm vitest run src/server/clash-verge/acceptance.test.ts
```

| 分组 | 用例 |
| --- | --- |
| Merge 读写 | 固定路径回显；文件不存在 `404` 说明原因；未登录与密码错误 `401`；原子写、权限保留、无临时文件、提示需重载；超限 `400` 且不落盘；符号链接读写均拒且目标不被改写；客户端写操作不自动重试、结果未知须重新读取 |
| 发现与可用性 | 显式配置优先不探测；约定路径只列内核 socket、两个红鲱鱼与普通文件不算候选；缓存 30 秒与失败退避 5 秒；401/403 → `unauthorized`，404/429 → `unavailable` 且带具体原因 |
| 越界 | Merge 路径在配置目录之外时读写均拒 `403`，外部文件不被写入 |

模块单测：[`merge-file.test.ts`](../src/server/clash-verge/merge-file.test.ts)、
[`discovery.test.ts`](../src/server/clash-verge/discovery.test.ts)、
[`transport.test.ts`](../src/server/clash-verge/transport.test.ts)、
[`controller.test.ts`](../src/server/clash-verge/controller.test.ts)、
[`service.test.ts`](../src/server/clash-verge/service.test.ts)、
[`handlers.test.ts`](../src/server/clash-verge/handlers.test.ts)，
前端面板见 [`MergeFilePanel.test.tsx`](../src/web/features/clash-verge/MergeFilePanel.test.tsx)。

### 全量验证记录（2026-10-13，任务 23）

| 项目 | 结果 |
| --- | --- |
| 验收单跑 | `pnpm vitest run src/server/clash-verge/acceptance.test.ts` → 12/12 |
| 全量表现 | 六轮 `pnpm test`（162 文件 / 1607 条）中 **12 条验收与 clash 服务端全部用例从未失败** |
| 全量波动 | 轮 3/4 的 `ClashVergePage.test.tsx` 失败来自 2 号执行者未提交的前端在途改动（瞬时态），与服务端和验收测试无关；该文件在途状态已自洽（单跑 10/10），等其提交后复跑 |
| `pnpm typecheck` / `lint` / `build` | 0 错误 / 0 error（9 条既有 `noDocumentCookie` 警告）/ EXIT=0 产物齐全 |
| 真实数据红线 | 测试不连真实控制接口：显式配置或注入候选、`AUTO_DISCOVER=0`、mock fetch；约定路径只对不存在的路径 `lstat`，不连接任何真实 socket |

完整六轮轮次表与归属见 [database.md 的全量验证记录](./database.md#全量验证记录2026-10-13任务-23)。

## 人工验收步骤（未执行）

以下需要真实 Clash Verge 环境，由人工验收任务统一执行，本任务不宣称完成：

1. 在 Clash Verge 中生成全局 Merge，打开「Clash Verge」页全局 Merge 面板，核对内容与文件一致。
2. 修改规则保存；在 Clash Verge 中重载配置，确认新规则生效。
3. 保存后不重载，确认内核仍在用旧规则（验证「只落盘」语义）。
4. 外部改动 Merge 文件后在面板保存，确认出现冲突提示、必须显式覆盖。
5. 服务模式下确认自动发现命中约定 socket；普通模式下确认回环 TCP 可用；
   改错 `CLASH_VERGE_CONTROLLER_URL` 确认报错而不是把请求发到外部。
6. 配置错误 secret 后确认状态显示 `unauthorized`，补回 secret 后恢复 `available`。
