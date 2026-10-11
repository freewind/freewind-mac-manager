import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  type CommandOutput,
  createDockerCli,
  type DockerCache,
  DockerCommandError,
  type DockerCommandRunner,
  parseColimaStatus,
  parseContainers,
  parseDockerMounts,
  parseDockerPorts,
  parseDockerSize,
  parseDockerTime,
  parseImages,
  parseInfo,
  parseJsonLines,
  parseNetworks,
  parseVersion,
} from "./cli"

/** 记录调用参数的受控替身：不真的执行任何命令。 */
const createFakeRunner = (
  handler: (command: string, args: string[]) => Promise<CommandOutput>
) => {
  const calls: { command: string; args: string[] }[] = []
  const runner: DockerCommandRunner = (command, args) => {
    calls.push({ command, args })
    return handler(command, args)
  }
  return { runner, calls }
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

  it("解析端口映射并去掉 IPv6 重复项", () => {
    const ports = parseDockerPorts(
      "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 9000/udp"
    )
    expect(ports).toMatchInlineSnapshot(`
      [
        {
          "containerPort": 80,
          "hostIp": "0.0.0.0",
          "hostPort": 8080,
          "protocol": "tcp",
        },
        {
          "containerPort": 9000,
          "hostIp": "",
          "hostPort": null,
          "protocol": "udp",
        },
      ]
    `)
  })

  it("解析挂载字符串，坏项跳过", () => {
    const mounts = parseDockerMounts("myvol:/data, /Users/me/x:/app, :/broken,")
    expect(mounts).toMatchInlineSnapshot(`
      [
        {
          "destination": "/data",
          "readOnly": false,
          "source": "myvol",
          "type": "volume",
        },
        {
          "destination": "/app",
          "readOnly": false,
          "source": "/Users/me/x",
          "type": "bind",
        },
      ]
    `)
  })

  it("把 ps -a 的一行映射成容器", () => {
    const line = JSON.stringify({
      Command: '"/docker-entrypoint.sh nginx"',
      CreatedAt: "2024-05-01 10:00:00 +0800 CST",
      ID: "1a2b3c4d5e6f",
      Image: "nginx:latest",
      Names: "web",
      Ports: "0.0.0.0:8080->80/tcp",
      Mounts: "myvol:/data",
      State: "running",
      Status: "Up 2 hours",
      Networks: "bridge",
    })
    const [container] = parseContainers(`${line}\n`)
    expect(container).toMatchObject({
      id: "1a2b3c4d5e6f",
      name: "web",
      image: "nginx:latest",
      state: "running",
      status: "Up 2 hours",
    })
    // ps 不提供启动时间，startedAt 保持空
    expect(container?.startedAt).toBeNull()
    expect(container?.createdAt).toBe(Date.parse("2024-05-01T10:00:00+0800"))
    expect(container?.ports).toEqual([
      { hostIp: "0.0.0.0", hostPort: 8080, containerPort: 80, protocol: "tcp" },
    ])
    expect(container?.mounts).toEqual([
      {
        type: "volume",
        source: "myvol",
        destination: "/data",
        readOnly: false,
      },
    ])
  })

  it("未知 State 归为 exited，不产生契约外的取值", () => {
    const [container] = parseContainers(
      `${JSON.stringify({ ID: "a", State: "weird" })}\n`
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

  it("解析大小与时间，无法识别时返回 null", () => {
    expect(parseDockerSize("187MB")).toBe(187_000_000)
    expect(parseDockerSize("1.5GiB")).toBe(1_610_612_736)
    expect(parseDockerSize("N/A")).toBeNull()
    expect(parseDockerTime("2024-01-01 12:00:00 +0800 CST")).toBe(
      Date.parse("2024-01-01T12:00:00+0800")
    )
    expect(parseDockerTime("garbage")).toBeNull()
  })

  it("识别 colima 两种状态", () => {
    expect(
      parseColimaStatus(
        "INFO[0000] colima is running using macOS Virtualization.Framework\n" +
          "INFO[0000] arch: aarch64\nINFO[0000] runtime: docker\n"
      )
    ).toEqual({ running: true, arch: "aarch64", runtime: "docker" })
    expect(parseColimaStatus("FATA[0000] colima is not running")).toEqual({
      running: false,
      arch: null,
      runtime: null,
    })
  })
})

describe("命令调用方式", () => {
  it("参数以数组传递，不经过 shell", async () => {
    const { runner, calls } = createFakeRunner(succeed(""))
    const cli = createDockerCli({ run: runner, cache: noCache })
    await cli.listContainers()
    await cli.getContainerLogs("1a2b", { tail: 50 })
    expect(calls).toMatchInlineSnapshot(`
      [
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
            "logs",
            "--tail",
            "50",
            "1a2b",
          ],
          "command": "docker",
        },
      ]
    `)
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
    const { runner, calls } = createFakeRunner(
      succeed('{"ID":"a","State":"running"}\n')
    )
    const cli = createDockerCli({ run: runner, cache })
    await cli.listContainers()
    await cli.listContainers()
    expect(keys).toEqual(["docker:containers", "docker:containers"])
    expect(calls).toHaveLength(1)
  })

  it("卷多于一批时分批 inspect，不丢卷", async () => {
    const names = Array.from({ length: 201 }, (_, index) => `vol-${index}`)
    const listed = names
      .map((name) => JSON.stringify({ Name: name }))
      .join("\n")
    const inspectCalls: string[][] = []
    const psLine = JSON.stringify({ ID: "c1", Names: "web", State: "exited" })
    const { runner } = createFakeRunner(async (_command, args) => {
      if (args[0] === "ps") return { stdout: `${psLine}\n`, stderr: "" }
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

  it("卷与网络按容器交叉统计，volume inspect 单独取挂载点", async () => {
    const psLine = JSON.stringify({
      ID: "c1",
      Names: "web",
      State: "running",
      Mounts: "myvol:/data",
      Networks: "bridge",
    })
    const listed = JSON.stringify({
      Name: "myvol",
      Driver: "local",
      Size: "1.2MB",
    })
    const inspected = JSON.stringify([
      {
        Name: "myvol",
        Driver: "local",
        Mountpoint: "/var/lib/docker/volumes/myvol/_data",
        CreatedAt: "2024-05-01 10:00:00 +0800 CST",
      },
    ])
    const network = JSON.stringify({
      ID: "net1",
      Name: "bridge",
      Driver: "bridge",
      Scope: "local",
      Internal: "false",
    })
    const { runner, calls } = createFakeRunner(async (_command, args) => {
      if (args[0] === "ps") return { stdout: `${psLine}\n`, stderr: "" }
      if (args[0] === "volume" && args[1] === "ls") {
        return { stdout: `${listed}\n`, stderr: "" }
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return { stdout: inspected, stderr: "" }
      }
      return { stdout: `${network}\n`, stderr: "" }
    })
    const cli = createDockerCli({ run: runner, cache: noCache })
    expect(await cli.listVolumes()).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 1714528800000,
          "driver": "local",
          "inUse": true,
          "mountpoint": "/var/lib/docker/volumes/myvol/_data",
          "name": "myvol",
          "sizeBytes": 1200000,
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
      calls.filter((call) => call.args[1] === "inspect")[0]?.args
    ).toMatchInlineSnapshot(`
      [
        "volume",
        "inspect",
        "myvol",
      ]
    `)
  })
})

describe("错误映射", () => {
  it("找不到 docker 命令时给出中文提示", async () => {
    const { runner, calls } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("spawn docker ENOENT"), {
          code: "ENOENT",
        })
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
    // PATH 与常见安装目录都试过后才判定未安装
    expect(calls.map((call) => call.command)).toEqual([
      "docker",
      "/opt/homebrew/bin/docker",
      "/usr/local/bin/docker",
      path.join(os.homedir(), ".docker", "bin", "docker"),
    ])
  })

  it("找不到 colima 命令时给出中文提示", async () => {
    const { runner } = createFakeRunner(() =>
      Promise.reject(
        Object.assign(new Error("spawn colima ENOENT"), {
          code: "ENOENT",
        })
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
  it("合并 stdout 与 stderr，达到上限时标记可能截断", async () => {
    const { runner } = createFakeRunner(succeed("line-1\nline-2\n", "line-3\n"))
    const cli = createDockerCli({ run: runner, cache: noCache })
    const logs = await cli.getContainerLogs("1a2b", { tail: 3 })
    expect(logs).toMatchObject({
      containerId: "1a2b",
      lines: ["line-1", "line-2", "line-3"],
      truncated: true,
    })
  })

  it("未达到上限时不标记截断，并按 tail 构造参数", async () => {
    const { runner, calls } = createFakeRunner(succeed("only\n"))
    const cli = createDockerCli({ run: runner, cache: noCache })
    const logs = await cli.getContainerLogs("1a2b", { tail: 100, since: 1700 })
    expect(logs.truncated).toBe(false)
    expect(calls[0]?.args).toEqual([
      "logs",
      "--tail",
      "100",
      "--since",
      "1700",
      "1a2b",
    ])
  })
})
