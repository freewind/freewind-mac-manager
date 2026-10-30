import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline as streamPipeline } from "node:stream/promises"
import { MODELS_DIR } from "../src/server/env"

/**
 * 下载浏览器端语音识别用的 whisper 模型到本机。
 *
 * 为什么自托管：模型几十 MB，手机从外网下经常中断，中断后识别会静默失效；
 * 放到应用自己的 /models 下，手机在局域网里下载快且稳定。模型文件不进仓库
 * （data/ 已被忽略），换机器时重新跑一次本脚本即可。
 *
 * 用法：pnpm models:whisper
 */

const REPO = "Xenova/whisper-base"
const BASE = `https://huggingface.co/${REPO}/resolve/main`

/** q8 量化推理实际用到的文件：tokenizer/配置 + 两个 onnx 模型。 */
const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.json",
  "merges.txt",
  "normalizer.json",
  "added_tokens.json",
  "quant_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
]

const TARGET_DIR = path.join(MODELS_DIR, ...REPO.split("/"))

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`

const download = async (file: string): Promise<void> => {
  const target = path.join(TARGET_DIR, file)
  const url = `${BASE}/${file}`
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`下载失败（HTTP ${response.status}）：${url}`)
  }
  const total = Number(response.headers.get("content-length") ?? 0)
  mkdirSync(path.dirname(target), { recursive: true })
  const source = Readable.fromWeb(
    response.body as unknown as Parameters<typeof Readable.fromWeb>[0]
  )
  await streamPipeline(source, createWriteStream(target))
  const size = statSync(target).size
  // 有 Content-Length 时必须一致：半截文件会让识别静默失效。
  if (total > 0 && size !== total) {
    throw new Error(
      `文件不完整：${file}（${formatSize(size)} / ${formatSize(total)}）`
    )
  }
}

const main = async (): Promise<void> => {
  console.log(`[mac-manager] 下载 ${REPO} 到 ${TARGET_DIR}`)
  for (const file of FILES) {
    const target = path.join(TARGET_DIR, file)
    if (existsSync(target) && statSync(target).size > 0) {
      console.log(`  跳过（已存在）：${file}`)
      continue
    }
    const started = Date.now()
    await download(file)
    const size = statSync(target).size
    console.log(
      `  完成：${file}（${formatSize(size)}，${((Date.now() - started) / 1000).toFixed(1)}s）`
    )
  }
  console.log("[mac-manager] 模型就绪，重启或刷新服务后生效")
}

await main()
