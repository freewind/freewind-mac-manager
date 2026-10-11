import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  type CommandOutput,
  createDockerCli,
  createLineSplitter,
  createPullProgressTracker,
  type DockerCache,
  type DockerCli,
  DockerCommandError,
  type DockerCommandRunner,
  parseColimaStatus,
  parseContainerIds,
  parseDockerSize,
  parseDockerTime,
  parseImages,
  parseInfo,
  parseInspectedContainers,
  parseInspectMounts,
  parseInspectPorts,
  parseJsonLines,
  parseNetworks,
  parsePsSummaries,
  parseRfc3339Time,
  parseVersion,
  parseVolumeSizes,
} from "./cli"

/** 记录调用参数的受控替身：不真的执行任何命令。 */
const createFakeRunner = (
  handler: (command: string, args: string[]) => Promise<CommandOutput>
) => {
  const calls: { command: string; args: string[] }[] = []
  const timeouts: number[] = []
  const runner: DockerCommandRunner = (command, args, options) => {
    calls.push({ command, args })
    timeouts.push(options.timeoutMs)
    return handler(command, args)
  }
  return { runner, calls, timeouts }
}

const succeed =
  (stdout: string, stderr = "") =>
  async (): Promise<CommandOutput> => ({ stdout, stderr })

/** 不做缓存的替身，保证每个用例看到的是自己那份输出。 */
const noCache: DockerCache = (_key, _ttl, load) => load()

const errorOf = async (task: Promise<unknown>): Promise<unknown> =>
  task.then(
    () => null,
    (error: unknown) => error
  )

const CONTAINER_ID =
  "3a2352da7b309beaaba360ac0799380b586ab098cc7ee70d90d92dfc4ca06f53"
const SHORT_ID = "3a2352da7b30"
const STARTED_AT = "2026-10-11T07:25:40.887230468Z"

/** 真机 inspect 的形状：只保留我们解析用到的字段。 */
const inspectFixture = JSON.stringify([
  {
    Id: CONTAINER_ID,
    Created: "2026-10-11T07:25:40.57465826Z",
    Path: "opendecider",
    Args: ["serve"],
    State: {
      Status: "running",
      StartedAt: STARTED_AT,
      FinishedAt: "0001-01-01T00:00:00Z",
    },
    Name: "/opendecider",
    Config: { Image: "opendecider:cpu", Cmd: ["opendecider", "serve"] },
    Mounts: [
      {
        Type: "volume",
        Name: "opendecider-models",
        Source: "/var/lib/docker/volumes/opendecider-models/_data",
        Destination: "/models",
        RW: true,
      },
    ],
    NetworkSettings: {
      Ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "48000" }] },
    },
  },
])

const psFixture = JSON.stringify({
  Command: '"opendecider serve"',
  CreatedAt: "2026-10-11 15:25:40 +0800 CST",
  HealthStatus: "healthy",
  ID: SHORT_ID,
  Image: "opendecider:cpu",
  LocalVolumes: "1",
  Mounts: "opendecider-mo…",
  Names: "opendecider",
  Networks: "bridge",
  Ports: "127.0.0.1:48000->8000/tcp",
  State: "running",
  Status: "Up 34 minutes (healthy)",
})

describe("docker 输出解析", () => {
  it("按行解析 docker 的 json 输出，坏行跳过", () => {
    const text = '{"ID":"a"}\n\nnot json\n{"ID":"b"}\n["array"]\n'
    expect(parseJsonLines(text)).toMatchInlineSnapshot(`
      [
        {
          "ID": "a",
        },
        {
          "ID": "b",
        },
      ]
    `)
  })

  it("ps -aq 只接受十六进制 id", () => {
    expect(
      parseContainerIds(`\n${SHORT_ID}\n${CONTAINER_ID}\nnot-an-id\n`)
    ).toMatchInlineSnapshot(`
        [
          "3a2352da7b30",
          "3a2352da7b309beaaba360ac0799380b586ab098cc7ee70d90d92dfc4ca06f53",
        ]
      `)
  })

  it("ps 的 json 只取 Status 文本与名称", () => {
    expect(parsePsSummaries(`${psFixture}\n`)).toMatchInlineSnapshot(`
      [
        {
          "id": "3a2352da7b30",
          "name": "opendecider",
          "status": "Up 34 minutes (healthy)",
        },
      ]
    `)
  })

  it("inspect 提供挂载、端口与启动时间", () => {
    const [container] = parseInspectedContainers(inspectFixture)
    expect(container).toMatchObject({
      id: CONTAINER_ID,
      name: "opendecider",
      image: "opendecider:cpu",
      command: "opendecider serve",
      state: "running",
      createdAt: Date.parse("2026-10-11T07:25:40.57465826Z"),
      startedAt: Date.parse(STARTED_AT),
    })
    // 挂载路径必须完整，不能是 ps 那种被截断的省略号
    expect(container?.mounts).toEqual([
      {
        type: "volume",
        source: "/var/lib/docker/volumes/opendecider-models/_data",
        destination: "/models",
        readOnly: false,
      },
    ])
    expect(container?.ports).toEqual([
      {
        hostIp: "127.0.0.1",
        hostPort: 48000,
        containerPort: 8000,
        protocol: "tcp",
      },
    ])
  })

  it("inspect 的 Mounts 按 RW 判定只读，坏项跳过", () => {
    expect(
      parseInspectMounts([
        { Type: "bind", Source: "/Users/me/x", Destination: "/app", RW: false },
        { Type: "tmpfs", Source: "", Destination: "/tmp", RW: true },
        { Type: "weird", Source: "/a", Destination: "/b", RW: true },
        { Type: "volume", Source: "/v", Destination: "", RW: true },
      ])
    ).toMatchInlineSnapshot(`
      [
        {
          "destination": "/app",
          "readOnly": true,
          "source": "/Users/me/x",
          "type": "bind",
        },
        {
          "destination": "/tmp",
          "readOnly": false,
          "source": "",
          "type": "tmpfs",
        },
      ]
    `)
  })

  it("inspect 端口只取已发布的绑定", () => {
    expect(
      parseInspectPorts({
        "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "48000" }],
        "5432/tcp": null,
        "9000/udp": [
          { HostIp: "0.0.0.0", HostPort: "9000" },
          { HostIp: "", HostPort: "" },
        ],
      })
    ).toMatchInlineSnapshot(`
      [
        {
          "containerPort": 8000,
          "hostIp": "127.0.0.1",
          "hostPort": 48000,
          "protocol": "tcp",
        },
        {
          "containerPort": 9000,
          "hostIp": "0.0.0.0",
          "hostPort": 9000,
          "protocol": "udp",
        },
        {
          "containerPort": 9000,
          "hostIp": "",
          "hostPort": null,
          "protocol": "udp",
        },
      ]
    `)
    expect(parseInspectPorts(null)).toEqual([])
  })

  it("未启动容器的 StartedAt 零值映射为 null", () => {
    const stopped = JSON.stringify([
      {
        Id: CONTAINER_ID,
        Created: "2026-10-01T01:02:03Z",
        State: { Status: "exited", StartedAt: "0001-01-01T00:00:00Z" },
        Name: "/job",
        Config: { Image: "alpine" },
        Mounts: [],
      },
    ])
    const [container] = parseInspectedContainers(stopped)
    expect(container?.startedAt).toBeNull()
    expect(container?.state).toBe("exited")
    expect(container?.createdAt).toBe(Date.parse("2026-10-01T01:02:03Z"))
    // 零值不能被当成时间戳
    expect(parseRfc3339Time("0001-01-01T00:00:00Z")).toBeNull()
    expect(parseRfc3339Time("")).toBeNull()
    expect(parseRfc3339Time("garbage")).toBeNull()
  })

  it("未知 State 归为 exited，不产生契约外的取值", () => {
    const [container] = parseInspectedContainers(
      JSON.stringify([{ Id: CONTAINER_ID, State: { Status: "weird" } }])
    )
    expect(container?.state).toBe("exited")
  })

  it("解析镜像行，N/A 字段按 0 处理", () => {
    const lines = [
      JSON.stringify({
        ID: "sha256:abc",
        Repository: "nginx",
        Tag: "latest",
        Size: "187MB",
        CreatedAt: "2024-05-01 10:00:00 +0800 CST",
        Containers: "N/A",
      }),
      JSON.stringify({
        ID: "sha256:def",
        Repository: "redis",
        Tag: "<none>",
        Size: "1.5GiB",
        CreatedAt: "2024-05-01 10:00:00 +0800 CST",
        Containers: "3",
      }),
    ].join("\n")
    expect(parseImages(lines)).toMatchInlineSnapshot(`
      [
        {
          "containers": 0,
          "createdAt": 1714528800000,
          "id": "sha256:abc",
          "repository": "nginx",
          "sizeBytes": 187000000,
          "tag": "latest",
        },
        {
          "containers": 3,
          "createdAt": 1714528800000,
          "id": "sha256:def",
          "repository": "redis",
          "sizeBytes": 1610612736,
          "tag": "<none>",
        },
      ]
    `)
  })

  it("解析网络行，接入数先置 0", () => {
    const line = JSON.stringify({
      ID: "net1",
      Name: "bridge",
      Driver: "bridge",
      Scope: "local",
      Internal: "true",
    })
    expect(parseNetworks(line)).toMatchInlineSnapshot(`
      [
        {
          "containers": 0,
          "driver": "bridge",
          "id": "net1",
          "internal": true,
          "name": "bridge",
          "scope": "local",
        },
      ]
    `)
  })

  it("解析 info 与 version", () => {
    const info = parseInfo(
      JSON.stringify({
        ServerVersion: "27.0.3",
        Containers: 4,
        ContainersRunning: 2,
        ContainersPaused: 0,
        ContainersStopped: 2,
        Images: 7,
      })
    )
    expect(info).toMatchInlineSnapshot(`
      {
        "containersPaused": 0,
        "containersRunning": 2,
        "containersStopped": 2,
        "containersTotal": 4,
        "imagesTotal": 7,
        "serverVersion": "27.0.3",
      }
    `)
    expect(
      parseVersion(JSON.stringify({ Server: { Version: "27.0.3" } }))
    ).toBe("27.0.3")
    expect(
      parseVersion(JSON.stringify({ Client: { Version: "27.0.1" } }))
    ).toBe("27.0.1")
    // 非 JSON 输出不应抛裸异常
    expect(parseVersion("connrefused")).toBe("")
  })

  it("解析大小与 docker 列表时间，无法识别时返回 null", () => {
    expect(parseDockerSize("187MB")).toBe(187_000_000)
    expect(parseDockerSize("1.5GiB")).toBe(1_610_612_736)
    expect(parseDockerSize("N/A")).toBeNull()
    expect(parseDockerTime("2024-01-01 12:00:00 +0800 CST")).toBe(
      Date.parse("2024-01-01T12:00:00+0800")
    )
    expect(parseDockerTime("garbage")).toBeNull()
  })

  it("解析 system df -v 的卷大小表", () => {
    const text = [
      "Images space usage:",
      "",
      "REPOSITORY   TAG   IMAGE ID   CREATED   SIZE   SHARED SIZE   UNIQUE SIZE   CONTAINERS",
      "opendecider  cpu   b4f5668b   45 minutes ago   1.75GB   189.3MB   1.56GB   1",
      "",
      "Containers space usage:",
      "",
      "CONTAINER ID   IMAGE   COMMAND   LOCAL VOLUMES   SIZE   CREATED   STATUS   NAMES",
      '3a2352da7b30   opendecider:cpu   "opendecider serve"   1   12.3kB   34 minutes ago   Up 34 minutes   opendecider',
      "",
      "Local Volumes space usage:",
      "",
      "VOLUME NAME                     LINKS     SIZE",
      "new-api_pg_data                 0         68.84MB",
      "litellm_postgres_data           1         70.43MB",
      "n/a-vol                         0         N/A",
      "077f1b6c54fd208b4c391cc1e8       0         472B",
      "",
      "Build cache usage: 0B",
      "",
      "CACHE ID   CACHE TYPE   SIZE",
    ].join("\n")
    expect([...parseVolumeSizes(text)]).toMatchInlineSnapshot(`
      [
        [
          "new-api_pg_data",
          68840000,
        ],
        [
          "litellm_postgres_data",
          70430000,
        ],
        [
          "077f1b6c54fd208b4c391cc1e8",
          472,
        ],
      ]
    `)
  })

  it("识别 colima 两种状态", () => {
    expect(
      parseColimaStatus(
        "INFO[0000] colima is running using macOS Virtualization.Framework\n" +
          "INFO[0000] arch: aarch64\nINFO[0000] runtime: docker\n"
      )
    ).toEqual({ running: true, arch: "aarch64", runtime: "docker" })
    // 真机实测的 logrus 写法：值被引号包住，不能把引号带进结果
    expect(
      parseColimaStatus(
        'time="2026-10-11T16:05:57+08:00" level=info msg="colima is running using QEMU"\n' +
          'time="2026-10-11T16:05:57+08:00" level=info msg="arch: x86_64"\n' +
          'time="2026-10-11T16:05:57+08:00" level=info msg="runtime: docker"\n' +
          'time="2026-10-11T16:05:57+08:00" level=info msg="docker socket: unix:///Users/me/.colima/default/docker.sock"\n'
      )
    ).toEqual({ running: true, arch: "x86_64", runtime: "docker" })
    expect(parseColimaStatus("FATA[0000] colima is not running")).toEqual({
      running: false,
      arch: null,
      runtime: null,
    })
  })
})

describe("命令调用方式", () => {
  /** ps -aq / ps -a --format json / inspect 三件套的受控替身。 */
  const psRunner = (
    psJson = psFixture,
    inspectJson = inspectFixture,
    ids = `${SHORT_ID}\n`
  ) =>
    createFakeRunner(async (_command, args) => {
      if (args[1] === "-aq") return { stdout: ids, stderr: "" }
      if (args[0] === "ps") return { stdout: `${psJson}\n`, stderr: "" }
      if (args[0] === "inspect") return { stdout: inspectJson, stderr: "" }
      if (args[0] === "logs") return { stdout: "log line\n", stderr: "" }
      throw new Error(`unexpected command: ${args.join(" ")}`)
    })

  it("参数以数组传递，不经过 shell", async () => {
    const { runner, calls } = psRunner()
    const cli = createDockerCli({ run: runner, cache: noCache })
    await cli.listContainers()
    await cli.getContainerLogs("1a2b", { tail: 50 })
    expect(calls).toMatchInlineSnapshot(`
      [
        {
          "args": [
            "ps",
            "-aq",
          ],
          "command": "docker",
        },
        {
          "args": [
            "ps",
            "-a",
            "--format",
            "json",
          ],
          "command": "docker",
        },
        {
          "args": [
            "inspect",
            "3a2352da7b30",
          ],
          "command": "docker",
        },
        {
          "args": [
            "logs",
            "--tail",
            "51",
            "1a2b",
          ],
          "command": "docker",
        },
      ]
    `)
  })

  it("列表数据源不再读 ps 的 Mounts", async () => {
    const { runner } = psRunner()
    const cli = createDockerCli({ run: runner, cache: noCache })
    const [container] = await cli.listContainers()
    // ps 里是 "opendecider-mo…"，这里必须是 inspect 的完整路径
    expect(container?.mounts[0]?.source).toBe(
      "/var/lib/docker/volumes/opendecider-models/_data"
    )
    expect(container?.startedAt).toBe(Date.parse(STARTED_AT))
  })

  it("ps 与 inspect 按 id 前缀合并：名称与 Status 取 ps，结构取 inspect", async () => {
    const { runner } = psRunner()
    const cli = createDockerCli({ run: runner, cache: noCache })
    const [container] = await cli.listContainers()
    expect(container).toMatchObject({
      id: CONTAINER_ID,
      name: "opendecider",
      status: "Up 34 minutes (healthy)",
      state: "running",
      image: "opendecider:cpu",
      command: "opendecider serve",
    })
    expect(container?.ports).toEqual([
      {
        hostIp: "127.0.0.1",
        hostPort: 48000,
        containerPort: 8000,
        protocol: "tcp",
      },
    ])
  })

  it("ps 没有对应行时名称回退到 inspect，Status 留空", async () => {
    const { runner } = psRunner("", inspectFixture)
    const cli = createDockerCli({ run: runner, cache: noCache })
    const [container] = await cli.listContainers()
    expect(container?.name).toBe("opendecider")
    expect(container?.status).toBe("")
  })

  it("inspect 遇到已被删除的容器时逐个降级，不整批失败", async () => {
    const otherShort = "9f0000000000"
    const { runner, calls } = createFakeRunner(async (_command, args) => {
      if (args[1] === "-aq") {
        return { stdout: `${SHORT_ID}\n${otherShort}\n`, stderr: "" }
      }
      if (args[0] === "inspect") {
        const ids = args.slice(1)
        // 批量读取时其中一个已被删掉，docker 会让整条命令失败
        if (ids.length > 1) {
          return Promise.reject(
            Object.assign(new Error("Command failed: docker inspect"), {
              stderr: `Error: No such container: ${otherShort}`,
            })
          )
        }
        return {
          stdout: ids[0] === otherShort ? "" : inspectFixture,
          stderr: "",
        }
      }
      return { stdout: `${psFixture}\n`, stderr: "" }
    })
    const cli = createDockerCli({ run: runner, cache: noCache })
    const containers = await cli.listContainers()
    // 已删除的那个跳过，剩下一个照常返回：1 次批量 + 2 次单个
    expect(containers.map((item) => item.id)).toEqual([CONTAINER_ID])
    expect(calls.filter((call) => call.args[0] === "inspect")).toHaveLength(3)
  })

  it("非法容器标识不发命令", async () => {
    const { runner, calls } = createFakeRunner(succeed(""))
    const cli = createDockerCli({ run: runner, cache: noCache })
    const failure = await errorOf(cli.getContainerLogs("../etc/passwd"))
    expect(failure).toBeInstanceOf(DockerCommandError)
    expect((failure as DockerCommandError).kind).toBe("invalid_input")
    expect(calls).toHaveLength(0)
  })

  it("只读列表走短 TTL 缓存，键按域区分", async () => {
    const keys: string[] = []
    const store = new Map<string, unknown>()
    const cache: DockerCache = async (key, _ttl, load) => {
      keys.push(key)
      const hit = store.get(key)
      if (hit !== undefined) return hit as never
      const value = await load()
      store.set(key, value)
      return value
    }
    const { runner, calls } = psRunner()
    const cli = createDockerCli({ run: runner, cache })
    await cli.listContainers()
    await cli.listContainers()
    expect(keys).toEqual(["docker:containers", "docker:containers"])
    expect(calls).toHaveLength(3)
  })

  it("卷与网络按容器交叉统计，卷大小取 system df -v", async () => {
    const listed = JSON.stringify({
      Name: "opendecider-models",
      Driver: "local",
      Size: "N/A",
    })
    const inspected = JSON.stringify([
      {
        Name: "opendecider-models",
        Driver: "local",
        Mountpoint: "/var/lib/docker/volumes/opendecider-models/_data",
        CreatedAt: "2026-10-11T07:20:00Z",
      },
    ])
    const network = JSON.stringify({
      ID: "net1",
      Name: "bridge",
      Driver: "bridge",
      Scope: "local",
      Internal: "false",
    })
    const diskUsage = [
      "Local Volumes space usage:",
      "",
      "VOLUME NAME              LINKS     SIZE",
      "opendecider-models       1         795.5MB",
    ].join("\n")
    const psJson = JSON.stringify({
      ID: SHORT_ID,
      Names: "opendecider",
      Status: "Up 34 minutes (healthy)",
      Networks: "bridge",
    })
    const { runner, calls } = createFakeRunner(async (_command, args) => {
      if (args[1] === "-aq") return { stdout: `${SHORT_ID}\n`, stderr: "" }
      if (args[0] === "ps") return { stdout: `${psJson}\n`, stderr: "" }
      if (args[0] === "inspect") return { stdout: inspectFixture, stderr: "" }
      if (args[0] === "volume" && args[1] === "ls") {
        return { stdout: `${listed}\n`, stderr: "" }
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return { stdout: inspected, stderr: "" }
      }
      if (args[0] === "system") return { stdout: diskUsage, stderr: "" }
      return { stdout: `${network}\n`, stderr: "" }
    })
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.listVolumes()).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 1791703200000,
          "driver": "local",
          "inUse": true,
          "mountpoint": "/var/lib/docker/volumes/opendecider-models/_data",
          "name": "opendecider-models",
          "sizeBytes": 795500000,
        },
      ]
    `)
    expect(await cli.listNetworks()).toMatchInlineSnapshot(`
      [
        {
          "containers": 1,
          "driver": "bridge",
          "id": "net1",
          "internal": false,
          "name": "bridge",
          "scope": "local",
        },
      ]
    `)
    expect(
      calls.filter((call) => call.args[0] === "volume")[1]?.args
    ).toMatchInlineSnapshot(`
        [
          "volume",
          "inspect",
          "opendecider-models",
        ]
      `)
  })

  it("system df -v 失败不影响卷列表", async () => {
    const listed = JSON.stringify({ Name: "opendecider-models" })
    const { runner } = createFakeRunner(async (_command, args) => {
      if (args[1] === "-aq") return { stdout: `${SHORT_ID}\n`, stderr: "" }
      if (args[0] === "ps") return { stdout: `${psFixture}\n`, stderr: "" }
      if (args[0] === "inspect") return { stdout: inspectFixture, stderr: "" }
      if (args[1] === "ls") return { stdout: `${listed}\n`, stderr: "" }
      if (args[0] === "system") {
        return Promise.reject(
          Object.assign(new Error("Command failed: docker system df -v"), {
            stderr: "Error response from daemon: broken",
          })
        )
      }
      return { stdout: "[]", stderr: "" }
    })
    const cli = createDockerCli({ run: runner, cache: noCache })
    const [volume] = await cli.listVolumes()
    expect(volume?.name).toBe("opendecider-models")
    expect(volume?.sizeBytes).toBeNull()
  })

  it("卷多于一批时分批 inspect，不丢卷", async () => {
    const names = Array.from({ length: 201 }, (_, index) => `vol-${index}`)
    const listed = names
      .map((name) => JSON.stringify({ Name: name }))
      .join("\n")
    const inspectCalls: string[][] = []
    const { runner } = createFakeRunner(async (_command, args) => {
      if (args[1] === "-aq") return { stdout: "", stderr: "" }
      if (args[0] === "ps") return { stdout: "", stderr: "" }
      if (args[0] === "system") return { stdout: "", stderr: "" }
      if (args[1] === "ls") return { stdout: `${listed}\n`, stderr: "" }
      inspectCalls.push(args.slice(2))
      return {
        stdout: JSON.stringify(
          args.slice(2).map((name) => ({ Name: name, Driver: "local" }))
        ),
        stderr: "",
      }
    })
    const cli = createDockerCli({ run: runner, cache: noCache })
    const volumes = await cli.listVolumes()
    expect(volumes).toHaveLength(201)
    expect(inspectCalls.map((batch) => batch.length)).toEqual([200, 1])
    expect(volumes.at(-1)?.name).toBe("vol-200")
  })
})

describe("错误映射", () => {
  it("找不到 docker 命令时给出中文提示", async () => {
    const { runner, calls } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" })
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const failure = await errorOf(cli.listContainers())
    expect(failure).toBeInstanceOf(DockerCommandError)
    const error = failure as DockerCommandError
    expect(error.kind).toBe("not_installed")
    expect(error.message).toBe(
      "未找到 docker 命令，请确认 Docker 或 Colima 已安装。"
    )
    // PATH 与常见安装目录都试过后才判定未安装（ps -aq 与 ps -a 都会各跑一遍）
    expect([...new Set(calls.map((call) => call.command))]).toEqual([
      "docker",
      "/opt/homebrew/bin/docker",
      "/usr/local/bin/docker",
      path.join(os.homedir(), ".docker", "bin", "docker"),
    ])
    expect(calls).toHaveLength(8)
  })

  it("找不到 colima 命令时给出中文提示", async () => {
    const { runner } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("spawn colima ENOENT"), { code: "ENOENT" })
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const failure = await errorOf(cli.getColimaStatus())
    expect((failure as DockerCommandError).kind).toBe("not_installed")
    expect((failure as DockerCommandError).message).toBe(
      "未找到 colima 命令，请先安装 Colima。"
    )
  })

  it("daemon 未运行时给出中文提示", async () => {
    const { runner } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker ps"), {
          stderr:
            "Cannot connect to the Docker daemon at unix:///Users/me/.colima/default/docker.sock. Is the docker daemon running?",
        })
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const failure = await errorOf(cli.listContainers())
    expect(failure).toBeInstanceOf(DockerCommandError)
    const error = failure as DockerCommandError
    expect(error.kind).toBe("daemon_unavailable")
    expect(error.message).toBe(
      "Docker 服务未运行，请先启动 Docker 或执行 colima start。"
    )
  })

  it("超时与命令失败都映射成中文错误", async () => {
    const timeout = createFakeRunner(() =>
      Promise.reject(Object.assign(new Error("timed out"), { killed: true }))
    )
    const timedOutCli = createDockerCli({
      run: timeout.runner,
      cache: noCache,
    })
    const failure = await errorOf(timedOutCli.listImages())
    expect((failure as DockerCommandError).kind).toBe("timeout")
    expect((failure as DockerCommandError).message).toBe(
      "docker 命令执行超时（超过 30 秒），已终止。"
    )

    const rejected = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker images"), {
          stderr: "Error response from daemon: pull access denied\nmore text",
        })
      )
    )
    const failedCli = createDockerCli({ run: rejected.runner, cache: noCache })
    const failed = await errorOf(failedCli.listImages())
    expect((failed as DockerCommandError).kind).toBe("failed")
    expect((failed as DockerCommandError).message).toBe(
      "docker 命令执行失败：Error response from daemon: pull access denied"
    )
  })

  it("colima 未运行时按状态返回而不是报错", async () => {
    const { runner } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: colima status"), {
          stderr: "FATA[0000] colima is not running",
        })
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.getColimaStatus()).toMatchObject({
      installed: true,
      running: false,
      status: "colima 未运行",
      cpus: null,
      memoryBytes: null,
    })
  })

  it("colima 运行时读出 runtime 与架构", async () => {
    const { runner } = createFakeRunner(
      succeed(
        "",
        "INFO[0000] colima is running using macOS Virtualization.Framework\n" +
          "INFO[0000] arch: aarch64\nINFO[0000] runtime: docker\n"
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.getColimaStatus()).toMatchObject({
      installed: true,
      running: true,
      runtime: "docker",
      arch: "aarch64",
    })
  })

  it("colima start/stop 返回一行可读结果", async () => {
    const { runner, calls } = createFakeRunner(
      succeed("INFO[0001] colima started\n")
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.startColima()).toBe("INFO[0001] colima started")
    expect(await cli.stopColima()).toBe("INFO[0001] colima started")
    expect(calls.map((call) => call.args)).toEqual([["start"], ["stop"]])
  })
})

describe("日志读取", () => {
  const readLogs = async (output: string, options: { tail: number }) => {
    const { runner, calls } = createFakeRunner(succeed(output))
    const cli = createDockerCli({ run: runner, cache: noCache })
    return {
      logs: await cli.getContainerLogs("1a2b", options),
      args: calls[0]?.args,
    }
  }

  it("行数正好等于 tail 时不算截断", async () => {
    const { logs, args } = await readLogs("line-1\nline-2\n", { tail: 2 })
    expect(logs.truncated).toBe(false)
    expect(logs.lines).toEqual(["line-1", "line-2"])
    // 多要一行才能区分「正好 tail 行」与「还有更多」
    expect(args).toEqual(["logs", "--tail", "3", "1a2b"])
  })

  it("上游超过 tail 行时标记截断，且只保留末 tail 行", async () => {
    const { logs } = await readLogs("line-1\nline-2\nline-3\n", { tail: 2 })
    expect(logs.truncated).toBe(true)
    expect(logs.lines).toEqual(["line-2", "line-3"])
  })

  it("保留日志中间的空白行，行数如实反映", async () => {
    const { logs } = await readLogs("start\n\nend\n", { tail: 10 })
    expect(logs.lines).toEqual(["start", "", "end"])
    expect(logs.truncated).toBe(false)
  })

  it("合并 stdout 与 stderr", async () => {
    const { runner } = createFakeRunner(succeed("line-1\nline-2\n", "line-3\n"))
    const cli = createDockerCli({ run: runner, cache: noCache })
    const logs = await cli.getContainerLogs("1a2b", { tail: 10 })
    expect(logs.lines).toEqual(["line-1", "line-2", "line-3"])
  })

  it("since 一并转成 docker 参数", async () => {
    const { runner, calls } = createFakeRunner(succeed("only\n"))
    const cli = createDockerCli({ run: runner, cache: noCache })
    await cli.getContainerLogs("1a2b", { tail: 100, since: 1700 })
    expect(calls[0]?.args).toEqual([
      "logs",
      "--tail",
      "101",
      "--since",
      "1700",
      "1a2b",
    ])
  })
})

describe("写命令参数", () => {
  const runWith = async (call: (cli: DockerCli) => Promise<unknown>) => {
    const { runner, calls, timeouts } = createFakeRunner(
      succeed("new-container-id\n")
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const value = await call(cli)
    return { calls, timeouts, value }
  }

  it("容器启停与删除只拼标识与固定 flag", async () => {
    expect(
      (await runWith((cli) => cli.startContainer("abc"))).calls[0]?.args
    ).toEqual(["start", "abc"])
    expect(
      (await runWith((cli) => cli.stopContainer("abc"))).calls[0]?.args
    ).toEqual(["stop", "abc"])
    expect(
      (await runWith((cli) => cli.stopContainer("abc", { force: true })))
        .calls[0]?.args
    ).toEqual(["stop", "-t", "0", "abc"])
    expect(
      (await runWith((cli) => cli.killContainer("abc"))).calls[0]?.args
    ).toEqual(["kill", "abc"])
    expect(
      (await runWith((cli) => cli.restartContainer("abc"))).calls[0]?.args
    ).toEqual(["restart", "abc"])
    expect(
      (await runWith((cli) => cli.restartContainer("abc", { force: true })))
        .calls[0]?.args
    ).toEqual(["restart", "-t", "0", "abc"])
    expect(
      (await runWith((cli) => cli.removeContainer("abc"))).calls[0]?.args
    ).toEqual(["rm", "abc"])
    expect(
      (await runWith((cli) => cli.removeContainer("abc", { force: true })))
        .calls[0]?.args
    ).toEqual(["rm", "-f", "abc"])
  })

  it("镜像与卷网络删除参数", async () => {
    expect(
      (await runWith((cli) => cli.pullImage("nginx:latest"))).calls[0]?.args
    ).toEqual(["pull", "nginx:latest"])
    expect(
      (await runWith((cli) => cli.removeImage("sha256:abc"))).calls[0]?.args
    ).toEqual(["image", "rm", "sha256:abc"])
    expect(
      (await runWith((cli) => cli.removeImage("sha256:abc", { force: true })))
        .calls[0]?.args
    ).toEqual(["image", "rm", "-f", "sha256:abc"])
    expect(
      (await runWith((cli) => cli.removeVolume("myvol"))).calls[0]?.args
    ).toEqual(["volume", "rm", "myvol"])
    expect(
      (await runWith((cli) => cli.removeNetwork("net1"))).calls[0]?.args
    ).toEqual(["network", "rm", "net1"])
  })

  it("拉取用长超时，其余写命令用普通写超时", async () => {
    expect(
      (await runWith((cli) => cli.pullImage("nginx:latest"))).timeouts
    ).toEqual([600_000])
    expect(
      (await runWith((cli) => cli.removeVolume("myvol"))).timeouts
    ).toEqual([120_000])
  })

  it("新建容器按受校验字段拼 flag，镜像名之后是容器命令", async () => {
    const { calls, value } = await runWith((cli) =>
      cli.createContainer({
        image: "nginx:latest",
        name: "web",
        env: [{ name: "MODE", value: "prod" }],
        ports: [{ hostPort: 8080, containerPort: 80, protocol: "tcp" }],
        volumes: [{ source: "myvol", destination: "/data" }],
        restartPolicy: "unless-stopped",
        command: ["nginx", "-g", "daemon off;"],
      })
    )
    expect(calls[0]?.args).toMatchInlineSnapshot(`
      [
        "run",
        "--detach",
        "--name",
        "web",
        "--env",
        "MODE=prod",
        "--publish",
        "8080:80/tcp",
        "--volume",
        "myvol:/data",
        "--restart",
        "unless-stopped",
        "nginx:latest",
        "nginx",
        "-g",
        "daemon off;",
      ]
    `)
    expect(value).toBe("new-container-id")
  })

  it("force 停止用 stop -t 0（不是 kill），kill 单独是 SIGKILL", async () => {
    // 两者不能混用：stop 给进程清理机会，kill 不给
    expect(
      (await runWith((cli) => cli.stopContainer("abc", { force: true })))
        .calls[0]?.args
    ).toEqual(["stop", "-t", "0", "abc"])
    expect(
      (await runWith((cli) => cli.killContainer("abc"))).calls[0]?.args
    ).toEqual(["kill", "abc"])
  })

  it("核实用 inspect 读单个容器，已删除时返回 null 而不是报错", async () => {
    const { runner, calls } = createFakeRunner(
      succeed(
        JSON.stringify([
          {
            Id: "3a2352da7b30",
            Created: "2026-10-11T07:25:40Z",
            State: { Status: "exited", StartedAt: "0001-01-01T00:00:00Z" },
            Name: "/smoke",
            Config: { Image: "redis:7-alpine" },
            Mounts: [],
          },
        ])
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const found = await cli.inspectContainer("3a2352da7b30")
    expect(calls[0]?.args).toEqual(["inspect", "3a2352da7b30"])
    expect(found).toMatchObject({
      id: "3a2352da7b30",
      name: "smoke",
      state: "exited",
      startedAt: null,
    })

    const missing = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker inspect"), {
          stderr: "Error: No such container: gone",
        })
      )
    )
    const goneCli = createDockerCli({ run: missing.runner, cache: noCache })
    expect(await goneCli.inspectContainer("gone")).toBeNull()
  })

  it("非法标识与非法挂载点在发命令前就被拒绝", async () => {
    const { runner, calls } = createFakeRunner(succeed(""))
    const cli = createDockerCli({ run: runner, cache: noCache })
    await expect(cli.pullImage("--help")).rejects.toThrow(
      "镜像引用包含非法字符"
    )
    await expect(cli.removeVolume("a b")).rejects.toThrow("卷名包含非法字符")
    await expect(cli.removeNetwork("net1; rm -rf /")).rejects.toThrow(
      "网络标识包含非法字符"
    )
    await expect(cli.startContainer("../../etc")).rejects.toThrow(
      "容器标识包含非法字符"
    )
    await expect(
      cli.createContainer({
        image: "nginx",
        volumes: [{ source: "v", destination: "relative/path" }],
      })
    ).rejects.toThrow("容器内挂载点必须是绝对路径")
    await expect(
      cli.createContainer({
        image: "nginx",
        env: [{ name: "A B", value: "1" }],
      })
    ).rejects.toThrow("环境变量名包含非法字符")
    await expect(
      cli.createContainer({ image: "nginx", name: "-bad" })
    ).rejects.toThrow("容器名包含非法字符")
    expect(calls).toHaveLength(0)
  })
})

describe("镜像存在性查询", () => {
  it("用 image inspect 判断本地镜像，不经列表缓存", async () => {
    const { runner, calls } = createFakeRunner(succeed("sha256:abc\n"))
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.imageExists("redis:7-alpine")).toBe(true)
    expect(calls[0]?.args).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      "redis:7-alpine",
    ])
  })

  it("镜像不存在返回 false，其它失败照旧抛出", async () => {
    const missing = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker image inspect"), {
          stderr: "Error response from daemon: No such image: nope:latest",
        })
      )
    )
    const missingCli = createDockerCli({
      run: missing.runner,
      cache: noCache,
    })
    expect(await missingCli.imageExists("nope:latest")).toBe(false)

    const broken = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker image inspect"), {
          stderr:
            "Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?",
        })
      )
    )
    const brokenCli = createDockerCli({ run: broken.runner, cache: noCache })
    await expect(brokenCli.imageExists("redis:7-alpine")).rejects.toThrow(
      "Docker 服务未运行"
    )
  })
})

describe("拉取输出解析", () => {
  it("\\n 与 \\r 都当换行，进度条不会被黏成一行", () => {
    const lines: string[] = []
    const splitter = createLineSplitter((line) => lines.push(line))
    // TTY 下的进度条用 \r 回写同一行
    splitter.push("a: Downloading 1kB/2kB\r")
    splitter.push("a: Downloading 2kB/2kB\r\n")
    splitter.push("b: Pull complete\n")
    splitter.push("c: Already exists")
    splitter.flush()
    expect(lines).toMatchInlineSnapshot(`
      [
        "a: Downloading 1kB/2kB",
        "a: Downloading 2kB/2kB",
        "b: Pull complete",
        "c: Already exists",
      ]
    `)
  })

  it("按层汇总进度，字节只取真实输出", () => {
    const tracker = createPullProgressTracker()
    const steps = [
      "alpine: Pulling from library/alpine",
      "aaa111bbb222: Pulling fs layer",
      "ccc333ddd444: Already exists",
      "aaa111bbb222: Downloading 1.5MB/3.2MB",
      "aaa111bbb222: Download complete",
      "aaa111bbb222: Pull complete",
    ]
    const snapshots = steps
      .map((line) => tracker.push(line))
      .filter((item) => item !== null)
    expect(snapshots).toMatchInlineSnapshot(`
      [
        {
          "bytesDone": null,
          "bytesTotal": null,
          "completed": 0,
          "layers": 1,
        },
        {
          "bytesDone": null,
          "bytesTotal": null,
          "completed": 1,
          "layers": 2,
        },
        {
          "bytesDone": 1500000,
          "bytesTotal": 3200000,
          "completed": 1,
          "layers": 2,
        },
        {
          "bytesDone": 1500000,
          "bytesTotal": 3200000,
          "completed": 2,
          "layers": 2,
        },
      ]
    `)
    expect(tracker.snapshot()).toMatchInlineSnapshot(`
      {
        "bytesDone": 1500000,
        "bytesTotal": 3200000,
        "completed": 2,
        "layers": 2,
      }
    `)
  })

  it("解析不到字节时给出 null，不编造数字", () => {
    const tracker = createPullProgressTracker()
    tracker.push("aaa111bbb222: Pulling fs layer")
    expect(tracker.snapshot()).toEqual({
      layers: 1,
      completed: 0,
      bytesDone: null,
      bytesTotal: null,
    })
  })

  it("pullImage 边执行边回调行，并等待最后一段缓冲", async () => {
    const lines: string[] = []
    const chunks = [
      "alpine: Pulling from library/alpine\r",
      "aaa111bbb222: Pull complete\n",
      "Status: Downloaded newer image for alpine:3.20",
    ]
    const { runner, calls, timeouts } = createFakeRunner(
      (() => {
        return async () => ({ stdout: chunks.join(""), stderr: "" })
      })()
    )
    const streaming: typeof runner = (command, args, options) => {
      for (const chunk of chunks) options.onOutput?.(chunk)
      return runner(command, args, options)
    }
    const cli = createDockerCli({ run: streaming, cache: noCache })
    await cli.pullImage("alpine:3.20", { onLine: (line) => lines.push(line) })
    expect(lines).toMatchInlineSnapshot(`
      [
        "alpine: Pulling from library/alpine",
        "aaa111bbb222: Pull complete",
        "Status: Downloaded newer image for alpine:3.20",
      ]
    `)
    expect(calls[0]?.args).toEqual(["pull", "alpine:3.20"])
    expect(timeouts[0]).toBe(600_000)
  })
})

describe("镜像删除的冲突映射", () => {
  it("被容器引用时映射成 conflict，且默认不带 -f", async () => {
    const { runner, calls } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("Command failed: docker image rm"), {
          stderr:
            "Error response from daemon: conflict: unable to delete 3d88bd757134 (must be forced) - image is being used by stopped container 1a2b",
        })
      )
    )
    const cli = createDockerCli({ run: runner, cache: noCache })
    const error = await cli.removeImage("3d88bd757134").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DockerCommandError)
    expect((error as DockerCommandError).kind).toBe("conflict")
    expect((error as DockerCommandError).message).toBe(
      "该镜像被容器使用中，请先删除相关容器，或显式选择强制删除"
    )
    // 默认不带 -f，绝不自作主张强删
    expect(calls[0]?.args).toEqual(["image", "rm", "3d88bd757134"])
  })

  it("显式 force 才发 image rm -f", async () => {
    const { runner, calls } = createFakeRunner(succeed(""))
    const cli = createDockerCli({ run: runner, cache: noCache })
    await cli.removeImage("3d88bd757134", { force: true })
    expect(calls[0]?.args).toEqual(["image", "rm", "-f", "3d88bd757134"])
  })
})
