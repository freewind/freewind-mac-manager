import { z } from "zod"

export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  configured: z.boolean(),
})

export const CsrfTokenSchema = z.object({ csrfToken: z.string() })
export const LoginBodySchema = z.object({
  password: z.string().min(1).max(1024),
})
export const AuthResultSchema = z.object({ authenticated: z.boolean() })
export const AuthErrorSchema = z.object({ message: z.string() })
