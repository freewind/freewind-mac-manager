import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"

it("generates identical versions for identical resources and changes with content", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mac-manager-shell-version-"))
  try {
    mkdirSync(path.join(root, "public"))
    mkdirSync(path.join(root, "dist/assets"), { recursive: true })
    copyFileSync("public/sw.js", path.join(root, "public/sw.js"))
    for (const name of [
      "index.html",
      "manifest.webmanifest",
      "mac-manager-icon.svg",
    ])
      writeFileSync(path.join(root, "dist", name), name)
    writeFileSync(path.join(root, "dist/assets/a.js"), "version1")
    const generate = () => {
      execFileSync(
        process.execPath,
        [
          "--import",
          path.resolve("node_modules/tsx/dist/loader.mjs"),
          path.resolve("scripts/generate-shell.ts"),
        ],
        { cwd: root }
      )
      return readFileSync(path.join(root, "dist/sw.js"), "utf8")
    }
    const first = generate()
    expect(generate()).toBe(first)
    expect(first).not.toContain("__SHELL_VERSION__")
    expect(first).not.toContain("__SHELL_URLS__")
    expect(first).toContain("/assets/a.js")
    writeFileSync(path.join(root, "dist/assets/a.js"), "version2")
    expect(generate()).not.toBe(first)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
