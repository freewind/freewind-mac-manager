import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { authRoutes } from "@shared/api-contract/routes/auth"
import { API_BASE } from "@shared/api-path"
import { initServer } from "@ts-rest/express"
import type { NextFunction, Request, Response } from "express"

const s = initServer()
const SESSION_COOKIE = "mac_manager_session"
const CSRF_COOKIE = "mac_manager_csrf"
const SESSION_TTL_SECONDS = 60 * 60 * 12
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 5
const deriveKey = promisify(scrypt)

type Session = { expiresAt: number }
type AttemptState = { count: number; resetAt: number }

const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {}
  for (const item of header?.split(";") ?? []) {
    const index = item.indexOf("=")
    if (index <= 0) continue
    const key = item.slice(0, index).trim()
    try {
      cookies[key] = decodeURIComponent(item.slice(index + 1).trim())
    } catch {}
  }
  return cookies
}

const serializeCookie = (
  name: string,
  value: string,
  options: { httpOnly?: boolean; maxAge?: number }
): string => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  const httpOnly = options.httpOnly ? "; HttpOnly" : ""
  const maxAge =
    options.maxAge === undefined ? "" : `; Max-Age=${options.maxAge}`
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict${httpOnly}${maxAge}${secure}`
}

const appendCookie = (response: Response, cookie: string): void => {
  response.append("Set-Cookie", cookie)
}

const createToken = (): string => randomBytes(32).toString("hex")

export const createAuthManager = () => {
  const configuredPassword = process.env.MAC_MANAGER_PASSWORD ?? ""
  const passwordSalt = randomBytes(16)
  const passwordHash = configuredPassword
    ? scryptSync(configuredPassword, passwordSalt, 32)
    : null
  const sessions = new Map<string, Session>()
  const attempts = new Map<string, AttemptState>()

  const getCookies = (request: Request) => parseCookies(request.headers.cookie)

  const getSession = (request: Request): Session | null => {
    const token = getCookies(request)[SESSION_COOKIE]
    if (!token) return null
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token)
      return null
    }
    return session
  }

  const issueCsrf = (request: Request, response: Response): string => {
    const current = getCookies(request)[CSRF_COOKIE]
    if (current) return current
    const token = createToken()
    appendCookie(
      response,
      serializeCookie(CSRF_COOKIE, token, { maxAge: SESSION_TTL_SECONDS })
    )
    return token
  }

  const clearAuth = (request: Request, response: Response): void => {
    const sessionToken = getCookies(request)[SESSION_COOKIE]
    if (sessionToken) sessions.delete(sessionToken)
    appendCookie(
      response,
      serializeCookie(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0 })
    )
    appendCookie(response, serializeCookie(CSRF_COOKIE, "", { maxAge: 0 }))
  }

  const csrfIsValid = (request: Request): boolean => {
    const cookies = getCookies(request)
    const header = request.get("x-csrf-token")
    return Boolean(
      header && cookies[CSRF_COOKIE] && header === cookies[CSRF_COOKIE]
    )
  }

  const clientKey = (request: Request): string => request.ip || "unknown"

  const getRateLimit = (request: Request): AttemptState | null => {
    const key = clientKey(request)
    const state = attempts.get(key)
    if (!state) return null
    if (state.resetAt <= Date.now()) {
      attempts.delete(key)
      return null
    }
    return state.count >= RATE_LIMIT_MAX_ATTEMPTS ? state : null
  }

  const recordFailedAttempt = (request: Request): void => {
    const key = clientKey(request)
    const now = Date.now()
    const current = attempts.get(key)
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
      return
    }
    current.count += 1
  }

  const passwordMatches = async (password: string): Promise<boolean> => {
    if (!passwordHash) return false
    const candidate = (await deriveKey(password, passwordSalt, 32)) as Buffer
    return timingSafeEqual(candidate, passwordHash)
  }

  const login = async (
    request: Request,
    response: Response,
    password: string
  ): Promise<boolean> => {
    if (!configuredPassword || getRateLimit(request)) {
      recordFailedAttempt(request)
      return false
    }
    if (!(await passwordMatches(password))) {
      recordFailedAttempt(request)
      return false
    }
    attempts.delete(clientKey(request))
    const token = createToken()
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 })
    appendCookie(
      response,
      serializeCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
      })
    )
    return true
  }

  const middleware = (
    request: Request,
    response: Response,
    next: NextFunction
  ): void => {
    if (
      request.path === `${API_BASE}/health` ||
      request.path.startsWith(`${API_BASE}/auth/`) ||
      request.method === "OPTIONS"
    ) {
      next()
      return
    }
    if (!getSession(request)) {
      response.status(401).json({ message: "需要登录" })
      return
    }
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      !csrfIsValid(request)
    ) {
      response.status(403).json({ message: "CSRF 校验失败" })
      return
    }
    next()
  }

  return {
    getSession,
    issueCsrf,
    clearAuth,
    csrfIsValid,
    getRateLimit,
    login,
    middleware,
  }
}

export const createAuthRouter = (manager: AuthManager) =>
  s.router(authRoutes, {
    getAuthCsrf: async ({ req, res }) => ({
      status: 200 as const,
      body: { csrfToken: manager.issueCsrf(req, res) },
    }),
    getAuthStatus: async ({ req }) => ({
      status: 200 as const,
      body: {
        authenticated: manager.getSession(req) !== null,
        configured: Boolean(process.env.MAC_MANAGER_PASSWORD),
      },
    }),
    login: async ({ body, req, res }) => {
      if (!manager.csrfIsValid(req)) {
        return { status: 403 as const, body: { message: "CSRF 校验失败" } }
      }
      if (manager.getRateLimit(req)) {
        return {
          status: 429 as const,
          body: { message: "登录尝试过于频繁，请稍后再试" },
        }
      }
      if (!(await manager.login(req, res, body.password))) {
        return {
          status: 401 as const,
          body: { message: "密码错误或服务尚未配置密码" },
        }
      }
      return { status: 200 as const, body: { authenticated: true } }
    },
    logout: async ({ req, res }) => {
      if (!manager.csrfIsValid(req)) {
        return { status: 403 as const, body: { message: "CSRF 校验失败" } }
      }
      manager.clearAuth(req, res)
      return { status: 200 as const, body: { authenticated: false } }
    },
  })

export type AuthManager = ReturnType<typeof createAuthManager>
export type AuthRequest = Request
export type AuthResponse = Response
