# 生产部署

这份文档说明生产服务怎么上线、改完代码为什么必须先构建，以及 2026-10-11 那次
「监听地址看似没生效」事故的真实原因。

## 生产服务怎么跑

生产服务是 launchd 用户级常驻服务 `com.freewind.mac-manager`，plist 在项目外
（`~/Library/LaunchAgents/com.freewind.mac-manager.plist`），它执行的命令是 `pnpm start`。

[package.json](../package.json) 的 `start` 只做一件事：

```
APP_PORT=51510 NODE_ENV=production node dist-ssr/server/main.js
```

它**不构建**，只运行已经躺在 `dist-ssr/` 里的产物。所以源码改了之后直接重启服务，
上线的仍是上一次构建出来的旧代码。

## 正确流程：先构建，再重启

用 `deploy` 脚本，它把两步串起来，构建失败就停下、不重启：

```bash
pnpm run deploy
```

注意必须带 `run`：`deploy` 是 pnpm 自带子命令（workspace 部署），裸执行
`pnpm deploy` 会报 `ERR_PNPM_INVALID_DEPLOY_TARGET`，不会走到本项目的脚本。

等价于 `pnpm build` 成功后才执行
`launchctl kickstart -k gui/$(id -u)/com.freewind.mac-manager`。
脚本复用现有 `build`，不复制构建命令；对已安装的 launchd 服务用 kickstart 重启，
不生成、不改动 plist。

改代码后重启服务前，先跑 [build](../package.json) 是硬要求，不要用
`launchctl kickstart` 或其它重启手段绕过它。

## 上线后核实监听地址

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep 51510
```

期望看到 `127.0.0.1:51510`。若显示 `*:51510`，先确认服务进程的启动时间是否晚于
构建产物时间：进程早于产物，说明跑的还是旧构建，重启一次即可。

## 2026-10-11 `*:51510` 事故

现象：`lsof` 显示生产端口监听在 `*:51510`（全网卡），看起来回环绑定没生效。

核实结果：源码 [main.ts](../src/server/main.ts) 的回环绑定是对的，构建产物
`dist-ssr/server/main.js` 里也已经是 `127.0.0.1`；但当时运行的进程启动时间早于
该产物的构建时间，是**过期进程**。也就是说，问题不在代码，而在部署环节：
改了代码、没有重新构建就重启了服务，于是旧进程继续按旧代码监听。

结论与防复发：部署必须走 `pnpm build` 之后再重启；`deploy` 脚本把这个顺序固化下来，
构建不通过就不会重启服务。
