// @vitest-environment jsdom
import { ApiPath } from "@shared/api-path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "./client"
import {
  downloadDatabaseBackup,
  uploadDatabaseBackup,
} from "./database-backups"

const CHUNK = 1024

/** 上传替身：只实现本次要验证的接口，进度与结果由用例自己派发。 */
class FakeUploadRequest extends EventTarget {
  static instances: FakeUploadRequest[] = []
  upload = new EventTarget()
  status = 201
  responseText = ""
  headers: Record<string, string> = {}
  open = vi.fn()
  send = vi.fn()
  setRequestHeader = (key: string, value: string): void => {
    this.headers[key] = value
  }
  abort = (): void => {
    this.dispatchEvent(new Event("abort"))
  }

  constructor() {
    super()
    FakeUploadRequest.instances.push(this)
  }

  progress(loaded: number, total?: number): void {
    this.upload.dispatchEvent(
      new ProgressEvent("progress", {
        loaded,
        total: total ?? 0,
        lengthComputable: total !== undefined,
      })
    )
  }
}

/** 下载替身：一次只给一个 chunk，中途可被 signal 打断。 */
const stubDownloadFetch = (options: {
  chunkCount: number
  contentLength?: number
  signal?: AbortSignal
}): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      let sent = 0
      const stream = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          await Promise.resolve()
          if (options.signal?.aborted === true) {
            controller.error(new DOMException("aborted", "AbortError"))
            return
          }
          if (sent >= options.chunkCount) {
            controller.close()
            return
          }
          sent += 1
          controller.enqueue(new Uint8Array(CHUNK))
        },
      })
      return new Response(stream, {
        headers: {
          "content-disposition": 'attachment; filename="snap.sqlite3"',
          ...(options.contentLength === undefined
            ? {}
            : { "content-length": String(options.contentLength) }),
        },
      })
    })
  )
}

const file = (): File => new File([new Uint8Array(4 * CHUNK)], "旧机器.sqlite3")

beforeEach(() => {
  FakeUploadRequest.instances = []
  vi.stubGlobal("XMLHttpRequest", FakeUploadRequest)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("上传进度", () => {
  it("进度单调递增，total 就是文件大小", async () => {
    const seen: number[] = []
    const promise = uploadDatabaseBackup(file(), {
      originalFileName: "旧机器.sqlite3",
      onProgress: (loaded, total) => {
        seen.push(loaded)
        expect(total).toBe(4 * CHUNK)
      },
    })

    const request = FakeUploadRequest.instances[0]
    request.progress(CHUNK, 4 * CHUNK)
    request.progress(2 * CHUNK, 4 * CHUNK)
    request.progress(4 * CHUNK, 4 * CHUNK)
    request.responseText = JSON.stringify({
      backup: { id: "snap-1" },
      message: "已导入",
    })
    request.dispatchEvent(new Event("load"))

    await expect(promise).resolves.toEqual({
      backup: { id: "snap-1" },
      message: "已导入",
    })
    expect(seen).toEqual([CHUNK, 2 * CHUNK, 4 * CHUNK])
  })

  it("lengthComputable 为假时只报已传字节，不编造 total", async () => {
    const totals: (number | undefined)[] = []
    const promise = uploadDatabaseBackup(file(), {
      onProgress: (_loaded, total) => totals.push(total),
    })
    const request = FakeUploadRequest.instances[0]
    request.progress(3 * CHUNK)
    request.dispatchEvent(new Event("load"))
    await promise
    expect(totals).toEqual([undefined])
  })

  it("请求地址与原始文件名头保持不变", async () => {
    const promise = uploadDatabaseBackup(file(), {
      originalFileName: "旧机器.sqlite3",
    })
    const request = FakeUploadRequest.instances[0]
    request.dispatchEvent(new Event("load"))
    await promise
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      ApiPath.databaseBackupUpload
    )
    expect(request.headers["x-file-name"]).toBe(
      encodeURIComponent("旧机器.sqlite3")
    )
    expect(request.send).toHaveBeenCalledTimes(1)
  })

  it("超限 413 的错误文案与错误码保持不变", async () => {
    const promise = uploadDatabaseBackup(file())
    const request = FakeUploadRequest.instances[0]
    request.status = 413
    request.responseText = JSON.stringify({
      message: "上传文件超过 8 GiB 上限",
      code: "too_large",
    })
    request.dispatchEvent(new Event("load"))

    await expect(promise).rejects.toMatchObject({
      status: 413,
      resultUnknown: false,
      message: "请求失败（HTTP 413）：上传文件超过 8 GiB 上限",
    })
  })

  it("连接中断按结果未知处理，不当作失败也不自动重传", async () => {
    const promise = uploadDatabaseBackup(file())
    FakeUploadRequest.instances[0].dispatchEvent(new Event("error"))
    await expect(promise).rejects.toMatchObject({
      status: null,
      resultUnknown: true,
    })
  })

  it("取消后不再回调进度", async () => {
    const controller = new AbortController()
    const seen: number[] = []
    const promise = uploadDatabaseBackup(file(), {
      signal: controller.signal,
      onProgress: (loaded) => seen.push(loaded),
    })
    const request = FakeUploadRequest.instances[0]
    request.progress(CHUNK, 4 * CHUNK)
    controller.abort()
    request.progress(2 * CHUNK, 4 * CHUNK)

    await expect(promise).rejects.toBeInstanceOf(ApiRequestError)
    expect(seen).toEqual([CHUNK])
  })
})

describe("下载进度", () => {
  it("按块累计字节，total 取自 Content-Length", async () => {
    const controller = new AbortController()
    stubDownloadFetch({
      chunkCount: 3,
      contentLength: 3 * CHUNK,
      signal: controller.signal,
    })
    const seen: { loaded: number; total?: number }[] = []
    const result = await downloadDatabaseBackup("snap-1", {
      signal: controller.signal,
      onProgress: (loaded, total) => seen.push({ loaded, total }),
    })

    expect(seen).toEqual([
      { loaded: CHUNK, total: 3 * CHUNK },
      { loaded: 2 * CHUNK, total: 3 * CHUNK },
      { loaded: 3 * CHUNK, total: 3 * CHUNK },
    ])
    expect(result.sizeBytes).toBe(3 * CHUNK)
    expect(result.fileName).toBe("snap.sqlite3")
    expect(await result.blob.size).toBe(3 * CHUNK)
  })

  it("没有 Content-Length 时 total 是 undefined", async () => {
    stubDownloadFetch({ chunkCount: 2 })
    const totals: (number | undefined)[] = []
    await downloadDatabaseBackup("snap-1", {
      onProgress: (_loaded, total) => totals.push(total),
    })
    expect(totals).toEqual([undefined, undefined])
  })

  it("取消后不再回调，且已经读到的进度保持单调", async () => {
    const controller = new AbortController()
    stubDownloadFetch({
      chunkCount: 100,
      contentLength: 100 * CHUNK,
      signal: controller.signal,
    })
    const seen: number[] = []
    const promise = downloadDatabaseBackup("snap-1", {
      signal: controller.signal,
      onProgress: (loaded) => {
        seen.push(loaded)
        if (seen.length === 2) controller.abort()
      },
    })

    await expect(promise).rejects.toBeTruthy()
    const afterAbort = seen.length
    // 再等几轮：中断之后不应再有回调
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(seen.length).toBe(afterAbort)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(afterAbort).toBe(2)
  })

  it("没有进度回调时退回整体读取，行为与改动前一致", async () => {
    stubDownloadFetch({ chunkCount: 2, contentLength: 2 * CHUNK })
    const result = await downloadDatabaseBackup("snap-1")
    expect(await result.blob.size).toBe(2 * CHUNK)
    expect(result.sizeBytes).toBe(2 * CHUNK)
  })
})
