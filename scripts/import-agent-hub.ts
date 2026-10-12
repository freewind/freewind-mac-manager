import { readFileSync } from "node:fs"
import { importAgentHubData } from "@server/collaboration/import"
import { CollaborationStore } from "@server/collaboration/store"
import { DATABASE_FILE } from "@server/env"

/**
 * 把 freewind-agent-hub 的 data/db.json 导入 mac-manager 的统一数据库。
 *
 * 用法：
 *   pnpm tsx scripts/import-agent-hub.ts --source <db.json> [--target <sqlite>] [--yes]
 *
 * - --source：源 db.json 路径，必填；
 * - --target：目标库路径，缺省为项目数据库（env.DATABASE_FILE）；
 * - --yes：确认允许写入缺省的项目数据库，避免误动生产库。
 */

type Args = {
  source: string | null
  target: string | null
  yes: boolean
}

const USAGE = `用法：pnpm tsx scripts/import-agent-hub.ts --source <db.json> [--target <sqlite>] [--yes]

  --source <path>  必填，freewind-agent-hub 的 data/db.json
  --target <path>  可选，目标 SQLite；缺省为项目数据库（env.DATABASE_FILE）
  --yes            确认允许写入缺省的项目数据库`

const parseArgs = (argv: string[]): Args => {
  const args: Args = { source: null, target: null, yes: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--source") {
      args.source = argv[index + 1] ?? null
      index += 1
    } else if (token === "--target") {
      args.target = argv[index + 1] ?? null
      index += 1
    } else if (token === "--yes") {
      args.yes = true
    } else if (token === "--help" || token === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else if (!token.startsWith("--") && args.source === null) {
      args.source = token
    } else {
      throw new Error(`无法识别的参数：${token}`)
    }
  }
  return args
}

const main = (): void => {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(
      `[mac-manager] ${error instanceof Error ? error.message : "参数错误"}`
    )
    console.error(USAGE)
    process.exit(1)
  }

  if (!args.source) {
    console.error("[mac-manager] 缺少 --source（agent-hub 的 db.json 路径）")
    console.error(USAGE)
    process.exit(1)
  }

  // 缺省目标就是项目生产库：必须显式确认，避免默认就对它动手。
  const target = args.target ?? DATABASE_FILE
  if (!args.target && !args.yes) {
    console.error(
      `[mac-manager] 目标库缺省为项目数据库：${target}\n` +
        "如确实要写入它，请加 --yes；否则用 --target 指定别的库文件。"
    )
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(args.source, "utf8"))
  } catch (error) {
    console.error(
      `[mac-manager] 读取源文件失败：${
        error instanceof Error ? error.message : "未知错误"
      }`
    )
    process.exit(1)
  }

  const store = new CollaborationStore(target)
  try {
    const result = importAgentHubData(store, raw)
    console.log(`[mac-manager] 已从 ${args.source} 导入到 ${target}`)
    const line = (label: string, counts: typeof result.topics): void => {
      console.log(
        `  ${label}：新增 ${counts.inserted}，跳过 ${counts.skipped}，冲突 ${counts.conflicted}`
      )
    }
    line("Topic", result.topics)
    line("Thread", result.threads)
    line("Comment", result.comments)
    console.log(`  改 id 记录：${result.renames.length}`)
    for (const rename of result.renames) {
      console.log(
        `    改 id ${rename.kind} ${rename.originalId} → ${rename.newId}`
      )
    }
    for (const conflict of result.conflicts) {
      console.log(`  冲突 ${conflict.kind} ${conflict.id}：${conflict.reason}`)
    }
    const totals = store.counts()
    console.log(
      `  库内合计：Topic ${totals.topics}，Thread ${totals.threads}，Comment ${totals.comments}`
    )
  } catch (error) {
    console.error(
      `[mac-manager] 导入失败，未写入任何数据：${
        error instanceof Error ? error.message : "未知错误"
      }`
    )
    process.exitCode = 1
  } finally {
    store.close()
  }
}

main()
