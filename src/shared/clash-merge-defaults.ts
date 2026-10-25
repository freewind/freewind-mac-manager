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
/**
 * 合并用的基座模板：合并产物里所有手写配置都从这里来。
 *
 * 订阅只提供节点，规则与各项行为全部由我们定义；页面生成的 proxies、
 * proxy-groups 与规则骨架会拼接到它上面，模板里的 rules 追加在 MATCH 之前。
 */
export const DEFAULT_MERGE_TEMPLATE = `mode: rule
log-level: info
ipv6: false
udp: true
unified-delay: true
tcp-concurrent: true
find-process-mode: strict
profile:
  store-selected: true
  store-fake-ip: true
geodata-mode: true
geo-auto-update: true
geo-update-interval: 24
# DNS 必须自己给：机场的 dns 不再继承，缺了会导致部分节点解析失败。
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://dns.cloudflare.com/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN
# 嗅探：TLS 开全端口盖住非常规端口的站点，QUIC 与 HTTP 收窄省 CPU。
sniffer:
  enable: true
  force-dns-mapping: true
  override-destination: true
  parse-pure-ip: true
  sniff:
    TLS:
      ports: ["1-65535"]
    QUIC:
      ports: ["443", "8443"]
    HTTP:
      ports: ["80", "8080-8880"]
# 固定规则：排在页面生成的规则之后、MATCH 之前。
rules:
  - GEOIP,CN,DIRECT,no-resolve
`
