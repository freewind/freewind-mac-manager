import {
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileQuestion,
  FileText,
  Folder,
} from "lucide-react"
import { describe, expect, it } from "vitest"
import { fileTypeIcon } from "./file-icon"

describe("文件类型图标映射", () => {
  it("目录一律用文件夹图标", () => {
    expect(fileTypeIcon("dir", "src")).toBe(Folder)
    expect(fileTypeIcon("dir", "src.tar.gz")).toBe(Folder)
  })

  it("按扩展名给出对应图标，大小写与双后缀都能识别", () => {
    expect(fileTypeIcon("file", "a.ts")).toBe(FileCode)
    expect(fileTypeIcon("file", "A.JSON")).toBe(FileJson)
    expect(fileTypeIcon("file", "archive.tar.gz")).toBe(FileArchive)
    expect(fileTypeIcon("file", "photo.PNG")).toBe(FileImage)
  })

  it("无后缀点文件按文本，无后缀与未知扩展名走兜底", () => {
    expect(fileTypeIcon("file", ".env")).toBe(FileText)
    expect(fileTypeIcon("file", ".gitignore")).toBe(FileText)
    expect(fileTypeIcon("file", "weird.xyz")).toBe(FileQuestion)
    expect(fileTypeIcon("file", "Makefile")).toBe(FileQuestion)
  })
})
