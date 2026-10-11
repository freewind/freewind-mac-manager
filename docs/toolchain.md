# 工具链运行前提

- Node 必须提供 node:sqlite 与 process.loadEnvFile；使用锁文件中的 pnpm 和 TypeScript 7。
- Biome recommended 检查覆盖手写源码、测试、脚本、配置；Vite/Vitest仅豁免额外的默认导出风格规则。
- 官方 UI、官方 use-mobile hook及生成物排除检查与自动修复；业务代码不禁用recommended。
- 团队插件来自用户全局技能库，不复制到其他Agent目录；换机器时需先同步全局技能仓库，并按该机器用户主目录解析插件引用。
- pre-commit执行lint-staged，只读Biome检查；没有支持的暂存文件（如纯文档）正常放行。
- lint-staged管理部分暂存隔离；本项目不增加自造暂存脚本，不运行全仓自动修复作为提交步骤。
- pnpm lint、typecheck、test与build用于代码交付；手机安装、跨设备实际使用、触控及权限行为由用户后期人工验证。

本轮实际提交已验证纯文档放行及代码Biome卡口；跨机器实际使用属于后期验收，不阻塞代码交付。
