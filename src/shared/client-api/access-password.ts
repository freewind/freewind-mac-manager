import { AUTH_COOKIE_NAME } from "@shared/auth"

/** 「记住密码」时 cookie 的有效期（年）；浏览器会把上限截断到 400 天左右。 */
const REMEMBER_YEARS = 10

/**
 * 从 document.cookie 读出访问密码，未登录返回 null。
 *
 * 密码可能含 `;` `=` `^` `!` 等字符，写入用 encodeURIComponent、读取必须用
 * decodeURIComponent 配对，否则会直接破坏 cookie 解析。
 * 非浏览器环境（Node 侧的测试）没有 document，按未登录处理。
 */
export const readAccessPasswordFromCookie = (): string | null => {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]*)`)
  )
  const raw = match?.[1]
  if (raw === undefined) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 普通请求（fetch / XHR）统一带上 Authorization，不依赖 cookie 自动携带；
 * 浏览器原生请求（下载、`<img>`）无法自设 header，才靠 cookie 自动携带。
 */
export const buildAuthorizationHeader = (): Record<string, string> => {
  const password = readAccessPasswordFromCookie()
  return password === null ? {} : { Authorization: `Bearer ${password}` }
}

/**
 * 登录成功后写入密码 cookie。非 HttpOnly：前端要读它来填 Authorization 请求头。
 * remember=false 时不写 expires，落成会话 cookie（关掉浏览器即失效）。
 */
export const writeAccessPasswordCookie = (
  password: string,
  remember: boolean
): void => {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(password)}`,
    "path=/",
    "SameSite=Strict",
  ]
  if (remember) {
    const expires = new Date()
    expires.setFullYear(expires.getFullYear() + REMEMBER_YEARS)
    parts.push(`expires=${expires.toUTCString()}`)
  }
  document.cookie = parts.join(";")
}

/**
 * 退出登录：清掉密码 cookie。
 * 属性必须与写入时一致（path / SameSite），否则部分浏览器不覆盖既有 cookie；
 * Max-Age=0 即删除。
 */
export const clearAccessPasswordCookie = (): void => {
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; SameSite=Strict; Max-Age=0`
}
