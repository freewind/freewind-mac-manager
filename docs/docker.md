# Docker 页（经 Colima）

这份文档说明 Docker 域的用途、端点语义、危险动作与缓存处理，以及哪些行为还没有验证。

## 用途与边界

把本机 Docker（macOS 上由 Colima 提供虚拟机）的容器、镜像、卷、网络与 Colima 状态集中到网页，
手机默认可用、桌面显示更多信息。页面只调用本机服务，不引入多用户与权限体系。

页面按分区展示：容器 / 镜像 / 卷 / 网络，分区状态放在 URL 的 `tab` 参数里
（`?feature=docker&tab=images`），刷新、分享链接与浏览器返回都能恢复到原分区。

## 执行层与数据来源

| 数据 | 命令 |
| --- | --- |
| 容器列表 | `docker ps -aq` + `docker inspect <id...>`（取挂载、端口、启动时间）；`docker ps -a --format json` 只补 `Status` 文本与名称 |
| 容器日志 | `docker logs --tail (tail+1) <id>` |
| 镜像 | `docker images --format json`；磁盘占用取 `docker system df` 的 Images 行 |
| 卷 | `docker volume ls` / `docker volume inspect`；大小取 `docker system df -v` 的 VOLUME NAME/SIZE 表 |
| 网络 | `docker network ls`；接入容器数由容器列表交叉统计 |
| Colima | `colima status`（运行态与 runtime/arch） |

所有外部命令都以数组参数传给 `execFile`，不拼接 shell 文本；命令有超时与输出上限。
解析不到的数值返回 `null` 或「未知」，不编造：容器挂载路径来自 `inspect`（`ps` 的 Mounts
会被列宽截断），启动时间零值（`0001-01-01T00:00:00Z`）映射为 `null`，拉取进度里的字节
拿不到就是 `null`。

## 端点与语义

只读（GET，200）：

- `/api/docker/overview` 概览：Colima 状态、容器/镜像/卷/网络计数与镜像占用
- `/api/docker/containers` 容器列表
- `/api/docker/containers/logs?containerId=&tail=&since=` 容器日志（不做轮询）
- `/api/docker/images`、`/api/docker/volumes`、`/api/docker/networks`
- `/api/docker/colima` Colima 状态

写操作（都要求 `x-task-request-id` 请求标识）：容器 start/stop/restart/kill 用
`POST /api/docker/containers/action`，删除容器用 `DELETE /api/docker/container`，
新建容器用 `POST /api/docker/containers`，镜像拉取 `POST /api/docker/images/pull`、
删除 `DELETE /api/docker/image`，卷与网络删除用 `DELETE /api/docker/volume` 与
`DELETE /api/docker/network`，Colima 动作用 `POST /api/docker/colima/action`。

状态码按语义使用：

| 码 | 含义 |
| --- | --- |
| `200` | 读取成功，或动作已完成并返回结果（`ActionResponse` 只有 message） |
| `201` | 新建容器成功，返回 `{containerId, name, message}` |
| `202` | 超过响应阈值（默认 5 秒）仍在执行，返回受理回执与任务标识 |
| `400` | 入参非法（契约校验，例如非法镜像引用、请求标识过短） |
| `404` | 容器不存在（提交前核实过） |
| `409` | 状态冲突：容器名被占用、本地没有该镜像、删除运行中容器未加 force、镜像被容器引用、卷被容器使用、网络仍有容器接入、内置网络（bridge/host/none）、Colima 已在运行或未在运行 |
| `500` | Docker 未运行、命令超时或未预期失败，对外只给中文说明 |

写操作的可信度来自**重新读取**：容器动作后 `docker inspect` 核实状态，删除后核实目标已消失，
拉取后核实镜像确实落地，Colima 动作用 `colima status` 核实。命令退出码为 0 不等于状态真的变了：
状态没变时如实报错（例如「容器 X 仍在运行，停止命令未生效」），不谎报成功。

## 危险动作

删除容器、镜像、卷、网络与停止/重启 Colima 都要经过确认对话框，标题与正文写明对象、数量
与影响：删除运行中的容器必须显式选择「强制删除容器 X」（默认不带 `-f`）；终止（kill）说明
会立刻 SIGKILL、进程没有清理机会；停止/重启 Colima 说明会影响正在运行的容器数量。
前端禁用只是体验层，后端仍会二次校验：内置网络直接拒绝且不发命令，删除运行中容器未带 force
返回 409，被容器引用的镜像与被使用的卷由 docker 拒绝后映射为 409。

## 任务、幂等与结果未知

写操作经统一任务运行时（kind `docker_action` / `docker_colima_action`）：请求标识由客户端生成，
同一标识重发复用同一个任务、不会第二次执行；同一对象（`docker:container:<id>`、
`docker:image:<ref>`、`docker:volume:<name>`、`docker:network:<id>`、`docker:colima`）同时只有一个
任务，不同对象可并行。请求超时或连接中断只表示结果未知：界面不提示成功、不自动重发，
由重新读取目标核实；任务中心展示真实进度，拉取进度按「层」计数，字节解析不到就是 null。

## 缓存与失效

只读列表有短 TTL 缓存（容器 3 秒、镜像/卷/网络/info 10 秒、colima 状态 5 秒、version 60 秒），
避免页面轮询把机器压满。写操作会改变真实状态，因此在两处失效：执行层（`cli` 的每个写命令成功后）
与父进程 HTTP 入口（写请求提交前），失效范围是 `docker:` 前缀。原因是动作在任务子进程里执行，
子进程的缓存失效影响不到父进程，只做一边会让「拉取完成」「新建成功」之后紧接着的列表读到旧值。

## 验证状态

- 已通过自动化检查：契约与 15 条端点的挂载、任务链路的幂等与同目标冲突、危险动作的后端校验、
  缓存失效、前端组件的加载/空/错误三态、危险确认文案与 409 持续展示。
- 已做真机冒烟（一次性资源，用后清理）：概览计数、容器动作链（创建→停止→启动→日志→删除）、
  被引用镜像与在用卷的 409、内置网络 409、Colima 运行中 start 返回 409。
- **Colima 的 stop 与 restart 未做真机验证**：会停掉本机正在运行的容器，只由单元测试覆盖。
- **浏览器实测未做**：320px 横向溢出、触控目标像素、键盘可达性、真实点击手势（分区切换、
  对话框、Select、Sheet）均未在真实浏览器里验证，也未做 PWA 安装后的表现验证。
- 被容器引用、被使用的判定依赖 docker 的报错文案；docker 改文案时冲突会退化成 500 中文提示
  （不会误删），需要同步调整识别规则。
