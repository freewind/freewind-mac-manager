/**
 * 合并配置里固定的三条 GEO 分流：国内直连、国外走代理。
 *
 * 页面固定展示、不入库；用户自定义的分类规则排在它们前面，方便先命中特例。
 * 分类在 geosite.dat 里不存在时直接跳过，不让默认规则挡住合并。
 */
export const DEFAULT_GEOSITE_RULES = [
  { code: "CN", target: "direct" },
  { code: "GEOLOCATION-CN", target: "direct" },
  { code: "GEOLOCATION-!CN", target: "proxy" },
] as const
