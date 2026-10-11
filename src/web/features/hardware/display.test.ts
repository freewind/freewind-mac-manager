import { describe, expect, it } from "vitest"
import {
  formatHardwareBytes,
  formatHardwareValue,
  hardwareOverviewText,
  maskMacAddress,
  maskSensitiveValue,
} from "./display"

describe("硬件展示格式", () => {
  it("缺失值明确显示未知，并格式化大小", () => {
    expect(formatHardwareValue(null)).toBe("未知")
    expect(formatHardwareBytes(1024 ** 3)).toBe("1.0 GB")
  })

  it("复制和导出文本保留完整数据组并始终遮蔽敏感标识", () => {
    const text = hardwareOverviewText({
      sampledAt: 1,
      machine: {
        modelName: null,
        modelIdentifier: null,
        processorName: null,
        processorSpeed: null,
        physicalCores: null,
        logicalCores: null,
        l2Cache: null,
        l3Cache: null,
        hyperThreading: null,
        memoryTotal: null,
        firmwareVersion: null,
        osLoaderVersion: null,
        uptimeSeconds: null,
        macOSVersion: null,
        build: null,
        architecture: null,
      },
      cpu: {
        brand: null,
        physicalCores: null,
        logicalCores: null,
        architecture: null,
        frequencyMHz: null,
        l2CachePerCore: null,
        l3Cache: null,
      },
      memory: {
        total: null,
        type: null,
        speed: null,
        slots: [],
        swapTotal: null,
        swapUsed: null,
      },
      storage: {
        volumes: [],
        devices: [
          {
            model: null,
            capacity: null,
            trim: null,
            serialNumber: "SERIAL1234",
            mediaName: null,
            smartStatus: null,
          },
        ],
      },
      graphics: { gpus: [], displays: [] },
      network: {
        interfaces: [
          {
            name: null,
            type: null,
            macAddress: "AA:BB:CC:DD:EE:FF",
            ipv4: [],
            ipv6: [],
            status: null,
            speed: null,
            duplex: null,
          },
        ],
        wifi: {
          chipset: null,
          channel: null,
          phyMode: null,
          countryCode: null,
          signalNoise: null,
        },
        bluetooth: {
          chipset: null,
          status: null,
          firmware: null,
          address: null,
        },
      },
      power: {
        hasBattery: null,
        battery: null,
        adapter: { wattage: null, connected: null },
        settings: [],
      },
      peripherals: {
        usbDevices: [],
        audioDevices: [],
        cameras: [],
        cardReaders: [],
      },
      identity: {
        serialNumber: "SERIAL1234",
        hardwareUuid: "UUID1234",
        provisioningUdid: "UDID1234",
      },
    })
    expect(text).toContain("machine")
    expect(text).toContain("••••••1234")
    expect(text).toContain('"macAddress": "•••••••••••••••••"')
    expect(text).not.toContain("SERIAL1234")
    expect(text).not.toContain("UUID1234")
    expect(text).not.toContain("UDID1234")
  })

  it("默认遮蔽敏感值，只保留末四位", () => {
    expect(maskSensitiveValue("F5KCNUZ4P7QM")).toBe("••••••••P7QM")
    expect(maskMacAddress("30:56:0f:09:38:2d")).toBe("•••••••••••••••••")
    expect(maskSensitiveValue("123")).toBe("•••")
  })
})
