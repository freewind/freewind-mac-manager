import { moveToTrash } from "../file-actions.ts"

export const trashEntry = async ({ query }: { query: { path: string } }) => {
  try {
    return {
      status: 202 as const,
      body: { message: await moveToTrash(query.path) },
    }
  } catch (error) {
    return {
      status: 400 as const,
      body: { message: error instanceof Error ? error.message : String(error) },
    }
  }
}
