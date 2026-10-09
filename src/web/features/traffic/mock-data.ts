/** 本轮只做界面框架，数据全部来自这里的假数据，尚未接后端。 */

export type TrafficChild = {
  key: string
  label: string
  scriptName: string
  parent: string
  pids: number[]
  running: boolean
  bytesIn: number
  bytesOut: number
  command: string
}

export type TrafficGroup = {
  name: string
  bytesIn: number
  bytesOut: number
  children: TrafficChild[]
}

export type TrafficStatus = {
  downloadRate: number
  uploadRate: number
  sampledAt: number
  intervalSeconds: number
}

const kb = (value: number) => Math.round(value * 1000)
const mb = (value: number) => Math.round(value * 1000 ** 2)
const gb = (value: number) => Math.round(value * 1000 ** 3)

const child = (
  label: string,
  scriptName: string,
  parent: string,
  pids: number[],
  bytesIn: number,
  bytesOut: number,
  command: string,
  running = true
): TrafficChild => ({
  key: `${label}@${parent}`,
  label,
  scriptName,
  parent,
  pids,
  running,
  bytesIn,
  bytesOut,
  command,
})

const group = (name: string, children: TrafficChild[]): TrafficGroup => ({
  name,
  bytesIn: children.reduce((sum, item) => sum + item.bytesIn, 0),
  bytesOut: children.reduce((sum, item) => sum + item.bytesOut, 0),
  children,
})

export const mockGroups: TrafficGroup[] = [
  group("node", [
    child(
      "node · next-server",
      "next-server",
      "node",
      [41230, 41231],
      mb(720),
      gb(1.48),
      "node /Users/peng.li/workspace/shadcn-ui/node_modules/.bin/next dev --turbopack"
    ),
    child(
      "node · vite.js",
      "vite.js",
      "npm",
      [39021],
      mb(120),
      mb(410),
      "node /Users/peng.li/workspace/freewind-mac-manager/node_modules/.bin/vite --host"
    ),
    child(
      "node · tsserver.js",
      "tsserver.js",
      "zed",
      [756, 757],
      mb(60),
      mb(220),
      "node --max-old-space-size=8092 /Users/peng.li/Library/Application Support/Zed/languages/vtsls/node_modules/typescript/lib/tsserver.js --serverMode partialSemantic"
    ),
    child(
      "node · storybook",
      "storybook",
      "npm",
      [28110],
      mb(18),
      mb(96),
      "node /usr/local/bin/storybook dev -p 6006",
      false
    ),
  ]),
  group("Google Chrome H", [
    child(
      "Google Chrome H",
      "Google Chrome H",
      "Google Chrome",
      [18322],
      gb(3.11),
      mb(124),
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper --type=renderer"
    ),
  ]),
  group("mDNSResponder", [
    child(
      "mDNSResponder",
      "mDNSResponder",
      "launchd",
      [225],
      gb(2.55),
      mb(233),
      "/usr/sbin/mDNSResponder"
    ),
  ]),
  group("LANDrop", [
    child(
      "LANDrop",
      "LANDrop",
      "launchd",
      [11742],
      mb(491),
      mb(480),
      "/Applications/LANDrop.app/Contents/MacOS/LANDrop"
    ),
  ]),
  group("verge-mihomo", [
    child(
      "verge-mihomo",
      "verge-mihomo",
      "clash-verge-service",
      [22505],
      gb(31.9),
      gb(129.0),
      "/Library/Application Support/clash-verge-service/cores/verge-mihomo -d /Users/peng.li/.config/clash-verge"
    ),
  ]),
  group("curl", [
    child(
      "curl",
      "curl",
      "bash",
      [47373],
      mb(18.0),
      kb(705),
      "curl -r 0-17999999 --limit-rate 200k https://mirrors.aliyun.com/ubuntu/ls-lR.gz",
      false
    ),
  ]),
]

export const mockStatus: TrafficStatus = {
  downloadRate: kb(262),
  uploadRate: kb(322),
  sampledAt: Date.now(),
  intervalSeconds: 5,
}

/** 默认忽略的代理进程：经代理的流量会同时记在它们的名下。 */
export const ignoredNames = ["verge-mihomo", "clash-verge", "clash", "mihomo"]
