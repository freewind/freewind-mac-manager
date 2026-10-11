import { describe, expect, it } from "vitest"
import { createDockerService, type DockerServiceCli } from "./service"

const cliWith = (overrides: Partial<DockerServiceCli>): DockerServiceCli =>
  ({
    getColimaStatus: async () => ({
      installed: true,
      running: true,
      status: "colima 运行中",
      runtime: null,
      arch: null,
      cpus: null,
      memoryBytes: null,
      diskBytes: null,
      checkedAt: 1,
    }),
    getInfo: async () => ({
      serverVersion: "29.5.2",
      containersTotal: 0,
      containersRunning: 0,
      containersPaused: 0,
      containersStopped: 0,
      imagesTotal: 0,
    }),
    getDiskUsage: async () => new Map(),
    listContainers: async () => [],
    listImages: async () => [],
    listVolumes: async () => [],
    listNetworks: async () => [],
    getContainerLogs: async (containerId) => ({
      containerId,
      lines: [],
      truncated: false,
      fetchedAt: 1,
    }),
    inspectContainer: async () => null,
    imageExists: async () => false,
    ...overrides,
  }) as DockerServiceCli

const network = (name: string) => ({
  id: `id-${name}`,
  name,
  driver: "bridge",
  scope: "local",
  internal: false,
  containers: 0,
})

describe("网络列表的内置网络标记", () => {
  it("bridge/host/none 标记 builtin，其余不标记", async () => {
    const service = createDockerService(
      cliWith({
        listNetworks: async () => [
          network("bridge"),
          network("host"),
          network("none"),
          network("litellm_default"),
        ],
      })
    )
    const result = await service.listNetworks()
    expect(result.networks.map((item) => [item.name, item.builtin])).toEqual([
      ["bridge", true],
      ["host", true],
      ["none", true],
      ["litellm_default", false],
    ])
  })
})
