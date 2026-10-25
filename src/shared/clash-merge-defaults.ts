/**
 * 合并配置里固定的三条 GEO 分流：国内直连、国外走代理。
 *
 * 页面固定展示、不入库；用户自定义的分类规则排在它们前面，方便先命中特例。
 * 分类在 geosite.dat 里不存在时直接跳过，不让默认规则挡住合并。
 */
export const DEFAULT_GEOSITE_RULES = [
  { code: "CN", target: "direct" },
  { code: "GEOLOCATION-CN", target: "direct" },
  { code: "GEOLOCATION-!CN", target: "proxy" },
] as const

/**
 * 流量嗅探的端口配置：三项都是逗号分隔的端口或端口范围。
 *
 * 存成字符串而不是数字数组，因为 `1-65535` 这种范围写法本身不是数字。
 */
export type SnifferPorts = { tls: string; quic: string; http: string }

/**
 * 默认嗅探端口：TLS 与 HTTP 走全端口，故能盖住各种非常规端口的站点；
 * QUIC 只用 443/8443，避开对游戏、BT 等 UDP 流量做昂贵的解密尝试。
 */
export const DEFAULT_SNIFFER_PORTS: SnifferPorts = {
  tls: "1-65535",
  quic: "443, 8443",
  http: "1-65535",
}

/** 合并后可选的组类型：手动选、延迟最低、按序兜底。 */
export type ClashMergeGroupType = "select" | "url-test" | "fallback"

/**
 * 测速参数：url-test 与 fallback 组共用，全局一份，不为每个组单独填。
 * 用 http 而不是 https：省一次 TLS 握手，检查更快；这个地址只回 204。
 */
export const DEFAULT_HEALTH_CHECK = {
  url: "http://www.gstatic.com/generate_204",
  interval: 300,
}

/** url-test 的容差：延迟差在这范围内视为持平，避免在两个节点间来回抖。 */
export const MERGED_URL_TEST_TOLERANCE = 50
