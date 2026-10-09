import { z } from "zod"

export const HealthSchema = z.object({ ok: z.boolean() })
