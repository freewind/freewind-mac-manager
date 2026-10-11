import { contract } from "@shared/api-contract"
import { describeError } from "@shared/format"
import { initServer } from "@ts-rest/express"
import { collectHardwareOverview } from "./collect"

const s = initServer()

export const hardwareContract = {
  hardwareOverview: contract.hardwareOverview,
}

export const hardwareRouter = s.router(hardwareContract, {
  hardwareOverview: async () => {
    try {
      return { status: 200, body: await collectHardwareOverview() }
    } catch (error) {
      return { status: 500, body: { message: describeError(error) } }
    }
  },
})
