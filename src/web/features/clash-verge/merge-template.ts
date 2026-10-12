/**
 * 别名行模板：跨订阅通用写法，只提供复制入口，不默认写入用户文件。
 * 解释文案沿用用户对 prepend-rules / prepend-proxy-groups 的既有说明。
 */
export const MERGE_ALIAS_TEMPLATE = `# 跨订阅通用规则：写在全局 Merge（uid: Merge）里，对所有订阅生效
# prepend-rules：在订阅自带规则之前插入本段规则
#   规则格式：类型,匹配内容,目标
# prepend-proxy-groups：在订阅自带分组之前插入固定分组
#   include-all-proxies: true 会收纳当前订阅的全部节点
prepend-proxy-groups:
  - name: GLOBAL-SELECT
    type: select
    include-all-proxies: true

prepend-rules:
  # 目标指向固定组名，订阅切换后规则仍然生效
  - DOMAIN-SUFFIX,example.com,GLOBAL-SELECT
`
