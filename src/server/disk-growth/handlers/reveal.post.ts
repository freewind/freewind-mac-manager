import { revealInFinder } from "../file-actions.ts"

export const revealEntry = async ({ body }: { body: { path: string } }) => {
  try {
    return {
      status: 202 as const,
      body: { message: await revealInFinder(body.path) },
    }
  } catch (error) {
    return { status: 400 as const, body: { message: toMessage(error) } }
  }
}

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
