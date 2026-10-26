import { formatCidr } from "./geo-dat"

/**
 * MaxMind DB（mmdb）的只读解析：Country.mmdb 与 ASN.mmdb 都是这个格式。
 * 不引第三方库 —— 页面要按网段全量浏览，而现成的 Node 库只提供单点查询，
 * 遍历仍然得自己走二叉搜索树。
 *
 * 文件布局：`[搜索树][16 字节分隔] [数据段][标记 + metadata]`。
 */

/** 文件末尾的 metadata 标记，向前最多找 128 KB。 */
const METADATA_MARKER = Buffer.from("\xab\xcd\xefMaxMind.com", "latin1")
const METADATA_WINDOW = 128 * 1024
/** 数据段前面固定 16 字节分隔。 */
const DATA_SECTION_SEPARATOR = 16

export type MmdbMeta = {
  databaseType: string
  /** 构建时间，秒级时间戳。 */
  buildTime: number
  nodeCount: number
  recordSize: number
  ipVersion: number
  languages: string[]
}

export type MmdbValue =
  | string
  | number
  | boolean
  | Buffer
  | MmdbValue[]
  | { [key: string]: MmdbValue }

type Context = { buffer: Buffer; dataStart: number }

/** 长度前缀里的 varint：29 / 30 / 31 分别扩展 1 / 2 / 3 个字节。 */
const readSize = (
  buffer: Buffer,
  start: number,
  size: number
): { size: number; next: number } => {
  if (size === 29) return { size: 29 + (buffer[start] ?? 0), next: start + 1 }
  if (size === 30) {
    return { size: 285 + buffer.readUInt16BE(start), next: start + 2 }
  }
  if (size === 31) {
    return { size: 65821 + buffer.readUIntBE(start, 3), next: start + 3 }
  }
  return { size, next: start }
}

/** 无符号大端整数：size 表示它占几个字节，0 表示值为 0。 */
const readUnsigned = (buffer: Buffer, start: number, size: number): number => {
  let value = 0
  for (let index = 0; index < size; index += 1) {
    value = value * 256 + (buffer[start + index] ?? 0)
  }
  return value
}

/** 有符号整数：同 readUnsigned，最高位为 1 时减掉 2 的位数次幂。 */
const readSigned = (buffer: Buffer, start: number, size: number): number => {
  const value = readUnsigned(buffer, start, size)
  const limit = 2 ** (size * 8)
  return value >= limit / 2 ? value - limit : value
}

/**
 * 解码一个数据项：返回它的值与下一个字节位置。
 * depth 防止指针自引用；mmdb 的正常嵌套不会超过几层。
 */
const decode = (
  context: Context,
  offset: number,
  depth: number
): { value: MmdbValue; next: number } => {
  const { buffer } = context
  if (depth > 32) return { value: "", next: offset }
  const ctrl = buffer[offset] ?? 0
  let cursor = offset + 1
  let type = ctrl >> 5
  if (type === 0) {
    type = (buffer[cursor] ?? 0) + 7
    cursor += 1
  }

  if (type === 1) {
    // 指针：3 位高位 + 1~4 个后续字节，值相对数据段起点。
    const pointerSize = ((ctrl >> 3) & 0x3) + 1
    let value = ctrl & 0x7
    for (let index = 0; index < pointerSize; index += 1) {
      value = value * 256 + (buffer[cursor] ?? 0)
      cursor += 1
    }
    const target = decode(context, context.dataStart + value, depth + 1)
    return { value: target.value, next: cursor }
  }

  const sized = readSize(buffer, cursor, ctrl & 0x1f)
  cursor = sized.next
  const size = sized.size

  if (type === 2) {
    const value = buffer.toString("utf8", cursor, cursor + size)
    return { value, next: cursor + size }
  }
  if (type === 3) {
    return { value: buffer.readDoubleBE(cursor), next: cursor + 8 }
  }
  if (type === 4) {
    return {
      value: buffer.subarray(cursor, cursor + size),
      next: cursor + size,
    }
  }
  if (type === 5) {
    return { value: readUnsigned(buffer, cursor, size), next: cursor + size }
  }
  if (type === 6) {
    return { value: readUnsigned(buffer, cursor, size), next: cursor + size }
  }
  if (type === 8) {
    return { value: readSigned(buffer, cursor, size), next: cursor + size }
  }
  if (type === 9) {
    return { value: readUnsigned(buffer, cursor, size), next: cursor + size }
  }
  if (type === 10) {
    return { value: Buffer.alloc(0), next: cursor + size }
  }
  if (type === 15) {
    return { value: buffer.readFloatBE(cursor), next: cursor + 4 }
  }
  if (type === 14) {
    // 布尔：值就在长度位里，不占数据字节。
    return { value: (ctrl & 0x1f) !== 0, next: cursor }
  }
  if (type === 7) {
    const map: { [key: string]: MmdbValue } = {}
    for (let index = 0; index < size; index += 1) {
      const key = decode(context, cursor, depth + 1)
      cursor = key.next
      const value = decode(context, cursor, depth + 1)
      cursor = value.next
      map[String(key.value)] = value.value
    }
    return { value: map, next: cursor }
  }
  if (type === 11) {
    const items: MmdbValue[] = []
    for (let index = 0; index < size; index += 1) {
      const item = decode(context, cursor, depth + 1)
      cursor = item.next
      items.push(item.value)
    }
    return { value: items, next: cursor }
  }
  // 未知类型按长度跳过，保证后面的项还能继续解。
  return { value: "", next: cursor + size }
}

/** 读文件末尾的 metadata；缺失说明不是 mmdb 文件。 */
export const readMmdbMeta = (buffer: Buffer): MmdbMeta => {
  const from = Math.max(0, buffer.length - METADATA_WINDOW)
  const marker = buffer.lastIndexOf(METADATA_MARKER, buffer.length)
  if (marker < from) throw new Error("不是 MaxMind DB 文件：缺少 metadata 标记")
  const start = marker + METADATA_MARKER.length
  const { value } = decode({ buffer, dataStart: start }, start, 0)
  const record = value as { [key: string]: MmdbValue }
  const number = (key: string): number =>
    typeof record[key] === "number" ? (record[key] as number) : 0
  const languages = Array.isArray(record.languages)
    ? (record.languages as MmdbValue[]).map(String)
    : []
  return {
    databaseType:
      typeof record.database_type === "string"
        ? (record.database_type as string)
        : "unknown",
    buildTime: number("build_epoch"),
    nodeCount: number("node_count"),
    recordSize: number("record_size"),
    ipVersion: number("ip_version"),
    languages,
  }
}

/** 数据段起点：搜索树 + 16 字节分隔。 */
const dataStartOf = (meta: MmdbMeta): number =>
  (meta.nodeCount * meta.recordSize * 2) / 8 + DATA_SECTION_SEPARATOR

/**
 * 读某个节点的第 bit 个记录：
 * 24 位是 3 字节一段；28 位是 4 字节里拆两段（第 4 字节是另一侧的高 4 位）；
 * 32 位直接是 4 字节。
 */
const readRecord = (
  buffer: Buffer,
  meta: MmdbMeta,
  node: number,
  bit: number
): number => {
  if (meta.recordSize === 24) {
    const offset = node * 6 + bit * 3
    return buffer.readUIntBE(offset, 3)
  }
  if (meta.recordSize === 28) {
    const offset = node * 7
    const middle = buffer[offset + 3] ?? 0
    return bit === 0
      ? (buffer.readUIntBE(offset, 3) << 4) | (middle >> 4)
      : (middle & 0x0f) * 0x1000000 + buffer.readUIntBE(offset + 4, 3)
  }
  const offset = node * 8 + bit * 4
  return buffer.readUInt32BE(offset)
}

/** 把走过的位拼成地址字节：不足整字节的部分按位补齐，前面缺的补 0。 */
const bitsToBytes = (bits: number[], byteLength: number): Buffer => {
  const bytes = Buffer.alloc(byteLength)
  bits.forEach((bit, index) => {
    if (bit === 1) bytes[Math.floor(index / 8)] |= 0x80 >> (index % 8)
  })
  return bytes
}

/** 从数据项里取一个字符串字段，路径用点号分隔，比如 country.iso_code。 */
export const pickString = (value: MmdbValue, path: string): string => {
  let current: MmdbValue | undefined = value
  for (const key of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    )
      return ""
    current = (current as { [key: string]: MmdbValue })[key]
  }
  return typeof current === "string" ? current : ""
}

/** 从数据项里取一个数字字段。 */
export const pickNumber = (value: MmdbValue, path: string): number | null => {
  let current: MmdbValue | undefined = value
  for (const key of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    )
      return null
    current = (current as { [key: string]: MmdbValue })[key]
  }
  return typeof current === "number" ? current : null
}

/**
 * 遍历全部网段：每条命中调用一次 onRecord，给出 CIDR 文本与数据。
 * IPv6 库里的 IPv4 数据挂在 0::/96 下，这里还原成 IPv4 写法。
 *
 * 同一数据项会被大量网段共用（Country 里相邻几十万条都指向同一个国家），
 * 按 offset 缓存解码结果，否则上百万次重复解码会让首次请求卡几十秒。
 */
export const walkMmdb = (
  buffer: Buffer,
  meta: MmdbMeta,
  onRecord: (cidr: string, data: MmdbValue) => void
): void => {
  const context: Context = { buffer, dataStart: dataStartOf(meta) }
  const totalBits = meta.ipVersion === 6 ? 128 : 32
  const path: number[] = []
  const cache = new Map<number, MmdbValue>()

  const dataAt = (offset: number): MmdbValue => {
    const cached = cache.get(offset)
    if (cached !== undefined) return cached
    const { value } = decode(context, context.dataStart + offset, 0)
    cache.set(offset, value)
    return value
  }

  const visit = (node: number, depth: number): void => {
    for (const bit of [0, 1]) {
      path.push(bit)
      const record = readRecord(buffer, meta, node, bit)
      if (record === meta.nodeCount) {
        // 空记录：这一段没有数据。
      } else if (record > meta.nodeCount) {
        const offset = record - meta.nodeCount - DATA_SECTION_SEPARATOR
        const value = dataAt(offset)
        const isIpv4 =
          meta.ipVersion === 6 &&
          path.length >= 96 &&
          path.slice(0, 96).every((item) => item === 0)
        if (isIpv4) {
          const hostBits = path.slice(96)
          onRecord(formatCidr(bitsToBytes(hostBits, 4), hostBits.length), value)
        } else {
          onRecord(formatCidr(bitsToBytes(path, 16), path.length), value)
        }
      } else if (depth + 1 < totalBits) {
        visit(record, depth + 1)
      }
      path.pop()
    }
  }

  visit(0, 0)
}
