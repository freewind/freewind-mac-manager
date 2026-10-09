import type { TreeNode } from "@shared/api-contract"
import { formatBytes } from "@shared/format"
import { useSubtree } from "@web/features/disk-growth/queries"
import { useDiskGrowthLocalStore } from "@web/features/disk-growth/store"
import { useMemo, useState } from "react"

const ROW_HEIGHT = 22
const MAX_DEPTH = 4
const VIEW_WIDTH = 1000
const MIN_WIDTH = 2

type Block = {
  path: string
  name: string
  size: number
  depth: number
  start: number
  width: number
  hue: number
  lightness: number
}

/**
 * 同一层把色相均匀铺满色环，区分度拉满；
 * 每往下一层整体再旋转一点，避免上下层撞色。
 */
const hueFor = (index: number, siblings: number, depth: number): number =>
  Math.round((360 * index) / Math.max(1, siblings) + depth * 37 + index * 6) %
  360

/** 把子树逐层铺开：同一层宽度都等于根宽，每个节点按大小切走父节点的宽度。 */
const buildBlocks = (root: TreeNode): Block[] => {
  const blocks: Block[] = []

  const walk = (
    node: TreeNode,
    start: number,
    width: number,
    depth: number
  ) => {
    const children = node.children.filter((child) => child.size > 0)
    const total = children.reduce((sum, child) => sum + child.size, 0)

    if (depth >= MAX_DEPTH || total <= 0) return

    let cursor = start
    children.forEach((child, index) => {
      const childWidth = (child.size / total) * width
      if (childWidth < MIN_WIDTH) {
        cursor += childWidth
        return
      }
      blocks.push({
        path: child.path,
        name: child.name,
        size: child.size,
        depth: depth + 1,
        start: cursor,
        width: childWidth,
        hue: hueFor(index, children.length, depth + 1),
        lightness: 58,
      })
      walk(child, cursor, childWidth, depth + 1)
      cursor += childWidth
    })
  }

  blocks.push({
    path: root.path,
    name: root.name,
    size: root.size,
    depth: 0,
    start: 0,
    width: VIEW_WIDTH,
    hue: 215,
    lightness: 62,
  })
  walk(root, 0, VIEW_WIDTH, 0)
  return blocks
}

type IcicleChartProps = {
  scanId: number | null
  baselineScanId: number | null
}

/** 分布图：一层一行，行的宽度等于该行的根，父子之间按大小切分宽度。 */
export const IcicleChart = ({ scanId, baselineScanId }: IcicleChartProps) => {
  const focus = useDiskGrowthLocalStore((state) => state.focusPath)
  const stack = useDiskGrowthLocalStore((state) => state.focusStack)
  const enterFocus = useDiskGrowthLocalStore((state) => state.enterFocus)
  const leaveFocus = useDiskGrowthLocalStore((state) => state.leaveFocus)
  const [hovered, setHovered] = useState<string | null>(null)

  const { root: tree } = useSubtree({
    scanId,
    baselineScanId,
    path: focus,
    depth: MAX_DEPTH + 1,
  })
  const blocks = useMemo(() => (tree ? buildBlocks(tree) : []), [tree])
  const maxDepth = useMemo(
    () => blocks.reduce((deepest, block) => Math.max(deepest, block.depth), 0),
    [blocks]
  )
  const chartHeight = (maxDepth + 1) * ROW_HEIGHT

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
        <button
          type="button"
          className="rounded px-1 hover:bg-accent disabled:opacity-40"
          disabled={stack.length === 0}
          onClick={leaveFocus}
        >
          ← 返回上层
        </button>
        <span className="text-muted-foreground">
          当前根：{focus === "" ? "/" : focus} ·{" "}
          {tree ? formatBytes(tree.size) : "—"}
        </span>
        {hovered ? (
          <span className="ml-auto text-muted-foreground">{hovered}</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tree ? (
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${chartHeight}`}
            width="100%"
            height={chartHeight}
            className="select-none"
          >
            <title>磁盘占用分布图</title>
            {blocks.map((block) => {
              const x = (block.start / VIEW_WIDTH) * VIEW_WIDTH
              const active = hovered === block.path
              return (
                <g key={block.path}>
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG rect is the interactive chart cell. */}
                  <rect
                    x={x}
                    y={block.depth * ROW_HEIGHT}
                    width={Math.max(0, block.width - 1)}
                    height={ROW_HEIGHT - 2}
                    rx={2}
                    fill={`hsl(${block.hue} 68% ${active ? block.lightness - 14 : block.lightness}%)`}
                    className="cursor-pointer transition-colors"
                    role="button"
                    tabIndex={0}
                    aria-label={`${block.path}，${formatBytes(block.size)}`}
                    onKeyDown={(event) => {
                      if (
                        (event.key === "Enter" || event.key === " ") &&
                        block.depth !== 0
                      ) {
                        enterFocus(block.path)
                      }
                    }}
                    onMouseEnter={() =>
                      setHovered(`${block.path} · ${formatBytes(block.size)}`)
                    }
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => {
                      if (block.depth === 0) return
                      enterFocus(block.path)
                    }}
                  />
                  {block.width > 52 ? (
                    <text
                      x={x + 4}
                      y={block.depth * ROW_HEIGHT + 14}
                      className="pointer-events-none fill-white"
                      fontSize={10}
                    >
                      {`${block.name} · ${formatBytes(block.size)}`.slice(
                        0,
                        Math.floor(block.width / 6)
                      )}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : (
          <p className="text-sm text-muted-foreground">没有可展示的目录。</p>
        )}
      </div>
    </div>
  )
}
