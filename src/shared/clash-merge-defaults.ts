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
 * 自定义域名规则的写入顺序：特定组 → 拒绝 → 直连 → 走代理。
 * 钉到具体地区组的域名最具体，先让它命中；再挡广告、再让该直连的别绕路。
 * 页面上的四个分区也按这个顺序摆。
 */
export const customRuleTargetRank = (target: string): number => {
  if (target === "reject") return 1
  if (target === "direct") return 2
  if (target === "proxy") return 3
  return 0
}

/**
 * 合并用的基座模板：合并产物里所有手写配置都从这里来。
 *
 * 订阅只提供节点，规则与各项行为全部由我们定义；页面生成的 proxies、
 * proxy-groups 与规则骨架会拼接到它上面，模板里的 rules 追加在 MATCH 之前。
 */
export const DEFAULT_MERGE_TEMPLATE = `# ---------------------------------------------------------------------------
# 基座模板：产物里所有手写配置都来自这里。
# 两块标着「页面生成」的占位必须留着：它们是位置标记，值写成空数组就行，
# 合并时会用勾选的订阅与分组规则替换掉它们。
# rules 是拼接：页面生成的规则（自定义 → GEO → 固定三条）在前，
# 这里列出的规则接在其后，最后自动补一条 MATCH。
# ---------------------------------------------------------------------------

mode: rule
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
# geo 数据交给 Clash Verge 自己管理：内核从 GitHub 拉在境内经常失败，
# 每天白跑一次还可能在失败后把本地数据折腾成一半。
geo-auto-update: false
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  use-hosts: true
  # DNS 请求按规则走：和路由用同一套判断，不会出现「解析走直连、连接走代理」的偏差。
  respect-rules: true
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  # 前两个是纯 UDP IP，第三个是 DoH：单靠 DoH 时它的 TLS 一抖，
  # 就会有部分域名解析失败（表现为个别站点超时，其它都正常）。
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://dns.alidns.com/dns-query
  # 节点服务器的域名用国内纯 IP 解析：没这一条时内核会走 fallback 那套，
  # 而境外 DoH 在境内会被 reset，结果是所有节点都连不上（表现为全部测速超时）。
  proxy-server-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  # 这些域名不要假 IP：局域网设备、时间同步、系统联网探测、
  # 语音与游戏加速都靠真实解析，被 fake-ip 接管后直接不可用。
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "*.localdomain"
    - "*.localhost"
    - "*.home.arpa"
    - "*.test"
    - "time.*.com"
    - "time.*.gov"
    - "time.*.apple.com"
    - "time.windows.com"
    - "ntp.*.com"
    - "+.pool.ntp.org"
    - "*.msftconnecttest.com"
    - "*.msftncsi.com"
    - "captive.apple.com"
    - "connectivitycheck.gstatic.com"
    - "localhost.ptlogin2.qq.com"
    - "stun.*.*"
    - "stun.*.*.*"
    - "+.stun.*.*"
    - "+.stun.playstation.net"
    - "xbox.*.*.microsoft.com"
    - "*.*.xboxlive.com"
    - "*.srv.nintendo.net"

# ===== 页面生成：勾选订阅的全部节点（内容会被替换，位置保留）=====
proxies: []

# ===== 页面生成：节点选择 / 地区组 / 直连 / 拒绝（内容会被替换）=====
proxy-groups: []

sniffer:
  enable: true
  force-dns-mapping: true
  override-destination: true
  parse-pure-ip: true
  # 这些流量不要嗅探：米家、Apple 推送与 STUN 语音链路对 TLS 嗅探敏感，
  # 嗅探后重写目标会变成推送变慢、语音连不上。
  skip-domain:
    - "Mijia Cloud"
    - "+.push.apple.com"
    - "+.apple.com"
    - "+.stun.*.*"
  sniff:
    TLS:
      ports: ["1-65535"]
    QUIC:
      ports: ["443", "8443"]
    HTTP:
      ports: ["80", "8080-8880"]

# ===== 固定分流规则 =====
# 只留一条按 IP 的：嗅探不到域名的国内连接靠它才不会误走代理。
# GEOSITE 分类分流已经移到页面的「域名规则」里，与其他规则一起按出口排序，
# 最后自动补一条 MATCH 收尾。
rules:
  - GEOIP,CN,DIRECT,no-resolve
`
