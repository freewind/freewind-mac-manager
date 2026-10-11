import { publicSystemError } from "@server/common/public-error"
import { contract } from "@shared/api-contract"
import { initServer } from "@ts-rest/express"
import {
  addPiProvider,
  deletePiProvider,
  getPiSettings,
  listPiModels,
  savePiSettings,
  updatePiProvider,
} from "./config"

const s = initServer()

export const piContract = {
  listPiModels: contract.listPiModels,
  addPiProvider: contract.addPiProvider,
  updatePiProvider: contract.updatePiProvider,
  deletePiProvider: contract.deletePiProvider,
  getPiSettings: contract.getPiSettings,
  savePiSettings: contract.savePiSettings,
}

export const piRouter = s.router(piContract, {
  listPiModels: async () => {
    try {
      return { status: 200 as const, body: await listPiModels() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  addPiProvider: async ({ body }) => {
    try {
      return { status: 201 as const, body: await addPiProvider(body) }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  updatePiProvider: async ({ params, body }) => {
    try {
      return {
        status: 200 as const,
        body: await updatePiProvider(params.providerId, body),
      }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  getPiSettings: async () => {
    try {
      return { status: 200 as const, body: await getPiSettings() }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  savePiSettings: async ({ body }) => {
    try {
      return { status: 200 as const, body: await savePiSettings(body) }
    } catch (error) {
      return publicSystemError(error)
    }
  },
  deletePiProvider: async ({ params, body }) => {
    try {
      await deletePiProvider(params.providerId, body)
      return { status: 204 as const, body: null }
    } catch (error) {
      return publicSystemError(error)
    }
  },
})
