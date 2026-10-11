# 访问密码认证

应用只监听本机回环地址，但外出时可能通过 HTTPS 反代访问，所以 API 需要访问密码。
本文说明机制、已知取舍与运维注意点。

## 机制

无状态认证：服务端不保存 session，每次请求直接核对 `MAC_MANAGER_PASSWORD`。
因此 dev 热重载不会清掉登录态，也不会因为进程重启让人被动登出。

| 环节 | 做法 |
| --- | --- |
| 密码来源 | 只从项目根 `.env` 的 `MAC_MANAGER_PASSWORD` 读取（[src/server/env.ts](../src/server/env.ts)） |
| Cookie 名 | `mac_manager_access_token`，前后端共用 [src/shared/auth.ts](../src/shared/auth.ts) |
| 普通请求 | 前端从 cookie 读出密码放进 `Authorization: Bearer`（[src/shared/client-api/access-password.ts](../src/shared/client-api/access-password.ts)） |
| 浏览器原生请求 | 下载、`<img>` 等无法自设 header，靠 cookie 自动携带；服务端先看 Bearer，再看 cookie |
| 禁止的凭据渠道 | `?token=` query 参数；URL 会进访问日志、浏览器历史与 Referer |
| 拦截范围 | 只拦 `/api`；页面与静态资源全部交给 SPA。`/api/auth/status`、`/api/auth/login` 免鉴权 |
| 未配置密码 | fail-closed：`/api` 一律 401，不会因为“本机”而放行 |
| 退出登录 | 前端清除 cookie 后整页刷新，没有服务端 logout 端点 |

## 已知取舍与风险

- **Cookie 非 HttpOnly**：前端必须读它才能填 `Authorization`，所以页面脚本可读密码。
  一旦出现 XSS，攻击者可直接读走密码。本机单人使用、无第三方脚本，接受这一取舍；
  若将来引入外部脚本或多人使用，需要重新评估。
- **Cookie 有效期上限**：勾选“记住密码”时写入 10 年，但 Chrome 104+ 会把上限截断到
  400 天，其它浏览器策略不同。到期后需要重新登录，不是故障。
- **升级后需重新登录一次**：旧版用进程内 session（`mac_manager_session`）与 CSRF
  cookie，本次已全部移除。升级后旧 cookie 不再被识别，浏览器里会残留一个无效 cookie，
  重新输入一次密码即可；也可以在浏览器里手动清掉 `mac_manager_csrf`。
- **弱网与结果未知**：登录失败与限流都返回明确文案；401 只表示凭据不对，
  不代表操作失败。写操作的结果未知仍按“重新读取核实”处理，不自动重试。
- **端口与域名不隔离 Cookie**：cookie 只按 host 存，所以 cookie 名带项目前缀，
  避免本机多个本地项目同时跑在 localhost 时互相覆盖。

## 限流

- 按 IP 计数，中间件与登录端点共用同一份计数（否则混合尝试可绕过锁定）。
- 连续失败 5 次锁定 60 秒，锁定期间返回 `429` 并带 `Retry-After` 头。
- 锁定期间继续失败不会重置计数、也不会延长锁；锁过期后自动可恢复。
- 登录成功清零计数。
- IP 取 TCP 对端地址（`req.socket.remoteAddress`，剥离 `::ffff:`），
  不信任可伪造的 `X-Forwarded-For`。走反代时所有请求会算作同一个 IP。

## 相关测试

- [src/server/auth.test.ts](../src/server/auth.test.ts)：Bearer 优先、cookie 回退、
  未配置 fail-closed、限流与 `Retry-After`、锁过期恢复、响应不写 `Set-Cookie`、
  两次 `createAuthManager()` 后凭据仍有效。
- [src/shared/client-api/access-password.test.ts](../src/shared/client-api/access-password.test.ts)：
  cookie 读写往返、特殊字符、remember 两个分支与清除。
- [src/web/features/auth/LoginPage.test.tsx](../src/web/features/auth/LoginPage.test.tsx)：
  默认勾选记住密码、成功后写入 cookie、错误提示。
