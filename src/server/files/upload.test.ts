import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { afterEach, beforeEach, expect, it } from "vitest"
import { receiveUpload, writeFileContent } from "./service"

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "mac-manager-upload-")))
  mkdirSync(path.join(root, "dest"))
  mkdirSync(path.join(root, "outside"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it("rejects nested symbolic links without writing their target", async () => {
  const dest = path.join(root, "dest")
  symlinkSync(path.join(root, "outside"), path.join(dest, "linked"))
  await expect(
    receiveUpload(dest, "linked/a.txt", Readable.from(["new"]))
  ).rejects.toThrow("符号链接")
})

it("preserves an existing upload fragment", async () => {
  const dest = path.join(root, "dest")
  const fragment = path.join(dest, "a.txt.uploading.part")
  writeFileSync(fragment, "owned by someone else")
  await expect(
    receiveUpload(dest, "a.txt", Readable.from(["new"]))
  ).rejects.toThrow()
  expect(readFileSync(fragment, "utf8")).toBe("owned by someone else")
})

it("does not overwrite a destination created during streaming", async () => {
  const dest = path.join(root, "dest")
  const target = path.join(dest, "a.txt")
  const stream = Readable.from(
    (async function* () {
      yield "new"
      writeFileSync(target, "concurrent")
    })()
  )
  await expect(receiveUpload(dest, "a.txt", stream)).rejects.toThrow()
  expect(readFileSync(target, "utf8")).toBe("concurrent")
})

it("preserves an unrelated writing file while saving content", async () => {
  const target = path.join(root, "dest", "a.txt")
  writeFileSync(target, "old")
  writeFileSync(`${target}.writing`, "unrelated")
  await writeFileContent(target, "new")
  expect(readFileSync(target, "utf8")).toBe("new")
  expect(readFileSync(`${target}.writing`, "utf8")).toBe("unrelated")
})

it("publishes a complete nested upload", async () => {
  const dest = path.join(root, "dest")
  const result = await receiveUpload(
    dest,
    "nested/a.txt",
    Readable.from(["hello"])
  )
  expect(result.size).toBe(5)
  expect(readFileSync(result.path, "utf8")).toBe("hello")
})
