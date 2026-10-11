import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { DATABASE_FILE } from "@server/env"
import type {
  CaddyMatchKind,
  CaddyRule,
  CaddyRuleInput,
} from "@shared/api-contract"

/** 应用记录的状态；成功与否决定它是否算「上次成功应用」。 */
export const CADDY_APPLY_SUCCESS = "success"
export const CADDY_APPLY_FAILED = "failed"
/** 结果无法确认（reload 超时、核实请求失败），既不能报成功也不能直接重做。 */
export const CADDY_APPLY_UNKNOWN = "unknown"

/** 一次应用留下的记录：生成文本与当时的规则都存下来，供变化清单对比。 */
export type CaddyApplyRecord = {
  id: string
  appliedAt: number
  status: string
  message: string
  rules: CaddyRule[]
  generatedText: string
  configFingerprint: string
  runningFingerprint: string | null
}

type RuleRow = {
  id: string
  name: string
  note: string
  match_kind: string
  host: string | null
  path_prefix: string | null
  strip_prefix: number
  upstream: string
  enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

type ApplyRow = {
  id: string
  applied_at: number
  status: string
  message: string
  rules_json: string
  generated_text: string
  config_fingerprint: string
  running_fingerprint: string | null
}

const RULE_COLUMNS = `id, name, note, match_kind, host, path_prefix, strip_prefix,
  upstream, enabled, sort_order, created_at, updated_at`

const APPLY_COLUMNS = `id, applied_at, status, message, rules_json, generated_text,
  config_fingerprint, running_fingerprint`

const toRule = (row: RuleRow): CaddyRule => ({
  id: row.id,
  name: row.name,
  note: row.note,
  // 表里是文本列，读回时按契约的联合类型收窄。
  matchKind: row.match_kind === "host" ? "host" : "path",
  host: row.host,
  pathPrefix: row.path_prefix,
  stripPrefix: row.strip_prefix !== 0,
  upstream: row.upstream,
  enabled: row.enabled !== 0,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toApplyRecord = (row: ApplyRow): CaddyApplyRecord => {
  let rules: CaddyRule[] = []
  try {
    const parsed: unknown = JSON.parse(row.rules_json)
    if (Array.isArray(parsed)) rules = parsed as CaddyRule[]
  } catch {
    // 规则只用于对比变化，读不动就当空集合，不让整条记录不可读。
  }
  return {
    id: row.id,
    appliedAt: row.applied_at,
    status: row.status,
    message: row.message,
    rules,
    generatedText: row.generated_text,
    configFingerprint: row.config_fingerprint,
    runningFingerprint: row.running_fingerprint,
  }
}

const insertSql = `INSERT INTO caddy_rule (${RULE_COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const ruleValues = (rule: CaddyRule): (string | number | null)[] => [
  rule.id,
  rule.name,
  rule.note,
  rule.matchKind,
  rule.host,
  rule.pathPrefix,
  rule.stripPrefix ? 1 : 0,
  rule.upstream,
  rule.enabled ? 1 : 0,
  rule.sortOrder,
  rule.createdAt,
  rule.updatedAt,
]

/**
 * Caddy 受管规则与应用记录的存储（node:sqlite，无第三方依赖）。
 *
 * 规则只在这里编辑，配置文件由应用动作按规则重新生成，所以应用记录连生成
 * 文本一起留着，便于对比「上次应用到现在的变化」。
 */
export class CaddyStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    // 页面读、规则写与后台应用可能并发，写操作忙等一小会儿而不是立刻失败。
    this.db = new DatabaseSync(file, { timeout: 5000 })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS caddy_rule (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT NOT NULL,
        match_kind TEXT NOT NULL,
        host TEXT,
        path_prefix TEXT,
        strip_prefix INTEGER NOT NULL,
        upstream TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_caddy_rule_sort ON caddy_rule (sort_order);

      CREATE TABLE IF NOT EXISTS caddy_apply (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        rules_json TEXT NOT NULL,
        generated_text TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        running_fingerprint TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_caddy_apply_applied_at ON caddy_apply (applied_at);
    `)
  }

  close(): void {
    this.db.close()
  }

  /** 多行写入持整次操作的事务，失败整体回滚。 */
  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = run()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
  }

  /** 受管规则，按 sortOrder 升序；顺序即写进文件的顺序。 */
  listRules(): CaddyRule[] {
    const rows = this.db
      .prepare(`SELECT ${RULE_COLUMNS} FROM caddy_rule ORDER BY sort_order, id`)
      .all() as RuleRow[]
    return rows.map(toRule)
  }

  findRule(id: string): CaddyRule | null {
    const row = this.db
      .prepare(`SELECT ${RULE_COLUMNS} FROM caddy_rule WHERE id = ?`)
      .get(id) as RuleRow | undefined
    return row === undefined ? null : toRule(row)
  }

  /** 空表返回 -1，第一条规则就能拿到 sortOrder 0。 */
  maxSortOrder(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM caddy_rule")
      .get() as { value: number }
    return row.value
  }

  /** 按匹配条件查重；修改时要排除自身，传 excludeId。 */
  findRuleByMatch(
    matchKind: CaddyMatchKind,
    host: string | null,
    pathPrefix: string | null,
    excludeId: string | null
  ): CaddyRule | null {
    const sql =
      matchKind === "host"
        ? `SELECT ${RULE_COLUMNS} FROM caddy_rule
           WHERE match_kind = 'host' AND host = ? AND id <> ?`
        : `SELECT ${RULE_COLUMNS} FROM caddy_rule
           WHERE match_kind = 'path' AND path_prefix = ? AND id <> ?`
    const row = this.db
      .prepare(sql)
      .get(matchKind === "host" ? host : pathPrefix, excludeId ?? "") as
      | RuleRow
      | undefined
    return row === undefined ? null : toRule(row)
  }

  createRule(input: CaddyRuleInput): CaddyRule {
    return this.transaction(() => {
      const now = Math.floor(Date.now() / 1000)
      const rule: CaddyRule = {
        id: randomUUID(),
        name: input.name,
        note: input.note,
        matchKind: input.matchKind,
        host: input.host,
        pathPrefix: input.pathPrefix,
        stripPrefix: input.stripPrefix,
        upstream: input.upstream,
        enabled: input.enabled,
        sortOrder: this.maxSortOrder() + 1,
        createdAt: now,
        updatedAt: now,
      }
      this.db.prepare(insertSql).run(...ruleValues(rule))
      return rule
    })
  }

  /** 目标不存在时返回 null，由上层映射 404。 */
  updateRule(id: string, input: CaddyRuleInput): CaddyRule | null {
    const existing = this.findRule(id)
    if (existing === null) return null
    const updated: CaddyRule = {
      ...existing,
      name: input.name,
      note: input.note,
      matchKind: input.matchKind,
      host: input.host,
      pathPrefix: input.pathPrefix,
      stripPrefix: input.stripPrefix,
      upstream: input.upstream,
      enabled: input.enabled,
      // 排序只由创建顺序决定，更新不改顺序。
      updatedAt: Math.floor(Date.now() / 1000),
    }
    this.db
      .prepare(
        `UPDATE caddy_rule SET name = ?, note = ?, match_kind = ?, host = ?,
         path_prefix = ?, strip_prefix = ?, upstream = ?, enabled = ?,
         updated_at = ? WHERE id = ?`
      )
      .run(
        updated.name,
        updated.note,
        updated.matchKind,
        updated.host,
        updated.pathPrefix,
        updated.stripPrefix ? 1 : 0,
        updated.upstream,
        updated.enabled ? 1 : 0,
        updated.updatedAt,
        updated.id
      )
    return updated
  }

  /** 目标不存在时返回 false，由上层映射 404。 */
  deleteRule(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM caddy_rule WHERE id = ?")
      .run(id)
    return Number(result.changes) > 0
  }

  /**
   * 按传入顺序批量导入：匹配条件已存在（含本次已导入的）就跳过。
   * 整个过程一个事务，失败不留半份数据。
   */
  importRules(inputs: CaddyRuleInput[]): { imported: number; skipped: number } {
    return this.transaction(() => {
      const now = Math.floor(Date.now() / 1000)
      let sortOrder = this.maxSortOrder() + 1
      let imported = 0
      let skipped = 0
      for (const input of inputs) {
        const existing = this.findRuleByMatch(
          input.matchKind,
          input.host,
          input.pathPrefix,
          null
        )
        if (existing !== null) {
          skipped += 1
          continue
        }
        const rule: CaddyRule = {
          id: randomUUID(),
          name: input.name,
          note: input.note,
          matchKind: input.matchKind,
          host: input.host,
          pathPrefix: input.pathPrefix,
          stripPrefix: input.stripPrefix,
          upstream: input.upstream,
          enabled: input.enabled,
          sortOrder,
          createdAt: now,
          updatedAt: now,
        }
        this.db.prepare(insertSql).run(...ruleValues(rule))
        sortOrder += 1
        imported += 1
      }
      return { imported, skipped }
    })
  }

  /**
   * 用历史版本的规则整体替换现有规则（恢复用）。
   * 一个事务内先清空再按传入顺序写回，保留 id / 名称 / 备注 / 启停 / 顺序，
   * 只把 updated_at 改成现在：恢复的是一条已经存在的版本，不是新建规则。
   */
  replaceAllRules(rules: CaddyRule[]): void {
    this.transaction(() => {
      this.db.exec("DELETE FROM caddy_rule")
      const now = Math.floor(Date.now() / 1000)
      const statement = this.db.prepare(insertSql)
      for (const rule of rules) {
        statement.run(...ruleValues({ ...rule, updatedAt: now }))
      }
    })
  }

  insertApplyRecord(record: CaddyApplyRecord): void {
    this.db
      .prepare(
        `INSERT INTO caddy_apply (${APPLY_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        record.id,
        record.appliedAt,
        record.status,
        record.message,
        JSON.stringify(record.rules),
        record.generatedText,
        record.configFingerprint,
        record.runningFingerprint
      )
  }

  /** 应用记录倒序，最新在前；同一秒内的多条按写入先后排。 */
  listApplyRecords(): CaddyApplyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${APPLY_COLUMNS} FROM caddy_apply
         ORDER BY applied_at DESC, rowid DESC`
      )
      .all() as ApplyRow[]
    return rows.map(toApplyRecord)
  }

  findApplyRecord(id: string): CaddyApplyRecord | null {
    const row = this.db
      .prepare(`SELECT ${APPLY_COLUMNS} FROM caddy_apply WHERE id = ?`)
      .get(id) as ApplyRow | undefined
    return row === undefined ? null : toApplyRecord(row)
  }

  /** 上次成功应用；失败记录不算，页面据此算「有无未应用变更」。 */
  latestApplyRecord(): CaddyApplyRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${APPLY_COLUMNS} FROM caddy_apply WHERE status = ?
         ORDER BY applied_at DESC, rowid DESC LIMIT 1`
      )
      .get(CADDY_APPLY_SUCCESS) as ApplyRow | undefined
    return row === undefined ? null : toApplyRecord(row)
  }
}

let singleton: CaddyStore | null = null

/**
 * 应用内共用一个连接：SQLite 单库多连接会放大锁竞争，
 * 测试则直接 new CaddyStore(临时文件) 注入。
 */
export const getCaddyStore = (): CaddyStore => {
  singleton ??= new CaddyStore(DATABASE_FILE)
  return singleton
}
