import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { parse } from "smol-toml"
import { serializeFrpcToml } from "@shared/frp-format"
import type { FrpConfigInput } from "@shared/api-contract"

/**
 * frpc 配置文件的读写。
 *
 * 文本怎么解析、怎么序列化交给 @shared/frp-format；这里只负责文件本身，
 * 以及「写回时以磁盘原文档为底、保留未建模字段」这件事。
 */

export const readConfigText = async (file: string): Promise<string> => {
  if (!existsSync(file)) {
    throw new Error(`找不到 frpc 配置文件：${file}`)
  }
  return readFile(file, "utf8")
}

/** 原文解析失败时不给底稿，避免把读不懂的内容合并进新文件。 */
const parseOriginal = (text: string): Record<string, unknown> | undefined => {
  try {
    const document: unknown = parse(text)
    if (
      typeof document === "object" &&
      document !== null &&
      !Array.isArray(document)
    ) {
      return document as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 写回配置：只覆盖建模字段，原文档里的其它键原样保留。 */
export const writeConfigText = async (
  file: string,
  input: FrpConfigInput,
  original: string
): Promise<void> => {
  await writeFile(
    file,
    serializeFrpcToml(input, parseOriginal(original)),
    "utf8"
  )
}
