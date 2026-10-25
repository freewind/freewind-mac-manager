/**
 * 「配置详细」页展示的示例配置。
 *
 * 目标是字段尽量全、值尽量小的说明性示例：每个选项只给最小可用值，用注释写清
 * 作用、取值与常见坑。它不参与运行，改这里也不会影响实际配置；实际生效的是
 * 订阅文件与「合并订阅」生成的 freewind-merged.yaml。
 */
export const SAMPLE_CLASH_CONFIG = `# ============================================================
# Clash / mihomo 配置示例（字段最全、值最小）
# 说明：这份文件只用来读懂各项配置，不参与你机器的实际运行。
# ============================================================

# ---------- 一、入口与基础行为 ----------
# 代理端口：HTTP 与 SOCKS5 共用一个端口，客户端填它就行。
mixed-port: 7890
# 纯 HTTP 代理端口。用了 mixed-port 就不需要它，只是演示。
port: 7891
# 纯 SOCKS5 端口，同上。
socks-port: 7892
# 是否接受来自局域网其他设备的连接。false 时内核只监听回环，别人连不上。
# 这就是「本机代理不外传」的全部开关，不需要再写 bind-address。
allow-lan: false
# 绑定地址（日常工作不用写）：
#   不写 = 所有网卡，本机用 127.0.0.1、手机用局域网 IP，两边都通（推荐）。
#   127.0.0.1 = 只绑回环，效果同 allow-lan: false。
#   192.168.1.10 = 只绑这块网卡，但连回环也一起排除了，本机客户端要改用这个 IP。
# 它只在 allow-lan: true 时才有意义；allow-lan: false 时写了也被忽略。
# bind-address: 127.0.0.1
# 运行模式：rule 按规则分流 / global 全部走代理 / direct 全部直连。
mode: rule
# 日志级别：silent / error / warning / info / debug。
log-level: info
# 是否启用 IPv6 解析与连接。多数机场不稳，先 false。
ipv6: false
# 允许客户端用 UDP 走代理；false 时 UDP 一律直连。
udp: true

# 控制接口：Clash Verge、面板、REST 都用它。
external-controller: 127.0.0.1:9090
# 控制接口密码，空字符串表示不校验。只监听回环时可以留空。
secret: ""
# 控制接口跨域白名单，浏览器面板需要。
external-controller-cors:
  allow-origins: ["*"]
  allow-private-network: true

# ---------- 二、自定义入站（需要多个监听地址时用） ----------
# 主端口只能绑一个地址；想同时听多个地址/端口，就定义多个入站。
# 每一项都是独立监听，name 唯一，type 支持 mixed / http / socks / tun 等。
# 也可以把主端口写成 0 全关、只留 listeners；但 Clash Verge 的系统代理、
# 面板都指向 mixed-port，关掉后这些功能会失效，所以实务上保留 mixed-port 更稳。
listeners:
  - name: lan-mixed
    type: mixed
    # 只绑这一块网卡；换成具体局域网 IP 时，回环（127.0.0.1）就连不上了，
    # 本机客户端也得改成那个 IP。想两边都通，就再开一个听回环的入站。
    listen: 127.0.0.1
    port: 7893
    # 是否转发 UDP（游戏、QUIC 需要）。
    udp: true
  - name: local-socks
    type: socks
    # 只给本机用，写回环；要对外就改成 * 或具体网卡 IP。
    listen: 127.0.0.1
    port: 7894

# ---------- 三、TUN 模式（全局接管流量） ----------
tun:
  # 开启后本机所有流量（含不认代理的 App）走 TUN 网卡。
  enable: false
  # 协议栈：system 最稳 / gvisor 不依赖系统 / mixed 混合。
  stack: system
  # 自动加路由，把默认路由指到 TUN。
  auto-route: true
  # 自动探测物理网卡，多网卡环境必须开。
  auto-detect-interface: true
  # 劫持 DNS 查询到本机内核，避免 DNS 泄漏。
  dns-hijack:
    - any:53
  # 不接管的目标地址段，例如局域网与保留地址。
  route-exclude-address:
    - 192.168.0.0/16
    - 127.0.0.0/8

# ---------- 四、DNS ----------
dns:
  # 关闭后只用系统 DNS，规则里的域名匹配会变弱。
  enable: true
  # 内核自己的 DNS 监听地址；TUN 模式下建议 0.0.0.0:1053。
  listen: 0.0.0.0:1053
  # 是否解析 IPv6；与顶层 ipv6 保持一致。
  ipv6: false
  # fake-ip：先返回假地址再接管道，速度快、能按域名分流。
  # redir-host：返回真实 IP，兼容性更好但分流靠 IP 判断。
  enhanced-mode: fake-ip
  # fake-ip 用的保留地址段，不要与局域网网段重叠。
  fake-ip-range: 198.18.0.1/16
  # 这些域名不用 fake-ip，直接返回真实地址（游戏、推送常需要）。
  fake-ip-filter:
    - "*.lan"
    - "+.push.apple.com"
  # 用来解析下面 nameserver 里出现的域名的 DNS，必须是 IP。
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  # 主 DNS：优先用国内可达的，避免解析等待。
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  # 兜底 DNS：主 DNS 结果被判定为污染时才用它。
  fallback:
    - https://dns.cloudflare.com/dns-query
    - https://dns.google/dns-query
  # 什么情况算污染：国外 IP 或指定网段时改走 fallback。
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4
  # 按域名指定 DNS：国内站点用国内 DNS，减少绕路。
  nameserver-policy:
    "geosite:cn": ["https://dns.alidns.com/dns-query"]
    "+.company.internal": ["192.168.1.1"]

# ---------- 五、流量嗅探 ----------
# 作用：从连接首个数据包里读出真实域名（TLS 的 SNI、HTTP 的 Host、QUIC 的 SNI），
# 让域名类规则对「目标是 IP」的连接也能命中。
sniffer:
  # 总开关。
  enable: true
  # 嗅到域名后把它与目标 IP 绑定，日志与反查能看到域名。
  force-dns-mapping: true
  # 对纯 IP 且没有域名线索的连接也尝试解析。
  parse-pure-ip: true
  # 嗅到域名后把连接目标从 IP 改成域名，规则才能按域名命中。
  override-destination: true
  sniff:
    # TLS：读握手里的 SNI。端口可以写全端口，非常规端口的站点也能覆盖。
    TLS:
      ports: ["1-65535"]
    # QUIC：HTTP/3 用的就是它。别开全端口，UDP 流量杂、解密尝试费 CPU。
    QUIC:
      ports: ["443", "8443"]
    # HTTP：读请求头里的 Host。明文 HTTP 现在很少，全端口也无所谓。
    HTTP:
      ports: ["1-65535"]
  # 白名单：这些域名不做嗅探，避免改写目标后破坏局域网发现等功能。
  skip-domain:
    - "+.push.apple.com"

# ---------- 六、性能与网络行为 ----------
# 用一次往返测延迟，避免不同节点因握手次数不同而排名失真。
unified-delay: true
# 同时向多个 IP 发起 TCP 连接，取最快的，提升首次连接速度。
tcp-concurrent: true
# 进程匹配方式：strict 严格 / always 总是 / off 关闭；需要在规则里用 PROCESS-NAME 时开。
find-process-mode: strict
# 对外的 TLS 指纹在节点上用 client-fingerprint 单独设置；
# 旧版的 global-client-fingerprint 已被内核移除，写了会直接报错。
# 空闲连接保留时间（秒），太小会频繁重连。
keep-alive-idle: 600
# TCP keep-alive 探测间隔（秒）。
keep-alive-interval: 30

# ---------- 七、订阅（节点来源之一） ----------
# proxy-providers 提供的节点在运行时下载，配置里只留引用。
proxy-providers:
  机场A:
    type: http
    url: "https://example.com/api/v1/client/subscribe?token=占位token"
    # 多久更新一次节点清单（秒）。
    interval: 3600
    # 下载后存在哪；相对路径以配置目录为基准。
    path: ./providers/jichang-a.yaml
    # 按节点名筛选，不写就是全要。
    filter: "香港|日本|新加坡"
    exclude-filter: "剩余|过期"
    # 给该 provider 的节点统一加前缀，避免与其他订阅重名。
    override:
      additional-prefix: "A-"
      udp: true
    health-check:
      enable: true
      url: "http://www.gstatic.com/generate_204"
      interval: 300

# ---------- 八、规则集（规则来源之一） ----------
# rule-providers 把一长串域名/IP 规则放到单独文件里，按需加载。
rule-providers:
  ads:
    type: http
    behavior: domain
    url: "https://example.com/rules/ads.yaml"
    path: ./ruleset/ads.yaml
    interval: 86400
  cn-ip:
    type: http
    behavior: ipcidr
    url: "https://example.com/rules/cn-ip.yaml"
    path: ./ruleset/cn-ip.yaml
    interval: 86400

# ---------- 九、节点（每种协议只给最小字段） ----------
proxies:
  - name: "SS-示例"
    type: ss
    server: example.com
    port: 8388
    cipher: aes-128-gcm
    password: "占位密码"
    udp: true
  - name: "VMess-示例"
    type: vmess
    server: example.com
    port: 443
    uuid: 00000000-0000-0000-0000-000000000000
    alterId: 0
    cipher: auto
    tls: true
    servername: example.com
    network: ws
    ws-opts:
      path: /path
      headers:
        Host: example.com
  - name: "Trojan-示例"
    type: trojan
    server: example.com
    port: 443
    password: "占位密码"
    sni: example.com
    skip-cert-verify: false
    udp: true
  - name: "VLESS-示例"
    type: vless
    server: example.com
    port: 443
    uuid: 00000000-0000-0000-0000-000000000000
    tls: true
    servername: example.com
    flow: xtls-rprx-vision
    client-fingerprint: chrome
    reality-opts:
      # 32 字节的 base64url 编码；长度不对内核会报 invalid REALITY public key。
      public-key: "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0"
      # 不超过 8 字节的十六进制串。
      short-id: "0123456789abcdef"

# ---------- 十、分组 ----------
proxy-groups:
  # select：你自己在面板上点，节点变慢也不会自动换。
  - name: 节点选择
    type: select
    proxies: [自动选择, 故障转移, 香港, DIRECT]
  # url-test：每 interval 秒测一次，自动用延迟最低的。
  - name: 自动选择
    type: url-test
    proxies: ["SS-示例", "Trojan-示例"]
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    # 延迟差在这范围（毫秒）内视为持平，避免来回抖。
    tolerance: 50
    # true 表示没人用这个组时不测速，省资源。
    lazy: false
  # fallback：按顺序用，前一个不通才换下一个。
  - name: 故障转移
    type: fallback
    proxies: ["Trojan-示例", "VLESS-示例"]
    url: "http://www.gstatic.com/generate_204"
    interval: 300
  # load-balance：把连接分散到多个节点。
  - name: 负载均衡
    type: load-balance
    proxies: ["SS-示例", "VLESS-示例"]
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    # 分流策略：consistent-hashing 同一目标固定走同一节点，round-robin 轮流。
    strategy: consistent-hashing
  # use：直接引用某个 provider 的所有节点，filter 再按名字挑。
  - name: 香港
    type: select
    use: [机场A]
    filter: "香港|HK|Hong"

# ---------- 十一、规则（自上而下，先命中先生效） ----------
rules:
  # 完全匹配一个域名。
  - DOMAIN,www.example.com,节点选择
  # 匹配该域名及其所有子域，最常用。
  - DOMAIN-SUFFIX,google.com,节点选择
  # 域名里包含该关键词就算命中，覆盖最广也最容易误伤。
  - DOMAIN-KEYWORD,ads,REJECT
  # 正则匹配域名，灵活但慢，能不用就不用。
  - DOMAIN-REGEX,^api\\..*\\.example\\.com$,节点选择
  # 按 geosite 分类匹配（来自 geosite.dat）。
  - GEOSITE,cn,DIRECT
  # 按 IP 归属地匹配（来自 geoip.dat）。
  - GEOIP,CN,DIRECT
  # 匹配 IP 段；no-resolve 表示不要为了匹配去解析域名。
  - IP-CIDR,1.1.1.1/32,节点选择,no-resolve
  - IP-CIDR6,2606:4700::/32,节点选择,no-resolve
  # 按来源 IP 匹配，常用于局域网直连。
  - SRC-IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  # 按目的端口匹配。
  - DST-PORT,22,DIRECT
  # 按进程名匹配，需要 find-process-mode 不为 off。
  - PROCESS-NAME,Telegram,DIRECT
  # 按进程路径匹配。
  - PROCESS-PATH,/Applications/Example.app/Contents/MacOS/Example,DIRECT
  # 引用 rule-providers 里的规则集。
  - RULE-SET,ads,REJECT
  - RULE-SET,cn-ip,DIRECT
  # 逻辑组合：AND 需要全部成立，OR 任意成立，NOT 取反。
  - AND,((DOMAIN-SUFFIX,example.com),(NETWORK,tcp)),节点选择
  # 兜底：所有没命中的流量走这里。必须放最后，否则后面规则永远不生效。
  - MATCH,节点选择

# ---------- 十二、其它 ----------
profile:
  # 记住你在面板上选过的节点，重启后恢复。
  store-selected: true
  # 记住 fake-ip 映射，重启后旧连接还能对应到域名。
  store-fake-ip: true
# true 表示 GEOSITE/GEOIP 用 .dat 格式数据（mihomo 默认），false 用 mmdb。
geodata-mode: true
# 自动更新 geosite.dat / geoip.dat / Country.mmdb。
geo-auto-update: true
# 更新间隔（小时）。
geo-update-interval: 24
# 数据文件下载地址，换镜像时改这里。
geox-url:
  geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb"
`
