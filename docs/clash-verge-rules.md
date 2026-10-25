# Clash Verge 控制接口与状态

这份文档说明 Clash Verge 页怎么自动发现本机控制接口、怎么表达状态与可用性，
以及访问边界与已知限制。

## 入口

| 入口 | 位置 |
| --- | --- |
| 页面 | 「Clash Verge」页（`FeatureKey = clash-verge`） |
| 深链 | `?feature=clash-verge` |

## 能做与不能做

| 能做 | 不能做 |
| --- | --- |
| 读取状态、代理组、连接（控制接口可用时） | 修改 Clash Verge 的订阅与分组配置 |
| 自动发现本机控制接口并读取运行状态 | 把控制接口地址发到本机回环之外 |

## 配置项

| 环境变量 | 作用 |
| --- | --- |
| `CLASH_VERGE_PROFILE_DIR` | profiles 目录。默认 `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles` |
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

## 人工验收步骤（未执行）

以下需要真实 Clash Verge 环境，由人工验收任务统一执行，本任务不宣称完成：

1. 服务模式下确认自动发现命中约定 socket；普通模式下确认回环 TCP 可用；
   改错 `CLASH_VERGE_CONTROLLER_URL` 确认报错而不是把请求发到外部。
2. 配置错误 secret 后确认状态显示 `unauthorized`，补回 secret 后恢复 `available`。
