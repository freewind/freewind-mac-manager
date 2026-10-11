import { z } from "zod"

export const ClashVergeAvailabilitySchema = z.object({
  state: z.enum(["available", "unavailable", "unauthorized", "not_configured"]),
  message: z.string().nullable(),
})

export const ClashVergeStatusSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  core: z.object({
    version: z.string().nullable(),
    meta: z.boolean().nullable(),
  }),
  config: z.object({
    mode: z.string().nullable(),
    tunEnabled: z.boolean().nullable(),
  }),
  traffic: z.object({
    uploadRate: z.number().nonnegative().nullable(),
    downloadRate: z.number().nonnegative().nullable(),
    uploadTotal: z.number().nonnegative().nullable(),
    downloadTotal: z.number().nonnegative().nullable(),
  }),
  sections: z.object({
    core: ClashVergeAvailabilitySchema,
    config: ClashVergeAvailabilitySchema,
    traffic: ClashVergeAvailabilitySchema,
  }),
})

export const ClashVergeProxySchema = z.object({
  name: z.string(),
  type: z.string(),
  alive: z.boolean().nullable(),
  selected: z.string().nullable(),
  members: z.array(z.string()).max(1000),
  delays: z
    .array(
      z.object({
        time: z.string(),
        delay: z.number().nonnegative(),
      })
    )
    .max(32),
})

export const ClashVergeProxiesResponseSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  proxies: z.array(ClashVergeProxySchema).max(2000),
})

export const ClashVergeConnectionSchema = z.object({
  id: z.string(),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  network: z.string().nullable(),
  process: z.string().nullable(),
  upload: z.number().nonnegative(),
  download: z.number().nonnegative(),
  startedAt: z.string(),
  chains: z.array(z.string()).max(32),
  rule: z.string().nullable(),
  rulePayload: z.string().nullable(),
})

export const ClashVergeConnectionsResponseSchema = z.object({
  sampledAt: z.number().int(),
  availability: ClashVergeAvailabilitySchema,
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  connections: z.array(ClashVergeConnectionSchema).max(200),
})
