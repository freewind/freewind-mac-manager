import { describe, expect, it } from "vitest"
import {
  CADDY_MANAGED_END,
  CADDY_MANAGED_START,
  type CaddyRuleSignatureInput,
  caddyMatcherName,
  caddyRulesSignature,
  generateManagedRules,
  type ManagedRuleForGenerate,
  normalizeCaddyPathPrefix,
  parseCaddyfile,
  replaceManagedRegion,
  validateCaddyHost,
  validateCaddyPathPrefix,
  validateCaddyUpstream,
} from "./caddy-format"

/**
 * 真实文件的脱敏副本：结构完全一致（全局选项块 + :8443 站点块 + tls +
 * 4 条 handle_path + 4 组 @x host 与 handle @x + 中文注释），只把域名、
 * 端口与本机路径换成示例值。
 */
const FIXTURE = `{
	admin off
	auto_https disable_redirects
	email admin@example.com
	servers {
		# frp 只转发 TCP，UDP 到不了本机；若继续广播 Alt-Svc h3，浏览器会把请求
		# 切到 QUIC（UDP）而卡死/报网络错误，故只开 h1/h2。
		protocols h1 h2
	}
}

# 单一 HTTPS 网关：只监听本机 8443，由 frp 的 34085 端口透传进来。
# 使用自签私有 CA 证书；手机安装并信任根证书后即可访问。
:8443 {
	tls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key

	# 按 URL 路径剥离前缀后转发到对应应用。
	handle_path /alpha/* {
		reverse_proxy 127.0.0.1:15001
	}

	handle_path /alpha-dev/* {
		reverse_proxy 127.0.0.1:15002
	}

	handle_path /beta/* {
		reverse_proxy 127.0.0.1:15003
	}

	handle_path /gamma/* {
		reverse_proxy 127.0.0.1:15004
	}

	@alpha host alpha.example.com
	handle @alpha {
		reverse_proxy 127.0.0.1:15001
	}

	@alphadev host alpha-dev.example.com
	handle @alphadev {
		reverse_proxy 127.0.0.1:15002
	}

	@beta host beta.example.com
	handle @beta {
		reverse_proxy 127.0.0.1:15003
	}

	@gamma host gamma.example.com
	handle @gamma {
		reverse_proxy 127.0.0.1:15004
	}
}
`

describe("parseCaddyfile", () => {
  it("识别真实结构里的 8 条转发规则", () => {
    const parsed = parseCaddyfile(FIXTURE)
    expect(parsed.siteAddresses).toEqual([":8443"])
    expect(parsed.hasGlobalOptionsBlock).toBe(true)
    expect(parsed.managedRegion).toBeNull()
    expect(parsed.unsupported).toEqual([])
    expect(parsed.rules).toMatchInlineSnapshot(`
      [
        {
          "host": null,
          "id": "path:/alpha/*",
          "line": 18,
          "matchKind": "path",
          "origin": "external",
          "pathPrefix": "/alpha/*",
          "stripPrefix": true,
          "upstream": "127.0.0.1:15001",
        },
        {
          "host": null,
          "id": "path:/alpha-dev/*",
          "line": 22,
          "matchKind": "path",
          "origin": "external",
          "pathPrefix": "/alpha-dev/*",
          "stripPrefix": true,
          "upstream": "127.0.0.1:15002",
        },
        {
          "host": null,
          "id": "path:/beta/*",
          "line": 26,
          "matchKind": "path",
          "origin": "external",
          "pathPrefix": "/beta/*",
          "stripPrefix": true,
          "upstream": "127.0.0.1:15003",
        },
        {
          "host": null,
          "id": "path:/gamma/*",
          "line": 30,
          "matchKind": "path",
          "origin": "external",
          "pathPrefix": "/gamma/*",
          "stripPrefix": true,
          "upstream": "127.0.0.1:15004",
        },
        {
          "host": "alpha.example.com",
          "id": "host:alpha.example.com",
          "line": 35,
          "matchKind": "host",
          "origin": "external",
          "pathPrefix": null,
          "stripPrefix": false,
          "upstream": "127.0.0.1:15001",
        },
        {
          "host": "alpha-dev.example.com",
          "id": "host:alpha-dev.example.com",
          "line": 40,
          "matchKind": "host",
          "origin": "external",
          "pathPrefix": null,
          "stripPrefix": false,
          "upstream": "127.0.0.1:15002",
        },
        {
          "host": "beta.example.com",
          "id": "host:beta.example.com",
          "line": 45,
          "matchKind": "host",
          "origin": "external",
          "pathPrefix": null,
          "stripPrefix": false,
          "upstream": "127.0.0.1:15003",
        },
        {
          "host": "gamma.example.com",
          "id": "host:gamma.example.com",
          "line": 50,
          "matchKind": "host",
          "origin": "external",
          "pathPrefix": null,
          "stripPrefix": false,
          "upstream": "127.0.0.1:15004",
        },
      ]
    `)
  })

  it("handle 块内不是恰好一行 reverse_proxy 时整块计为无法识别", () => {
    const parsed = parseCaddyfile(`:8443 {
	handle_path /extra/* {
		reverse_proxy 127.0.0.1:15001
		encode gzip
	}
}
`)
    expect(parsed.rules).toEqual([])
    expect(parsed.unsupported).toMatchInlineSnapshot(`
      [
        {
          "line": 2,
          "text": "handle_path /extra/* {",
        },
        {
          "line": 3,
          "text": "reverse_proxy 127.0.0.1:15001",
        },
        {
          "line": 4,
          "text": "encode gzip",
        },
      ]
    `)
  })

  it("认不出的站点级指令计为无法识别并保留行号", () => {
    const parsed = parseCaddyfile(`:8443 {
	encode gzip
	handle_path /ok/* {
		reverse_proxy 127.0.0.1:15001
	}
}
`)
    expect(parsed.unsupported).toMatchInlineSnapshot(`
      [
        {
          "line": 2,
          "text": "encode gzip",
        },
      ]
    `)
    expect(parsed.rules).toHaveLength(1)
  })

  it("标记行成对时区域内规则为 managed、区域外为 external", () => {
    const parsed = parseCaddyfile(`:8443 {
	${CADDY_MANAGED_START}
	handle_path /managed/* {
		reverse_proxy 127.0.0.1:15001
	}
	${CADDY_MANAGED_END}
	handle_path /external/* {
		reverse_proxy 127.0.0.1:15002
	}
}
`)
    expect(parsed.managedRegion).toEqual({ startLine: 2, endLine: 6 })
    expect(parsed.rules.map((rule) => rule.origin)).toEqual([
      "managed",
      "external",
    ])
  })

  it("标记行不成对时 managedRegion 为 null 且不报错", () => {
    const parsed = parseCaddyfile(`:8443 {
	${CADDY_MANAGED_START}
	handle_path /managed/* {
		reverse_proxy 127.0.0.1:15001
	}
}
`)
    expect(parsed.managedRegion).toBeNull()
    expect(parsed.unsupported).toEqual([])
    expect(parsed.rules.map((rule) => rule.origin)).toEqual(["external"])
  })

  it("同一匹配条件重复出现时 id 追加序号", () => {
    const parsed = parseCaddyfile(`:8443 {
	handle_path /dup/* {
		reverse_proxy 127.0.0.1:15001
	}
	handle_path /dup/* {
		reverse_proxy 127.0.0.1:15002
	}
}
`)
    expect(parsed.rules.map((rule) => rule.id)).toEqual([
      "path:/dup/*",
      "path:/dup/*#2",
    ])
  })

  it("多个站点块各自使用本块的 matcher，不串用", () => {
    const parsed = parseCaddyfile(`alpha.example.com {
	@same host alpha.example.com
	handle @same {
		reverse_proxy 127.0.0.1:15001
	}
}

beta.example.com {
	@same host beta.example.com
	handle @same {
		reverse_proxy 127.0.0.1:15002
	}
}
`)
    expect(parsed.siteAddresses).toEqual([
      "alpha.example.com",
      "beta.example.com",
    ])
    expect(parsed.unsupported).toEqual([])
    expect(
      parsed.rules.map((rule) => [rule.host, rule.upstream])
    ).toMatchInlineSnapshot(`
      [
        [
          "alpha.example.com",
          "127.0.0.1:15001",
        ],
        [
          "beta.example.com",
          "127.0.0.1:15002",
        ],
      ]
    `)
  })

  it("站点块内 handle @foo 没有同名 matcher 时计入无法识别", () => {
    const parsed = parseCaddyfile(`alpha.example.com {
	@same host alpha.example.com
	handle @same {
		reverse_proxy 127.0.0.1:15001
	}
}

beta.example.com {
	handle @same {
		reverse_proxy 127.0.0.1:15002
	}
}
`)
    expect(parsed.rules.map((rule) => rule.host)).toEqual(["alpha.example.com"])
    expect(parsed.unsupported).toMatchInlineSnapshot(`
      [
        {
          "line": 9,
          "text": "handle @same {",
        },
      ]
    `)
  })
})

describe("校验器", () => {
  it("host：合法放行，非法给出中文原因", () => {
    expect([
      validateCaddyHost("example.com"),
      validateCaddyHost("*.example.com"),
      validateCaddyHost("bad host"),
      validateCaddyHost("bad{host}"),
      validateCaddyHost("example.com:8443"),
      validateCaddyHost("-bad.example.com"),
    ]).toMatchInlineSnapshot(`
      [
        null,
        null,
        "域名不能包含空白、斜杠、冒号、引号、花括号、井号或反引号",
        "域名不能包含空白、斜杠、冒号、引号、花括号、井号或反引号",
        "域名不能包含空白、斜杠、冒号、引号、花括号、井号或反引号",
        "域名不能以点或连字符开头或结尾",
      ]
    `)
  })

  it("path：必须 / 开头，禁止空白与花括号", () => {
    expect([
      validateCaddyPathPrefix("/alpha/*"),
      validateCaddyPathPrefix("alpha/*"),
      validateCaddyPathPrefix("/bad path"),
      validateCaddyPathPrefix("/bad{path}"),
    ]).toMatchInlineSnapshot(`
      [
        null,
        "路径必须以 / 开头",
        "路径不能包含空白、引号、花括号、井号或反引号",
        "路径不能包含空白、引号、花括号、井号或反引号",
      ]
    `)
  })

  it("upstream：端口与主机名都要合法", () => {
    expect([
      validateCaddyUpstream("127.0.0.1:15001"),
      validateCaddyUpstream("http://127.0.0.1:15001"),
      validateCaddyUpstream("[::1]:15001"),
      validateCaddyUpstream("app.example.com:15001"),
      validateCaddyUpstream("127.0.0.1:99999"),
      validateCaddyUpstream("bad_host:80"),
      validateCaddyUpstream("127.0.0.1:80 bad"),
      validateCaddyUpstream("127.0.0.1:80{"),
    ]).toMatchInlineSnapshot(`
      [
        null,
        null,
        null,
        null,
        "端口必须是 1 到 65535 之间的整数",
        "主机名必须是 IPv4、[IPv6] 或合法域名",
        "上游地址不能包含空白",
        "上游地址不能包含引号、花括号、井号或反引号",
      ]
    `)
  })

  it("归一化只去掉结尾的 * 与多余的 /", () => {
    expect([
      normalizeCaddyPathPrefix("/alpha/*"),
      normalizeCaddyPathPrefix("/alpha/"),
      normalizeCaddyPathPrefix("/alpha"),
      normalizeCaddyPathPrefix("/"),
    ]).toMatchInlineSnapshot(`
      [
        "/alpha",
        "/alpha",
        "/alpha",
        "/",
      ]
    `)
  })
})

const GENERATE_RULES: ManagedRuleForGenerate[] = [
  {
    id: "path:/alpha/*",
    matchKind: "path",
    host: null,
    pathPrefix: "/alpha/*",
    stripPrefix: true,
    upstream: "127.0.0.1:15001",
    enabled: true,
    sortOrder: 0,
  },
  {
    id: "path:/beta/*",
    matchKind: "path",
    host: null,
    pathPrefix: "/beta/*",
    stripPrefix: true,
    upstream: "127.0.0.1:15002",
    enabled: true,
    sortOrder: 1,
  },
  {
    id: "path:/gamma/*",
    matchKind: "path",
    host: null,
    pathPrefix: "/gamma/*",
    stripPrefix: true,
    upstream: "127.0.0.1:15003",
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "path:/delta",
    matchKind: "path",
    host: null,
    pathPrefix: "/delta",
    stripPrefix: false,
    upstream: "127.0.0.1:15004",
    enabled: true,
    sortOrder: 3,
  },
  {
    id: "host:alpha.example.com",
    matchKind: "host",
    host: "alpha.example.com",
    pathPrefix: null,
    stripPrefix: false,
    upstream: "127.0.0.1:15001",
    enabled: true,
    sortOrder: 4,
  },
  {
    id: "host:alpha-dev.example.com",
    matchKind: "host",
    host: "alpha-dev.example.com",
    pathPrefix: null,
    stripPrefix: false,
    upstream: "127.0.0.1:15002",
    enabled: true,
    sortOrder: 5,
  },
  {
    id: "host:beta.example.com",
    matchKind: "host",
    host: "beta.example.com",
    pathPrefix: null,
    stripPrefix: false,
    upstream: "127.0.0.1:15003",
    enabled: true,
    sortOrder: 6,
  },
  {
    id: "host:gamma.example.com",
    matchKind: "host",
    host: "gamma.example.com",
    pathPrefix: null,
    stripPrefix: false,
    upstream: "127.0.0.1:15004",
    enabled: true,
    sortOrder: 7,
  },
]

const SIGNATURE_RULE: CaddyRuleSignatureInput = {
  matchKind: "path",
  host: null,
  pathPrefix: "/alpha/*",
  stripPrefix: true,
  upstream: "127.0.0.1:15001",
  enabled: true,
  sortOrder: 0,
}

const WITH_REGION = `{
	admin off
}

# 单一 HTTPS 网关：只监听本机 8443。
:8443 {
	tls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key

	# 按 URL 路径剥离前缀后转发到对应应用。
	handle_path /keep/* {
		reverse_proxy 127.0.0.1:15009
	}

	# mac-manager:rules:start
	handle_path /old/* {
		reverse_proxy 127.0.0.1:15001
	}
	# mac-manager:rules:end
}
`

describe("受管区域文本", () => {
  it("按 sortOrder 生成 4 条 path 与 4 条 host 的正文", () => {
    expect(generateManagedRules(GENERATE_RULES)).toMatchInlineSnapshot(`
      "	# 本区域由 mac-manager 生成，手工改动会在下次应用时被覆盖。
      	handle_path /alpha/* {
      		reverse_proxy 127.0.0.1:15001
      	}
      	handle_path /beta/* {
      		reverse_proxy 127.0.0.1:15002
      	}
      	handle_path /gamma/* {
      		reverse_proxy 127.0.0.1:15003
      	}
      	handle /delta {
      		reverse_proxy 127.0.0.1:15004
      	}
      	@mm_hostalphaexam4192 host alpha.example.com
      	handle @mm_hostalphaexam4192 {
      		reverse_proxy 127.0.0.1:15001
      	}
      	@mm_hostalphadeve6f7c host alpha-dev.example.com
      	handle @mm_hostalphadeve6f7c {
      		reverse_proxy 127.0.0.1:15002
      	}
      	@mm_hostbetaexampb985 host beta.example.com
      	handle @mm_hostbetaexampb985 {
      		reverse_proxy 127.0.0.1:15003
      	}
      	@mm_hostgammaexamc0a9 host gamma.example.com
      	handle @mm_hostgammaexamc0a9 {
      		reverse_proxy 127.0.0.1:15004
      	}
      "
    `)
  })

  it("停用规则不产出任何行，全部停用时正文为空", () => {
    expect(generateManagedRules([])).toBe("")
    expect(
      generateManagedRules([{ ...GENERATE_RULES[0], enabled: false }])
    ).toBe("")
    const mixed = generateManagedRules([
      { ...GENERATE_RULES[0], enabled: true },
      { ...GENERATE_RULES[4], enabled: false },
    ])
    expect(mixed).not.toContain("@mm_")
    expect(mixed).toMatchInlineSnapshot(`
      "	# 本区域由 mac-manager 生成，手工改动会在下次应用时被覆盖。
      	handle_path /alpha/* {
      		reverse_proxy 127.0.0.1:15001
      	}
      "
    `)
  })

  it("matcher 名对同一 id 稳定、对不同 id 不同且不超过 20 个字符", () => {
    const longId = `host:${"a".repeat(120)}.example.com`
    const names = [
      caddyMatcherName("host:alpha.example.com"),
      caddyMatcherName(longId),
      caddyMatcherName("host:alpha-dev.example.com"),
    ]
    expect(caddyMatcherName("host:alpha.example.com")).toBe(names[0])
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name.length <= 20)).toBe(true)
    expect(names).toMatchInlineSnapshot(`
      [
        "mm_hostalphaexam4192",
        "mm_hostaaaaaaaaabdd3",
        "mm_hostalphadeve6f7c",
      ]
    `)
  })

  it("只替换标记之间的内容，其余部分逐字节不变", () => {
    const body = `${generateManagedRules(GENERATE_RULES.slice(0, 1))}`
    const result = replaceManagedRegion(WITH_REGION, body)
    expect(result.replaced).toBe(true)
    const startIndex = WITH_REGION.indexOf(CADDY_MANAGED_START)
    const endIndex = WITH_REGION.indexOf(CADDY_MANAGED_END)
    expect(result.text.startsWith(WITH_REGION.slice(0, startIndex))).toBe(true)
    expect(result.text.endsWith(WITH_REGION.slice(endIndex))).toBe(true)
    expect(result.text).toContain("handle_path /keep/*")
    expect(result.text).toContain("tls /Users/example/")
    expect(result.text).not.toContain("/old/*")
    expect(result.text).toMatchInlineSnapshot(`
      "{
      	admin off
      }

      # 单一 HTTPS 网关：只监听本机 8443。
      :8443 {
      	tls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key

      	# 按 URL 路径剥离前缀后转发到对应应用。
      	handle_path /keep/* {
      		reverse_proxy 127.0.0.1:15009
      	}

      	# mac-manager:rules:start
      	# 本区域由 mac-manager 生成，手工改动会在下次应用时被覆盖。
      	handle_path /alpha/* {
      		reverse_proxy 127.0.0.1:15001
      	}
      	# mac-manager:rules:end
      }
      "
    `)
  })

  it("CRLF 文件里插入的正文也用 CRLF", () => {
    const crlf = WITH_REGION.replace(/\n/g, "\r\n")
    const body = generateManagedRules(GENERATE_RULES.slice(0, 1))
    const result = replaceManagedRegion(crlf, body)
    expect(result.replaced).toBe(true)
    expect(result.text).toContain(
      `${CADDY_MANAGED_START}\r\n\t# 本区域由 mac-manager 生成`
    )
    expect(result.text).toContain("}\r\n\t# mac-manager:rules:end")
    expect(result.text).not.toMatch(/[^\r]\n\t# 本区域/)
  })

  it("正文为空时区域内只剩标记行", () => {
    const result = replaceManagedRegion(WITH_REGION, "")
    expect(result.replaced).toBe(true)
    expect(result.text).toMatchInlineSnapshot(`
      "{
      	admin off
      }

      # 单一 HTTPS 网关：只监听本机 8443。
      :8443 {
      	tls /Users/example/.config/caddy/ca/server.crt /Users/example/.config/caddy/ca/server.key

      	# 按 URL 路径剥离前缀后转发到对应应用。
      	handle_path /keep/* {
      		reverse_proxy 127.0.0.1:15009
      	}

      	# mac-manager:rules:start
      	# mac-manager:rules:end
      }
      "
    `)
  })

  it("找不到成对标记时原样返回", () => {
    const missing = WITH_REGION.replace(`${CADDY_MANAGED_END}\n`, "")
    expect(replaceManagedRegion(missing, "x\n")).toEqual({
      text: missing,
      replaced: false,
    })
    expect(replaceManagedRegion(":8443 {\n}\n", "x\n")).toEqual({
      text: ":8443 {\n}\n",
      replaced: false,
    })
  })
})

describe("规则指纹", () => {
  it("改名与改备注不改指纹", () => {
    const renamed = { ...SIGNATURE_RULE, name: "改名了", note: "备注" }
    expect(caddyRulesSignature([renamed])).toBe(
      caddyRulesSignature([SIGNATURE_RULE])
    )
  })

  it("上游、启停、前缀剥离与顺序会改指纹", () => {
    const base = caddyRulesSignature([SIGNATURE_RULE])
    expect(
      caddyRulesSignature([{ ...SIGNATURE_RULE, upstream: "127.0.0.1:15002" }])
    ).not.toBe(base)
    expect(
      caddyRulesSignature([{ ...SIGNATURE_RULE, enabled: false }])
    ).not.toBe(base)
    expect(
      caddyRulesSignature([{ ...SIGNATURE_RULE, stripPrefix: false }])
    ).not.toBe(base)
    const second: CaddyRuleSignatureInput = {
      ...SIGNATURE_RULE,
      pathPrefix: "/beta/*",
      sortOrder: 1,
    }
    expect(caddyRulesSignature([second, SIGNATURE_RULE])).toBe(
      caddyRulesSignature([SIGNATURE_RULE, second])
    )
    expect(
      caddyRulesSignature([
        { ...second, sortOrder: 0 },
        { ...SIGNATURE_RULE, sortOrder: 1 },
      ])
    ).not.toBe(base)
  })
})
