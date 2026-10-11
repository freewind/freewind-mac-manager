import { timingSafeEqual } from "node:crypto"
import { contract } from "@shared/api-contract"
import { API_BASE } from "@shared/api-path"
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { initServer } from "@ts-rest/express"
import type { NextFunction, Request, Response } from "express"
import { getAuthPassword, isAuthConfigured } from "./env"

/**
 * 访问密码认证：无状态，不保存会话。
 *
 * - 密码的唯一来源仍是 .env 的 MAC_MANAGER_PASSWORD（见 env.ts）；每次请求直接核对。
 * - 凭据双来源：Authorization: Bearer（普通请求）+ cookie（浏览器原生请求如
 *   下载、<img> 无法自设 header，只能靠它自动携带）；禁用 query 参数取 token，
 *   因为 URL 会进访问日志、浏览器历史与 Referer。
 * - 认证只拦 /api；页面与静态资源全部交给 SPA —— 登录界面是前端组件。
 * - 认证中间件只做核对，不再维护进程内 session，所以 dev 热重载不会让用户被动登出。
 */

const s = initServer()

/** 免鉴权端点：登录页自身要用。 */
const AUTH_EXEMPT_PATHS = new Set([
  `${API_BASE}/auth/status`,
  `${API_BASE}/auth/login`,
])

/* ---------- 限流：按 IP 的内存计数，中间件与登录端点共用同一份状态 ---------- */

const MAX_FAILURES = 5
const LOCK_MS = 60_000
type RateLimitEntry = { failures: number; lockUntil: number }
const rateLimits = new Map<string, RateLimitEntry>()

/** 剩余锁定秒数；0 表示未锁定（此时条目仍保留失败计数）。 */
const lockRemainingSecs = (ip: string): number => {
  const entry = rateLimits.get(ip)
  if (!entry) return 0
  const remaining = entry.lockUntil - Date.now()
  // 只在「曾锁定且已过期」时删条目；未锁定条目要保留失败计数。
  if (entry.lockUntil > 0 && remaining <= 0) {
    rateLimits.delete(ip)
    return 0
  }
  return entry.lockUntil > 0 ? Math.ceil(remaining / 1000) : 0
}

const recordFailure = (ip: string): void => {
  const now = Date.now()
  let entry = rateLimits.get(ip)
  // 锁定期间再失败：不重置计数、不延长锁。
  if (entry && entry.lockUntil > now) return
  // 上一轮锁已过期：这算新一轮的第一次失败。
  if (entry && entry.lockUntil > 0 && entry.lockUntil <= now) {
    entry = { failures: 0, lockUntil: 0 }
  }
  const failures = (entry?.failures ?? 0) + 1
  rateLimits.set(ip, {
    failures,
    lockUntil: failures >= MAX_FAILURES ? now + LOCK_MS : 0,
  })
}

const recordSuccess = (ip: string): void => {
  rateLimits.delete(ip)
}

/* ---------- 凭据与地址 ---------- */

/** Authorization: Bearer 优先，其次 cookie。 */
const extractPassword = (request: Request): string | null => {
  const authorization = request.headers.authorization
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length)
  }
  for (const part of request.headers.cookie?.split(";") ?? []) {
    const index = part.indexOf("=")
    if (index > 0 && part.slice(0, index).trim() === AUTH_COOKIE_NAME) {
      const raw = part.slice(index + 1).trim()
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

/**
 * 本机直连部署取 TCP 对端地址，不信任可伪造的 X-Forwarded-For；
 * IPv6 映射地址要剥掉 ::ffff: 前缀才能与 IPv4 归一。
 */
const getClientIp = (request: Request): string => {
  const raw = request.socket?.remoteAddress ?? ""
  return raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw
}

/** 先比长度再用 timingSafeEqual：长度不同时直接返回，避免比较抛错。 */
const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const tooManyAttempts = (seconds: number) => ({
  message: `尝试过于频繁，请 ${seconds} 秒后重试`,
})

export const createAuthManager = () => {
  const middleware = (
    request: Request,
    response: Response,
    next: NextFunction
  ): void => {
    const path = request.path
    const isApi = path === API_BASE || path.startsWith(`${API_BASE}/`)
    // 非 API（页面、静态资源）交给 SPA；登录端点自身免鉴权。
    if (!isApi || AUTH_EXEMPT_PATHS.has(path)) {
      next()
      return
    }

    const password = getAuthPassword()
    // 未配置密码时 fail-closed：接口一律拒绝，不因为“本机”而放行。
    if (!password) {
      response.status(401).json({ message: "服务尚未配置访问密码" })
      return
    }

    const ip = getClientIp(request)
    const lockedSecs = lockRemainingSecs(ip)
    if (lockedSecs > 0) {
      response.setHeader("Retry-After", String(lockedSecs))
      response.status(429).json(tooManyAttempts(lockedSecs))
      return
    }

    const credential = extractPassword(request)
    if (!credential) {
      response.status(401).json({ message: "需要访问密码" })
      return
    }

    if (!safeEqual(credential, password)) {
      recordFailure(ip)
      const afterFailureSecs = lockRemainingSecs(ip)
      if (afterFailureSecs > 0) {
        response.setHeader("Retry-After", String(afterFailureSecs))
        response.status(429).json(tooManyAttempts(afterFailureSecs))
        return
      }
      response.status(401).json({ message: "密码错误" })
      return
    }

    recordSuccess(ip)
    next()
  }

  return { middleware }
}

/**
 * 取共享 contract 里已带 /api 前缀的本域路由。express 挂载与客户端必须同源，
 * 直接用 routes/auth.ts 的裸路径会注册到 /auth/*，与前端请求的 /api/auth/* 不一致。
 */
export const authContract = {
  getAuthStatus: contract.getAuthStatus,
  login: contract.login,
}

/**
 * 认证已无状态：router 不依赖实例。参数保留，让 app.ts 的
 * `createAuthRouter(auth)` 调用形态不变。
 */
export const createAuthRouter = (_manager: AuthManager) =>
  s.router(authContract, {
    getAuthStatus: async ({ req }) => {
      const configured = isAuthConfigured()
      if (!configured) {
        return {
          status: 200 as const,
          body: { authenticated: false, configured: false },
        }
      }
      const credential = extractPassword(req)
      return {
        status: 200 as const,
        body: {
          authenticated:
            credential !== null && safeEqual(credential, getAuthPassword()),
          configured: true,
        },
      }
    },
    login: async ({ body, req, res }) => {
      const password = getAuthPassword()
      const ip = getClientIp(req)
      const lockedSecs = lockRemainingSecs(ip)
      if (lockedSecs > 0) {
        res.setHeader("Retry-After", String(lockedSecs))
        return { status: 429 as const, body: tooManyAttempts(lockedSecs) }
      }
      // 密码错误与未配置密码返回同一文案，不对外区分原因。
      if (!password || !safeEqual(body.password, password)) {
        recordFailure(ip)
        const afterFailureSecs = lockRemainingSecs(ip)
        if (afterFailureSecs > 0) {
          res.setHeader("Retry-After", String(afterFailureSecs))
          return {
            status: 429 as const,
            body: tooManyAttempts(afterFailureSecs),
          }
        }
        return {
          status: 401 as const,
          body: { message: "密码错误或服务尚未配置密码" },
        }
      }
      recordSuccess(ip)
      return { status: 200 as const, body: { authenticated: true as const } }
    },
  })

export type AuthManager = ReturnType<typeof createAuthManager>
