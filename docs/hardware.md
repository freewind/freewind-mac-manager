# 硬件页

## 行为与接口

硬件页只读，不执行弹盘、SMC/NVRAM 重置、磁盘修复或其他硬件写操作。页面不自动轮询；用户可手动刷新。概览页继续负责每 3 秒采集 CPU、内存与网络实时状态，硬件页仅显示硬件配置及低频变化数据。

- 端点：`GET /api/hardware/overview`
- 缓存：服务端硬件概览缓存 300 秒；前端 TanStack Query `staleTime` 为 300 秒。
- 时间：`sampledAt` 是毫秒时间戳。
- 数据结构：`machine`、`cpu`、`memory`、`storage`、`graphics`、`network`、`power`、`peripherals`、`identity` 九组。

## 数据来源

| 数据 | 数据源 |
| --- | --- |
| 整机、CPU、固件、内存插槽、GPU、显示器、卷、NVMe、网络接口、蓝牙、电源、USB、音频、摄像头与读卡器 | `system_profiler -json` 的 `SPHardwareDataType`、`SPDisplaysDataType`、`SPMemoryDataType`、`SPStorageDataType`、`SPNVMeDataType`、`SPPowerDataType`、`SPNetworkDataType`、`SPAirPortDataType`、`SPUSBDataType`、`SPAudioDataType`、`SPBluetoothDataType`、`SPCameraDataType`、`SPCardReaderDataType` |
| CPU 型号、核心数、缓存、机器架构、内存大小、开机时间、Swap | `sysctl -n`：`hw.machine`、`hw.physicalcpu`、`hw.logicalcpu`、`hw.memsize`、`hw.l2cachesize`、`hw.l3cachesize`、`kern.boottime`、`vm.swapusage`、`machdep.cpu.brand_string`、`machdep.cpu.features` |
| macOS 版本和 Build | `sw_vers` |
| 卷使用量 | `df -k` 与 `system_profiler` 卷信息合并 |

外部命令有 10 秒超时和 16 MiB 输出上限。解析逻辑位于硬件域纯函数，可用采集样本独立测试。缺失、不支持或无法识别的数值返回 `null`；集合返回空数组。采集失败时接口返回 500，不伪造成功数据。

## 敏感信息

服务端返回序列号、Hardware UUID、Provisioning UDID 与 MAC 地址完整值。界面显示“含敏感信息”，上述字段默认遮蔽，可按字段点击显示。复制与导出包含九组完整字段，但敏感标识仍遮蔽，避免绕开页面默认保护。

## 本机降级与观察结果

本机为黑苹果，系统报告机型标识 `MacPro7,1`，CPU `AMD Ryzen 7 9700X`，GPU `AMD Radeon RX 570`。按本机采集事实处理，不做跨平台推测：

- 无电池：`power.hasBattery` 为 `false`，电池对象为 `null`。
- 摄像头与读卡器未报告设备：各自为空数组。
- 蓝牙设备存在但状态为关闭；芯片与固件仍按系统报告显示。
- Wi-Fi 芯片、频道、PHY、国家码和信号噪声在本机数据源不可确认时显示未知。
- 内存插槽中系统报告为空的插槽容量、类型、速度为 `null`，状态保留为 `empty`。
- 显示器尺寸、连接类型及 GPU 核心数由当前系统数据源缺失时显示未知，不推断规格。

## 验证状态

- 后端采集、端点、解析降级、TTL 缓存与九组 schema 已通过自动化检查。
- 尚未由专用浏览器执行者验证 320px 与桌面视口、页面溢出、控件交互及请求是否仅由手动刷新触发。
- PWA 安装后表现与真实手机触控未验证。
