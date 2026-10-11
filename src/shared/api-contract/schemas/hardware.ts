import { z } from "zod"

const NullableText = z.string().nullable()
const NullableNumber = z.number().nullable()

export const HardwareMachineSchema = z.object({
  modelName: NullableText,
  modelIdentifier: NullableText,
  processorName: NullableText,
  processorSpeed: NullableText,
  physicalCores: NullableNumber,
  logicalCores: NullableNumber,
  l2Cache: NullableText,
  l3Cache: NullableText,
  hyperThreading: z.boolean().nullable(),
  memoryTotal: NullableNumber,
  firmwareVersion: NullableText,
  osLoaderVersion: NullableText,
  uptimeSeconds: NullableNumber,
  macOSVersion: NullableText,
  build: NullableText,
  architecture: NullableText,
})

export const HardwareCpuSchema = z.object({
  brand: NullableText,
  physicalCores: NullableNumber,
  logicalCores: NullableNumber,
  architecture: NullableText,
  frequencyMHz: NullableNumber,
  l2CachePerCore: NullableText,
  l3Cache: NullableText,
})

export const HardwareMemorySlotSchema = z.object({
  name: NullableText,
  capacity: NullableNumber,
  type: NullableText,
  speed: NullableText,
  status: NullableText,
})

export const HardwareMemorySchema = z.object({
  total: NullableNumber,
  type: NullableText,
  speed: NullableText,
  slots: z.array(HardwareMemorySlotSchema),
  swapTotal: NullableNumber,
  swapUsed: NullableNumber,
})

export const HardwareVolumeSchema = z.object({
  name: NullableText,
  mountPoint: NullableText,
  fileSystem: NullableText,
  total: NullableNumber,
  used: NullableNumber,
  available: NullableNumber,
  writable: z.boolean().nullable(),
})

export const HardwareStorageDeviceSchema = z.object({
  model: NullableText,
  capacity: NullableNumber,
  trim: z.boolean().nullable(),
  serialNumber: NullableText,
  mediaName: NullableText,
  smartStatus: NullableText,
})

export const HardwareStorageSchema = z.object({
  volumes: z.array(HardwareVolumeSchema),
  devices: z.array(HardwareStorageDeviceSchema),
})

export const HardwareGpuSchema = z.object({
  model: NullableText,
  vendor: NullableText,
  deviceId: NullableText,
  memory: NullableNumber,
  bus: NullableText,
  pcieWidth: NullableNumber,
  cores: NullableNumber,
})

export const HardwareDisplaySchema = z.object({
  name: NullableText,
  resolution: NullableText,
  refreshRateHz: NullableNumber,
  sizeInches: NullableNumber,
  connection: NullableText,
  isMain: z.boolean().nullable(),
})

export const HardwareGraphicsSchema = z.object({
  gpus: z.array(HardwareGpuSchema),
  displays: z.array(HardwareDisplaySchema),
})

export const HardwareNetworkInterfaceSchema = z.object({
  name: NullableText,
  type: NullableText,
  macAddress: NullableText,
  ipv4: z.array(z.string()),
  ipv6: z.array(z.string()),
  status: NullableText,
  speed: NullableText,
  duplex: NullableText,
})

export const HardwareWifiSchema = z.object({
  chipset: NullableText,
  channel: NullableText,
  phyMode: NullableText,
  countryCode: NullableText,
  signalNoise: NullableText,
})

export const HardwareBluetoothSchema = z.object({
  chipset: NullableText,
  status: NullableText,
  firmware: NullableText,
  address: NullableText,
})

export const HardwareNetworkSchema = z.object({
  interfaces: z.array(HardwareNetworkInterfaceSchema),
  wifi: HardwareWifiSchema,
  bluetooth: HardwareBluetoothSchema,
})

export const HardwareBatterySchema = z.object({
  cycleCount: NullableNumber,
  condition: NullableText,
  healthPercent: NullableNumber,
  maximumCapacity: NullableNumber,
  currentCapacity: NullableNumber,
  isCharging: z.boolean().nullable(),
})

export const HardwarePowerAdapterSchema = z.object({
  wattage: NullableNumber,
  connected: z.boolean().nullable(),
})

export const HardwarePowerSchema = z.object({
  hasBattery: z.boolean().nullable(),
  battery: HardwareBatterySchema.nullable(),
  adapter: HardwarePowerAdapterSchema,
  settings: z.array(z.string()),
})

export const HardwareUsbDeviceSchema = z.object({
  name: NullableText,
  vendor: NullableText,
  productId: NullableText,
  serialNumber: NullableText,
  speed: NullableText,
  power: NullableText,
})

export const HardwareAudioDeviceSchema = z.object({
  name: NullableText,
  vendor: NullableText,
  outputChannels: NullableNumber,
  sampleRate: NullableNumber,
  transport: NullableText,
})

export const HardwarePeripheralSchema = z.object({
  usbDevices: z.array(HardwareUsbDeviceSchema),
  audioDevices: z.array(HardwareAudioDeviceSchema),
  cameras: z.array(z.string()),
  cardReaders: z.array(z.string()),
})

export const HardwareIdentitySchema = z.object({
  serialNumber: NullableText,
  hardwareUuid: NullableText,
  provisioningUdid: NullableText,
})

/** 硬件页仅包含详细配置及低频变化信息；sampledAt 为毫秒时间戳。 */
export const HardwareOverviewSchema = z.object({
  sampledAt: z.number(),
  machine: HardwareMachineSchema,
  cpu: HardwareCpuSchema,
  memory: HardwareMemorySchema,
  storage: HardwareStorageSchema,
  graphics: HardwareGraphicsSchema,
  network: HardwareNetworkSchema,
  power: HardwarePowerSchema,
  peripherals: HardwarePeripheralSchema,
  identity: HardwareIdentitySchema,
})
