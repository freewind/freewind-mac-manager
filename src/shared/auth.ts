/**
 * 访问密码 cookie 的唯一名称来源，前后端共用。
 *
 * 必须带项目前缀：cookie 只按 host 存、端口不隔离，本机同时跑多个本地项目时
 * 同名 cookie 会互相覆盖、顶掉登录态。服务端读它、前端写它，都从这里取。
 */
export const AUTH_COOKIE_NAME = "mac_manager_access_token"
