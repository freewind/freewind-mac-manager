/**
 * protobuf 的最小读取工具：geosite.dat 与 geoip.dat 都是 v2ray 的
 * protobuf 格式，只需要 varint 与「跳过一段」这两件事，不引第三方库。
 */
export type Varint = { value: number; next: number }

/** 读一个 varint：返回数值与下一个字节位置。 */
export const readVarint = (buffer: Buffer, start: number): Varint => {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset] ?? 0
    offset += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, next: offset }
}

/** 跳过当前字段：varint / 64 位 / 长度前缀 / 32 位，返回字段之后的位置。 */
export const skipField = (
  buffer: Buffer,
  start: number,
  wire: number
): number => {
  if (wire === 0) return readVarint(buffer, start).next
  if (wire === 1) return start + 8
  if (wire === 5) return start + 4
  if (wire === 2) {
    const length = readVarint(buffer, start)
    return length.next + length.value
  }
  return buffer.length
}
