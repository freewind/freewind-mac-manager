import { execFile } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { MODELS_DIR } from "../src/server/env"

/**
 * 下载本机语音识别用的 sherpa-onnx 与 Paraformer 中文模型。
 *
 * 只在服务端跑：手机浏览器不加载模型，只上传录音。二进制与模型都不进仓库
 * （data/ 已被忽略），换机器时重新跑一次本脚本即可。
 *
 * 用法：pnpm models:sherpa
 */

const run = promisify(execFile)

const VERSION = "v1.13.6"
const PACKAGE = `sherpa-onnx-${VERSION}-osx-universal2-static.tar.bz2`
const PACKAGE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}/${PACKAGE}`
const BIN_IN_TAR = `${PACKAGE.replace(/\.tar\.bz2$/, "")}/bin/sherpa-onnx-offline`

const MODEL_ARCHIVE =
  "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_ARCHIVE}`
const MODEL_DIR_IN_TAR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"

const TARGET_DIR = path.join(MODELS_DIR, "sherpa")
const BIN_PATH = path.join(TARGET_DIR, "bin", "sherpa-onnx-offline")
const PARA_DIR = path.join(TARGET_DIR, "sense-voice")

const formatSize = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)}MB`

/** 已存在且大小合理就跳过：整包近 500MB，没必要每次重下。 */
const ensureFile = (target: string, minBytes: number): boolean =>
  existsSync(target) && statSync(target).size >= minBytes

const download = async (url: string, target: string): Promise<void> => {
  console.log(`  下载 ${path.basename(target)}…`)
  await run(
    "curl",
    ["-fL", "--retry", "3", "--continue-at", "-", "-o", target, url],
    {
      maxBuffer: 1024 * 1024,
    }
  )
}

const extract = async (
  archive: string,
  member: string,
  outDir: string
): Promise<void> => {
  await run("tar", ["-xjf", archive, "-C", outDir, member], {
    maxBuffer: 1024 * 1024,
  })
}

const main = async (): Promise<void> => {
  mkdirSync(path.join(TARGET_DIR, "bin"), { recursive: true })
  mkdirSync(PARA_DIR, { recursive: true })

  const work = await mkdtemp(path.join(tmpdir(), "mac-manager-sherpa-"))
  try {
    if (ensureFile(BIN_PATH, 40 * 1024 * 1024)) {
      console.log(`  跳过（已存在）：${BIN_PATH}`)
    } else {
      const archive = path.join(work, PACKAGE)
      await download(PACKAGE_URL, archive)
      await extract(archive, BIN_IN_TAR, work)
      copyFileSync(path.join(work, BIN_IN_TAR), BIN_PATH)
      chmodSync(BIN_PATH, 0o755)
      await rm(archive, { force: true })
      console.log(
        `  完成：sherpa-onnx-offline（${formatSize(statSync(BIN_PATH).size)}）`
      )
    }

    const modelPath = path.join(PARA_DIR, "model.int8.onnx")
    const tokensPath = path.join(PARA_DIR, "tokens.txt")
    if (ensureFile(modelPath, 100 * 1024 * 1024) && existsSync(tokensPath)) {
      console.log(`  跳过（已存在）：${modelPath}`)
    } else {
      const archive = path.join(work, MODEL_ARCHIVE)
      await download(MODEL_URL, archive)
      await extract(archive, `${MODEL_DIR_IN_TAR}/model.int8.onnx`, work)
      await extract(archive, `${MODEL_DIR_IN_TAR}/tokens.txt`, work)
      copyFileSync(
        path.join(work, MODEL_DIR_IN_TAR, "model.int8.onnx"),
        modelPath
      )
      copyFileSync(path.join(work, MODEL_DIR_IN_TAR, "tokens.txt"), tokensPath)
      await rm(archive, { force: true })
      console.log(
        `  完成：sense-voice（${formatSize(statSync(modelPath).size)}）`
      )
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  console.log("[mac-manager] 语音识别组件就绪，重启服务后生效")
}

await main()
