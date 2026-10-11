// @vitest-environment jsdom
import { AUTH_COOKIE_NAME } from "@shared/auth"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  inspectUploadTarget,
  UploadResultUnknownError,
  uploadFile,
} from "./files"
import { activeWriteCount } from "./write-activity"

class UploadRequest extends EventTarget {
  static instances: UploadRequest[] = []
  upload = new EventTarget()
  status = 200
  responseText = ""
  timeout = 0
  send = vi.fn()
  open = vi.fn()
  setRequestHeader = vi.fn()
  abort = () => this.dispatchEvent(new Event("abort"))
  constructor() {
    super()
    UploadRequest.instances.push(this)
  }
}
const file = () => new File(["data"], "notes.txt")
beforeEach(() => {
  UploadRequest.instances = []
  vi.stubGlobal("XMLHttpRequest", UploadRequest)
})
afterEach(() => vi.unstubAllGlobals())
describe("upload result handling", () => {
  it("does not construct or send a request offline", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    await expect(uploadFile("/tmp", file())).rejects.toMatchObject({
      status: 0,
      resultUnknown: false,
    })
    expect(UploadRequest.instances).toHaveLength(0)
  })
  it.each(["error", "abort", "timeout"])(
    "preserves an unknown result on %s without retry",
    async (event) => {
      const pending = uploadFile(`/tmp/${event}`, file())
      const request = UploadRequest.instances[0]
      expect(activeWriteCount()).toBe(1)
      request.dispatchEvent(new Event(event))
      await expect(pending).rejects.toMatchObject({
        resultUnknown: true,
        targetPath: `/tmp/${event}`,
        relativePath: "notes.txt",
        size: 4,
      })
      expect(request.send).toHaveBeenCalledTimes(1)
      expect(UploadRequest.instances).toHaveLength(1)
      expect(activeWriteCount()).toBe(0)
    }
  )
  it("treats invalid success bodies and server failures as unknown", async () => {
    for (const status of [200, 500]) {
      const pending = uploadFile(`/tmp/${status}`, file())
      const request = UploadRequest.instances.at(-1)
      if (!request) throw new Error("缺少上传请求")
      request.status = status
      request.responseText = "{}"
      request.dispatchEvent(new Event("load"))
      await expect(pending).rejects.toBeInstanceOf(UploadResultUnknownError)
    }
  })
  it("accepts only a validated success response and releases the activity", async () => {
    const pending = uploadFile("/tmp", file())
    const request = UploadRequest.instances[0]
    const entry = {
      name: "notes.txt",
      path: "/tmp/notes.txt",
      kind: "file",
      size: 4,
      modified: 1,
    }
    request.responseText = JSON.stringify({ message: "已上传", file: entry })
    request.dispatchEvent(new Event("load"))
    await expect(pending).resolves.toEqual(entry)
    expect(activeWriteCount()).toBe(0)
  })
  it("carries the access password in the Authorization header, not CSRF", async () => {
    document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent("p@ss word")}`
    const pending = uploadFile("/tmp/auth", file())
    const request = UploadRequest.instances[0]
    const entry = {
      name: "notes.txt",
      path: "/tmp/auth/notes.txt",
      kind: "file",
      size: 4,
      modified: 1,
    }
    request.responseText = JSON.stringify({ message: "已上传", file: entry })
    request.dispatchEvent(new Event("load"))
    await expect(pending).resolves.toEqual(entry)
    expect(request.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer p@ss word"
    )
    expect(
      request.setRequestHeader.mock.calls.some(
        ([name]) => name === "x-csrf-token"
      )
    ).toBe(false)
    document.cookie = `${AUTH_COOKIE_NAME}=; path=/; Max-Age=0`
  })

  it("blocks direct retransmission of a target after an unknown result", async () => {
    const pending = uploadFile("/tmp/unresolved", file())
    UploadRequest.instances[0].dispatchEvent(new Event("error"))
    await expect(pending).rejects.toBeInstanceOf(UploadResultUnknownError)
    await expect(uploadFile("/tmp/unresolved", file())).rejects.toBeInstanceOf(
      UploadResultUnknownError
    )
    expect(UploadRequest.instances).toHaveLength(1)
  })
  it("inspects a nested target through a read without resending the upload", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            path: "/tmp/nested",
            entries: [
              {
                name: "notes.txt",
                path: "/tmp/nested/notes.txt",
                kind: "file",
                size: 4,
                modified: 1,
              },
            ],
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await inspectUploadTarget(
      new UploadResultUnknownError("/tmp", "nested/notes.txt", 4)
    )
    expect(result?.path).toBe("/tmp/nested/notes.txt")
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(UploadRequest.instances).toHaveLength(0)
  })
})
