/**
 * 从命令行推导进程的可读标识。
 *
 * nettop 只给进程名，而一台机器上可能有上百个 `node`；这里找出命令行里真正执行的脚本，
 * 把标识细分成 `node · tsserver.js` 这样，便于区分是哪个脚本在消耗流量。
 */
const INTERPRETERS = new Set([
  "node",
  "nodejs",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
  "php",
  "ts-node",
  "tsx",
])

/** 这些文件名本身不具区分度，需要借上一层目录名。 */
const GENERIC_FILE_NAMES = new Set([
  "index.js",
  "main.js",
  "cli.js",
  "server.js",
  "app.js",
  "index.mjs",
  "main.mjs",
  "index.cjs",
  "main.cjs",
  "index.ts",
  "main.ts",
])

/** 这些目录名同样不具区分度，需要继续向上找。 */
const GENERIC_DIRECTORY_NAMES = new Set([
  "dist",
  "build",
  "out",
  "lib",
  "libs",
  "bin",
  "src",
  "esm",
  "cjs",
  "release",
  "binaries",
])

const MAX_DETAIL_LENGTH = 32

const baseName = (value: string): string => value.split("/").pop() ?? value

const tokens = (command: string): string[] =>
  command.split(/[\s\t]+/).filter((token) => token.length > 0)

export const processName = (command: string): string => baseName(tokens(command)[0] ?? "")

const scriptArgument = (command: string): string | null => {
  const parts = tokens(command)
  for (let index = 1; index < parts.length; index += 1) {
    const token = parts[index]!
    if (token.startsWith("-") || token.startsWith('"') || token.startsWith("'")) {
      continue
    }
    return token
  }
  return null
}

const distinguishingName = (scriptPath: string): string | null => {
  const file = baseName(scriptPath)
  if (!file) {
    return null
  }
  if (!GENERIC_FILE_NAMES.has(file.toLowerCase())) {
    return file
  }

  let directory = scriptPath.split("/").slice(0, -1).join("/")
  while (directory.length > 0) {
    const name = baseName(directory)
    if (!GENERIC_DIRECTORY_NAMES.has(name.toLowerCase())) {
      return name
    }
    directory = directory.split("/").slice(0, -1).join("/")
  }

  return file
}

const truncate = (value: string): string =>
  value.length > MAX_DETAIL_LENGTH
    ? `${value.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : value

/** 显示标识：解释器加脚本名，普通程序保持原名。 */
export const processLabel = (name: string, command: string): string => {
  if (!INTERPRETERS.has(name.toLowerCase())) {
    return name
  }

  // 有些进程会改写 argv[0]（如 Next.js 写成 `next-server (v16.3.8)`），
  // 这时首段的基名才是真正的身份。
  const argv0 = processName(command)
  if (argv0 && argv0.toLowerCase() !== name.toLowerCase()) {
    return `${name} · ${truncate(argv0)}`
  }

  const script = scriptArgument(command)
  const detail = script ? distinguishingName(script) : null
  return detail ? `${name} · ${truncate(detail)}` : name
}

/** 明细行只显示脚本部分：`node · vite.js` → `vite.js`。 */
export const scriptName = (label: string, name: string): string => {
  const parts = label.split(" · ")
  return parts.length > 1 ? parts.slice(1).join(" · ") : name
}
