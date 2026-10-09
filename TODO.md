# TODO — 待整改偏差清单

按整改优先级排列；改完一条就从本文件删除该条。整改时以 [AGENTS.md](./AGENTS.md) 的硬规范为准（括号内为对应章节）。

1. [ ] `unwrap` 在 7 个 `client-api/*.ts` 中各复制一份 → 提取到 `client.ts` 共用（AGENTS 4.5）。
2. [ ] 通知双轨：`ports/traffic/disk-growth/system-services` 页面用自造 `notice` + Alert，`files/processes/frp` 用 sonner → 统一 sonner（AGENTS 4.6）。
3. [ ] Zustand 命名不一致：`useDiskGrowthStore`/`useDashboardStore` 缺 `Local` → 改为 `useDiskGrowthLocalStore`/`useDashboardLocalStore`。
4. [ ] 入口 hook `useFrpPage` → 改名 `useFrp`。
5. [ ] `disk-growth/queries.ts` 私有 `KEYS` → 改导出 `diskGrowthKeys`；并把从 `@shared/api-contract/types` 的深引用改回 `@shared/api-contract`（index）。
6. [ ] 响应式未做二分：各页面散用 `sm:/lg:/xl:` 断点，`useIsMobile` 无人调用 → 按 AGENTS 4.7 收敛为 md（768）二分，并为手机补抽屉/滑动布局。
7. [ ] 状态码现状不齐（动作类混用 200/201/202；`OkResponse{ok:true}` 与 `ActionResponse{message}` 并存）→ 按 AGENTS 4.2 统一，涉及 routes + schemas + handler + client-api 四层同步改。
8. [ ] 两个 SQLite 文件（`snapshots.sqlite3` 与 traffic 自拼的 `traffic.sqlite3`）→ traffic store 改用 `env.DATABASE_FILE`，表已带 `traffic_` 前缀，可直接共库（AGENTS 4.3）。
9. [ ] 公共 schema 错放：`ApiErrorSchema`/`ActionResponseSchema` 在 `schemas/disk-growth.ts`，`KillProcesses*` 在 `schemas/traffic.ts`，被多域引用 → 抽到 `schemas/common.ts`，各域改从 common 引。
10. [ ] 后端 handler 风格两套：`ports/handlers.ts` 用 `AppRouteImplementation` 常量先行、`disk-growth` 是一端一文件目录 + 导出名 `serverRouter`（应为 `diskGrowthRouter`）→ 统一为 AGENTS 4.4 的单文件形态；disk-growth 的 health 路由移出（`serverRouter` 现包含 `healthRoutes`，health 应单独成域或挂到独立 handler）。
11. [ ] `api-path/index.ts` 冗余计算键 `` [`${API_BASE}/x`]: `${API_BASE}/x` `` → 直接写普通键值。
12. [ ] 职责文件名四种并存（`domain.ts`/`display.ts`/`labels.ts`/`actions.ts`）→ 新增文件按 AGENTS 4.5 命名约定；存量不强迁，改动到哪个文件顺手归一。
13. [ ] `app.ts` 里各域注册顺序无固定顺序 → 按固定顺序排齐（frp 的 `registerUploadEndpoint` 游离于契约外是有意为之，见其注释，保留）。
14. [ ] 零测试 → 至少为 `server/common` 与 `shared` 纯函数补单测；提交卡口（lint-staged/husky）可后议。
15. [ ] 错误文案处理在各 `use<域>.ts` 里重复实现 `error instanceof Error ? ... : String(error)` → 抽到 `shared/format.ts` 或 client-api 统一。
