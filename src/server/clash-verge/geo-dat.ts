import { readVarint, skipField } from "./protobuf"

/** geoip.dat 里的一个分类：国家码、网段总数与前几条网段。 */
export type GeoipCategory = { code: string; count: number; preview: string[] }

/** 把连续的 0 组压成 ::，与常见写法一致。 */
const compressIpv6 = (groups: number[]): string => {
  let bestStart = -1
  let bestLength = 0
  let runStart = -1
  for (let index = 0; index < groups.length; index += 1) {
    if (groups[index] === 0) {
      if (runStart === -1) runStart = index
      const length = index - runStart + 1
      if (length > bestLength) {
        bestLength = length
        bestStart = runStart
      }
    } else {
      runStart = -1
    }
  }
  const hex = groups.map((group) => group.toString(16))
  if (bestLength < 2) return hex.join(":")
  const head = hex.slice(0, bestStart).join(":")
  const tail = hex.slice(bestStart + bestLength).join(":")
  return `${head}::${tail}`
}

/**
 * 把 4 或 16 字节的地址拼成文本再补前缀长度。
 * geoip.dat 与 mmdb 都只给出字节，页面要的是 1.2.3.0/24 这种写法。
 */
export const formatCidr = (bytes: Buffer, prefix: number): string => {
  if (bytes.length === 4) {
    return `${Array.from(bytes).join(".")}/${prefix}`
  }
  const groups: number[] = []
  for (let offset = 0; offset + 1 < 16; offset += 2) {
    groups.push((bytes.readUInt16BE(offset) ?? 0) as number)
  }
  return `${compressIpv6(groups)}/${prefix}`
}

/**
 * 解析 geoip.dat（v2ray data 格式的 protobuf，无第三方库）：
 * 顶层 repeated GeoIP（字段 1），内部 country_code = 1、repeated CIDR = 2；
 * CIDR 里 ip = 1（4 或 16 字节）、prefix = 2（varint）。
 * 只保留前 previewLimit 条网段文本：全量放在内存里没有用处，
 * 这里的文件有 100 多万条。
 */
export const parseGeoipDat = (
  buffer: Buffer,
  previewLimit: number
): GeoipCategory[] => {
  const categories: GeoipCategory[] = []
  let offset = 0
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset)
    offset = tag.next
    const field = tag.value >> 3
    const wire = tag.value & 7
    if (wire !== 2) {
      offset = skipField(buffer, offset, wire)
      if (offset > buffer.length) break
      continue
    }
    const length = readVarint(buffer, offset)
    offset = length.next
    const end = Math.min(offset + length.value, buffer.length)
    if (field !== 1) {
      offset = end
      continue
    }

    let code = ""
    let count = 0
    const preview: string[] = []
    while (offset < end) {
      const inner = readVarint(buffer, offset)
      offset = inner.next
      const innerField = inner.value >> 3
      const innerWire = inner.value & 7
      if (innerWire !== 2) {
        offset = skipField(buffer, offset, innerWire)
        if (offset > end) break
        continue
      }
      const innerLength = readVarint(buffer, offset)
      offset = innerLength.next
      const innerEnd = Math.min(offset + innerLength.value, end)
      if (innerField === 1) {
        code = buffer.toString("utf8", offset, innerEnd)
      } else if (innerField === 2) {
        let bytes: Buffer | null = null
        let prefix = 0
        let cursor = offset
        while (cursor < innerEnd) {
          const fieldTag = readVarint(buffer, cursor)
          cursor = fieldTag.next
          const kind = fieldTag.value >> 3
          const wireType = fieldTag.value & 7
          if (wireType === 0) {
            const number = readVarint(buffer, cursor)
            cursor = number.next
            if (kind === 2) prefix = number.value
          } else if (wireType === 2) {
            const size = readVarint(buffer, cursor)
            cursor = size.next
            const next = Math.min(cursor + size.value, innerEnd)
            if (kind === 1) bytes = buffer.subarray(cursor, next)
            cursor = next
          } else {
            cursor = skipField(buffer, cursor, wireType)
          }
        }
        if (bytes !== null && (bytes.length === 4 || bytes.length === 16)) {
          count += 1
          if (preview.length < previewLimit) {
            preview.push(formatCidr(bytes, prefix))
          }
        }
      }
      offset = innerEnd
    }
    if (code !== "") categories.push({ code, count, preview })
  }
  return categories
}
