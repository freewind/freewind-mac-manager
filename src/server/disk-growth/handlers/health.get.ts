export const getHealth = async () => ({
  status: 200 as const,
  body: { ok: true },
})
