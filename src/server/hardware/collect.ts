import { execFile } from "node:child_process"
import os from "node:os"
import { promisify } from "node:util"
import type { HardwareOverview } from "@shared/api-contract"

const execFileAsync = promisify(execFile)
const TTL_MS = 300_000
const MAX_BUFFER = 16 * 1024 * 1024
const DATA_TYPES = [
  "SPHardwareDataType",
  "SPDisplaysDataType",
  "SPMemoryDataType",
  "SPStorageDataType",
  "SPNVMeDataType",
  "SPPowerDataType",
  "SPNetworkDataType",
  "SPAirPortDataType",
  "SPUSBDataType",
  "SPAudioDataType",
  "SPBluetoothDataType",
  "SPCameraDataType",
  "SPCardReaderDataType",
] as const

type RecordValue = Record<string, unknown>
type ProfilerData = Record<string, unknown>
type CacheEntry = { expiresAt: number; value: Promise<HardwareOverview> }

const cache = new Map<string, CacheEntry>()

const run = async (command: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: 10_000,
  })
  return stdout
}

const record = (value: unknown): RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : {}

const text = (value: unknown): string | null => {
  if (Array.isArray(value))
    return value.map(text).filter(Boolean).join(", ") || null
  if (typeof value !== "string") return null
  const result = value.trim()
  return result && result !== "empty" && result !== "NULL" ? result : null
}

const statusText = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const result = value.trim()
  return result && result !== "NULL" ? result : null
}

const number = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

const bytes = (value: unknown): number | null => {
  const direct = number(value)
  if (direct === null) return null
  if (typeof value === "string" && /\bKB\b/i.test(value)) return direct * 1024
  if (typeof value === "string" && /\bMB\b/i.test(value))
    return direct * 1024 ** 2
  if (typeof value === "string" && /\bGB\b/i.test(value))
    return direct * 1024 ** 3
  if (typeof value === "string" && /\bTB\b/i.test(value))
    return direct * 1024 ** 4
  return direct
}

const truth = (value: unknown): boolean | null => {
  if (value === true || value === "Yes" || value === "yes" || value === "TRUE")
    return true
  if (value === false || value === "No" || value === "no" || value === "FALSE")
    return false
  return null
}

const list = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.map(record) : []

const section = (data: ProfilerData, key: string): RecordValue[] =>
  list(data[key])

const deepItems = (values: RecordValue[]): RecordValue[] => {
  const found: RecordValue[] = []
  const visit = (value: RecordValue): void => {
    found.push(value)
    for (const child of list(value._items)) visit(child)
  }
  values.forEach(visit)
  return found
}

const parseResolution = (value: unknown): string | null => {
  const match = text(value)?.match(/\d+\s*x\s*\d+/i)
  return match?.[0] ?? null
}

const parseRefreshRate = (value: unknown): number | null => {
  const match = text(value)?.match(/@\s*([\d.]+)\s*Hz/i)
  return match ? Number(match[1]) : null
}

const parseProfilerJson = (
  input: unknown,
  extras: { sysctl: Record<string, string>; swVers: string; df: string }
): HardwareOverview => {
  const data = record(input)
  const hardware = section(data, "SPHardwareDataType")[0] ?? {}
  const displays = section(data, "SPDisplaysDataType")
  const memoryGroups = section(data, "SPMemoryDataType")
  const storageEntries = section(data, "SPStorageDataType")
  const nvmeDevices = deepItems(section(data, "SPNVMeDataType")).filter(
    (item) =>
      item.device_model !== undefined || item.device_serial !== undefined
  )
  const networkEntries = section(data, "SPNetworkDataType")
  const wifiEntry = section(data, "SPAirPortDataType")[0] ?? {}
  const wifiInfo = record(wifiEntry.spairport_airport_card_type)
  const bluetooth = section(data, "SPBluetoothDataType")[0] ?? {}
  const bluetoothController = record(bluetooth.controller_properties)
  const powerEntries = section(data, "SPPowerDataType")
  const power = powerEntries.find((item) => item["AC Power"] !== undefined)?.[
    "AC Power"
  ]
  const powerRecord = record(power)
  const version = /ProductVersion:\s*(\S+)/.exec(extras.swVers)?.[1] ?? null
  const build = /BuildVersion:\s*(\S+)/.exec(extras.swVers)?.[1] ?? null
  const architecture = text(extras.sysctl["hw.machine"]) ?? os.arch()
  const processor = text(hardware.cpu_type)
  const physicalCores = number(extras.sysctl["hw.physicalcpu"])
  const logicalCores = number(extras.sysctl["hw.logicalcpu"])
  const cpuFeatures = extras.sysctl["machdep.cpu.features"] ?? ""
  const displayRecords = displays.flatMap((gpu) => list(gpu.spdisplays_ndrvs))
  const memorySlots = deepItems(memoryGroups).filter(
    (item) => item.dimm_status !== undefined || item.dimm_size !== undefined
  )
  const usbDevices = deepItems(section(data, "SPUSBDataType")).filter(
    (item) => item.product_id !== undefined || item.vendor_id !== undefined
  )
  const audioDevices = deepItems(section(data, "SPAudioDataType")).filter(
    (item) => item.coreaudio_device_manufacturer !== undefined
  )
  const volumes = storageEntries.map((volume) => {
    const total = number(volume.size_in_bytes)
    const available = number(volume.free_space_in_bytes)
    return {
      name: text(volume._name),
      mountPoint: text(volume.mount_point),
      fileSystem: text(volume.file_system),
      total,
      used: total !== null && available !== null ? total - available : null,
      available,
      writable: truth(volume.writable),
    }
  })
  const dfByMount = new Map<
    string,
    { used: number; available: number; total: number }
  >()
  for (const line of extras.df.split("\n").slice(1)) {
    const match =
      /^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+\S+\s+\S+\s+\d+%\s+(.+)$/.exec(
        line.trim()
      )
    if (match) {
      dfByMount.set(match[4], {
        total: Number(match[1]) * 1024,
        used: Number(match[2]) * 1024,
        available: Number(match[3]) * 1024,
      })
    }
  }
  for (const volume of volumes) {
    const disk = volume.mountPoint
      ? dfByMount.get(volume.mountPoint)
      : undefined
    if (disk) Object.assign(volume, disk)
  }
  const interfaces = networkEntries.map((item) => {
    const ethernet = record(item.Ethernet)
    const ipv4 = record(item.IPv4)
    const ipv6 = record(item.IPv6)
    return {
      name: text(item.interface),
      type: text(item.hardware) ?? text(item.type),
      macAddress: text(ethernet["MAC Address"]),
      ipv4: Array.isArray(ipv4.Addresses)
        ? ipv4.Addresses.map(text).filter(
            (entry): entry is string => entry !== null
          )
        : Array.isArray(item.ip_address)
          ? item.ip_address
              .map(text)
              .filter((entry): entry is string => entry !== null)
          : [],
      ipv6: Array.isArray(ipv6.Addresses)
        ? ipv6.Addresses.map(text).filter(
            (entry): entry is string => entry !== null
          )
        : [],
      status: text(ethernet.MediaOptions)?.includes("full-duplex")
        ? "已连接"
        : text(ethernet.MediaSubType),
      speed: text(ethernet.MediaSubType),
      duplex: text(ethernet.MediaOptions),
    }
  })
  const gpuList = displays.map((gpu) => ({
    model: text(gpu.sppci_model) ?? text(gpu._name),
    vendor: text(gpu.spdisplays_vendor),
    deviceId: text(gpu["spdisplays_device-id"]),
    memory: bytes(gpu.spdisplays_vram),
    bus: text(gpu.sppci_bus),
    pcieWidth: number(gpu.spdisplays_pcie_width),
    cores: null,
  }))
  const batteryPresent = powerEntries.some(
    (entry) => entry.Battery !== undefined
  )
  const batteryData = record(
    powerEntries.find((entry) => entry.Battery !== undefined)?.Battery
  )
  const usb = usbDevices.map((item) => ({
    name: text(item._name),
    vendor: text(item.manufacturer) ?? text(item.vendor_id),
    productId: text(item.product_id),
    serialNumber: text(item.serial_num),
    speed: text(item.device_speed),
    power: text(item.bus_power_used),
  }))
  const smartDevices = nvmeDevices.map((item) => {
    const model = text(item.device_model) ?? text(item._name)
    const matchingVolume = storageEntries.find(
      (volume) => text(record(volume.physical_drive).device_name) === model
    )
    const physicalDrive = record(matchingVolume?.physical_drive)
    return {
      model,
      capacity: bytes(item.size_in_bytes) ?? bytes(item.size),
      trim: truth(item.spnvme_trim_support),
      serialNumber: text(item.device_serial),
      mediaName: text(physicalDrive.media_name) ?? text(item._name),
      smartStatus: text(item.smart_status),
    }
  })
  const swap = extras.sysctl["vm.swapusage"] ?? ""
  const cacheL2 =
    text(hardware.l2_cache_core) ??
    bytes(extras.sysctl["hw.l2cachesize"])?.toString() ??
    null
  const cacheL3 =
    text(hardware.l3_cache) ??
    bytes(extras.sysctl["hw.l3cachesize"])?.toString() ??
    null
  const frequencyText = text(hardware.current_processor_speed)
  const frequencyGHz = frequencyText?.match(/([\d.]+)\s*GHz/i)
  const firmware = text(hardware.boot_rom_version)
  const uptime = extras.sysctl["kern.boottime"]
  const bootSeconds = uptime ? Number(/sec = (\d+)/.exec(uptime)?.[1]) : NaN
  const provisioning = text(hardware.provisioning_UDID)
  return {
    sampledAt: Date.now(),
    machine: {
      modelName: text(hardware.machine_name),
      modelIdentifier: text(hardware.machine_model),
      processorName: processor,
      processorSpeed: text(hardware.current_processor_speed),
      physicalCores,
      logicalCores,
      l2Cache: cacheL2,
      l3Cache: cacheL3,
      hyperThreading: cpuFeatures ? /\bHTT\b/.test(cpuFeatures) : null,
      memoryTotal:
        bytes(hardware.physical_memory) ?? number(extras.sysctl.hw_memsize),
      firmwareVersion: firmware,
      osLoaderVersion: text(hardware.os_loader_version),
      uptimeSeconds: Number.isFinite(bootSeconds)
        ? Math.max(0, Math.floor(Date.now() / 1000 - bootSeconds))
        : null,
      macOSVersion: version ? `macOS ${version}` : null,
      build,
      architecture,
    },
    cpu: {
      brand: extras.sysctl["machdep.cpu.brand_string"]?.trim() || processor,
      physicalCores,
      logicalCores,
      architecture,
      frequencyMHz: frequencyGHz
        ? Number(frequencyGHz[1]) * 1000
        : number(frequencyText),
      l2CachePerCore: cacheL2,
      l3Cache: cacheL3,
    },
    memory: {
      total:
        bytes(hardware.physical_memory) ?? number(extras.sysctl.hw_memsize),
      type: text(memoryGroups[0]?.global_name),
      speed: memorySlots.find((slot) => text(slot.dimm_speed))
        ? text(memorySlots.find((slot) => text(slot.dimm_speed))?.dimm_speed)
        : null,
      slots: memorySlots.map((slot) => ({
        name: text(slot._name),
        capacity: bytes(slot.dimm_size),
        type: text(slot.dimm_type),
        speed: text(slot.dimm_speed),
        status: statusText(slot.dimm_status),
      })),
      swapTotal:
        number(/total = ([\d.]+)M/.exec(swap)?.[1]) === null
          ? null
          : Number(/total = ([\d.]+)M/.exec(swap)?.[1]) * 1024 ** 2,
      swapUsed:
        number(/used = ([\d.]+)M/.exec(swap)?.[1]) === null
          ? null
          : Number(/used = ([\d.]+)M/.exec(swap)?.[1]) * 1024 ** 2,
    },
    storage: { volumes, devices: smartDevices },
    graphics: {
      gpus: gpuList,
      displays: displayRecords.map((display) => ({
        name: text(display._name),
        resolution: parseResolution(display.spdisplays_resolution),
        refreshRateHz: parseRefreshRate(display.spdisplays_resolution),
        sizeInches: null,
        connection: null,
        isMain: text(display.spdisplays_main) === "spdisplays_yes",
      })),
    },
    network: {
      interfaces,
      wifi: {
        chipset: text(wifiInfo["Card Type"]),
        channel: null,
        phyMode: null,
        countryCode: null,
        signalNoise: null,
      },
      bluetooth: {
        chipset: text(bluetoothController.controller_chipset),
        status: text(bluetoothController.controller_state),
        firmware: text(bluetoothController.controller_firmwareVersion),
        address: text(bluetoothController.controller_address),
      },
    },
    power: {
      hasBattery: batteryPresent,
      battery: batteryPresent
        ? {
            cycleCount: number(batteryData.cycle_count),
            condition: text(batteryData.condition),
            healthPercent: number(batteryData.health),
            maximumCapacity: bytes(batteryData.capacity),
            currentCapacity: bytes(batteryData.charge),
            isCharging: truth(batteryData.charging),
          }
        : null,
      adapter: {
        wattage: null,
        connected: truth(powerRecord["Current Power Source"]),
      },
      settings: Object.entries(powerRecord).map(
        ([key, value]) => `${key}: ${String(value)}`
      ),
    },
    peripherals: {
      usbDevices: usb,
      audioDevices: audioDevices.map((item) => ({
        name: text(item._name),
        vendor: text(item.coreaudio_device_manufacturer),
        outputChannels: number(item.coreaudio_device_output),
        sampleRate: number(item.coreaudio_device_srate),
        transport: text(item.coreaudio_device_transport),
      })),
      cameras: deepItems(section(data, "SPCameraDataType"))
        .map((item) => text(item._name))
        .filter((item): item is string => item !== null),
      cardReaders: deepItems(section(data, "SPCardReaderDataType"))
        .map((item) => text(item._name))
        .filter((item): item is string => item !== null),
    },
    identity: {
      serialNumber: text(hardware.serial_number),
      hardwareUuid: text(hardware.platform_UUID),
      provisioningUdid: provisioning,
    },
  }
}

const collect = async (): Promise<HardwareOverview> => {
  const [profilerText, swVers, df, sysctlValues] = await Promise.all([
    run("/usr/sbin/system_profiler", ["-json", ...DATA_TYPES]),
    run("/usr/bin/sw_vers", []).catch(() => ""),
    run("/bin/df", ["-k"]).catch(() => ""),
    Promise.all(
      [
        "hw.machine",
        "hw.model",
        "hw.physicalcpu",
        "hw.logicalcpu",
        "hw.memsize",
        "hw.l2cachesize",
        "hw.l3cachesize",
        "kern.boottime",
        "vm.swapusage",
        "machdep.cpu.brand_string",
        "machdep.cpu.features",
      ].map(
        async (name) =>
          [
            name,
            await run("/usr/sbin/sysctl", ["-n", name]).catch(() => ""),
          ] as const
      )
    ),
  ])
  let parsed: unknown
  try {
    parsed = JSON.parse(profilerText) as unknown
  } catch {
    parsed = {}
  }
  return parseProfilerJson(parsed, {
    sysctl: Object.fromEntries(sysctlValues),
    swVers,
    df,
  })
}

export const collectHardwareOverview = (): Promise<HardwareOverview> => {
  const now = Date.now()
  const hit = cache.get("overview")
  if (hit && hit.expiresAt > now) return hit.value
  const value = collect()
  cache.set("overview", { expiresAt: now + TTL_MS, value })
  void value.catch(() => {
    if (cache.get("overview")?.value === value) cache.delete("overview")
  })
  return value
}

export const __hardwareTestUtils = { parseProfilerJson }
