import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileDiff,
  FileImage,
  FileJson,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
} from "lucide-react"

/** 扩展名（小写、不含点）到图标的映射；未收录的走通用兜底。 */
const EXTENSION_ICONS: Record<string, LucideIcon> = {
  // 代码与标记
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  py: FileCode,
  rb: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  kt: FileCode,
  c: FileCode,
  h: FileCode,
  cpp: FileCode,
  hpp: FileCode,
  sh: FileCode,
  bash: FileCode,
  zsh: FileCode,
  css: FileCode,
  scss: FileCode,
  html: FileCode,
  vue: FileCode,
  svelte: FileCode,
  // 结构化数据
  json: FileJson,
  jsonc: FileJson,
  json5: FileJson,
  // 图片
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  bmp: FileImage,
  ico: FileImage,
  avif: FileImage,
  // 视频
  mp4: FileVideo,
  mov: FileVideo,
  avi: FileVideo,
  mkv: FileVideo,
  webm: FileVideo,
  // 音频
  mp3: FileAudio,
  wav: FileAudio,
  flac: FileAudio,
  m4a: FileAudio,
  ogg: FileAudio,
  // 压缩包与磁盘映像
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  tgz: FileArchive,
  bz2: FileArchive,
  xz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
  dmg: FileArchive,
  // 表格
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  ods: FileSpreadsheet,
  // 文本与配置
  md: FileText,
  markdown: FileText,
  txt: FileText,
  log: FileText,
  pdf: FileText,
  rtf: FileText,
  yml: FileText,
  yaml: FileText,
  toml: FileText,
  ini: FileText,
  conf: FileText,
  env: FileText,
  // 差异文件
  diff: FileDiff,
  patch: FileDiff,
}

/**
 * 目录用文件夹图标，文件按扩展名取图标；
 * 未收录的扩展名与无扩展名的可执行/构建文件用问号兜底，不猜成文本。
 */
export const fileTypeIcon = (
  kind: "dir" | "file",
  name: string
): LucideIcon => {
  if (kind === "dir") return Folder
  // 无后缀的点文件（.env、.gitignore）按文本处理，不当成未知扩展
  if (name.startsWith(".") && !name.slice(1).includes(".")) return FileText
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return FileQuestion
  return EXTENSION_ICONS[name.slice(dot + 1).toLowerCase()] ?? FileQuestion
}

export const PLAIN_FILE_ICON: LucideIcon = File
