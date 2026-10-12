/** 去掉终端鼠标/粘贴模式误灌进输入框的转义序列 */
export function sanitizeInputText(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: 有意用控制字符匹配并清除终端转义序列
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: 有意用控制字符匹配并清除终端转义序列
      .replace(/\x1b\[<[0-9;]*[a-zA-Z]/g, "")
      .replace(/\[[0-9;]*[Mm](?![a-zA-Z])/g, "")
      .replace(/\[\d+~/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: 有意用控制字符匹配并清除终端转义序列
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
  )
}
