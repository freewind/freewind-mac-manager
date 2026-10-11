import { describe, expect, it } from "vitest"
import { __hardwareTestUtils } from "./collect"

const sample = {
  SPHardwareDataType: [
    {
      _name: "hardware_overview",
      machine_name: "Mac Pro",
      machine_model: "MacPro7,1",
      cpu_type: "AMD Ryzen™ 7 9700X",
      current_processor_speed: "3.8 GHz",
      l2_cache_core: "1 MB",
      l3_cache: "32 MB",
      physical_memory: "64 GB",
      boot_rom_version: "2069.0.0.0.0",
      serial_number: "F5KCNUZ4P7QM",
      platform_UUID: "926E5C35-FEDC-5307-BCF0-93B8D82148B2",
      provisioning_UDID: "926E5C35-FEDC-5307-BCF0-93B8D82148B2",
    },
  ],
  SPDisplaysDataType: [
    {
      _name: "AMD Radeon RX 570",
      "spdisplays_device-id": "0x67df",
      spdisplays_vendor: "sppci_vendor_amd",
      spdisplays_vram: "4 GB",
      spdisplays_pcie_width: "x16",
      sppci_model: "AMD Radeon RX 570",
      spdisplays_ndrvs: [
        {
          _name: "DELL U2723QX",
          spdisplays_resolution: "1920 x 1080 @ 60.00Hz",
          spdisplays_main: "spdisplays_yes",
        },
      ],
    },
  ],
  SPMemoryDataType: [
    {
      _items: [
        {
          _name: "P0 CHANNEL A/DIMM 0",
          dimm_size: "empty",
          dimm_speed: "empty",
          dimm_status: "empty",
          dimm_type: "empty",
        },
        {
          _name: "P0 CHANNEL A/DIMM 1",
          dimm_size: "32 GB",
          dimm_speed: "6000 MHz",
          dimm_status: "ok",
          dimm_type: "RAM",
        },
      ],
    },
  ],
  SPStorageDataType: [
    {
      _name: "Mac - 数据",
      file_system: "APFS",
      mount_point: "/System/Volumes/Data",
      size_in_bytes: 2_000_083_292_160,
      free_space_in_bytes: 368_685_473_792,
      writable: "yes",
      physical_drive: {
        media_name: "AppleAPFSMedia",
        smart_status: "Verified",
      },
    },
  ],
  SPNVMeDataType: [
    {
      _items: [
        {
          _name: "WDC WDS200T2B0C-00PXH0",
          device_model: "WDC WDS200T2B0C-00PXH0",
          device_serial: "20505D805298",
          size_in_bytes: 2_000_398_934_016,
          smart_status: "Verified",
          spnvme_trim_support: "Yes",
        },
      ],
    },
  ],
  SPNetworkDataType: [
    {
      _name: "Ethernet",
      interface: "en1",
      hardware: "Ethernet",
      Ethernet: {
        "MAC Address": "30:56:0f:09:38:2d",
        MediaOptions: ["full-duplex"],
        MediaSubType: "1000baseT",
      },
      IPv4: { Addresses: ["192.168.1.59"] },
      IPv6: { Addresses: ["fe80::1"] },
    },
  ],
  SPPowerDataType: [
    {
      _name: "sppower_information",
      "AC Power": { "Current Power Source": "TRUE" },
    },
  ],
  SPBluetoothDataType: [
    {
      controller_properties: {
        controller_chipset: "BCM_4350C2",
        controller_state: "attrib_off",
        controller_firmwareVersion: "v0 c0",
        controller_address: "NULL",
      },
    },
  ],
  SPUSBDataType: [
    {
      _items: [
        {
          _name: "Wired Gaming keyboard",
          manufacturer: "SONiX",
          product_id: "0x505e",
          vendor_id: "0x320f",
          device_speed: "full_speed",
          bus_power_used: "400",
        },
      ],
    },
  ],
  SPAudioDataType: [
    {
      _items: [
        {
          _name: "Built-in Output",
          coreaudio_device_manufacturer: "Apple Inc.",
          coreaudio_device_output: 2,
          coreaudio_device_srate: 44100,
          coreaudio_device_transport: "coreaudio_device_type_builtin",
        },
      ],
    },
  ],
  SPCameraDataType: [],
  SPCardReaderDataType: [],
}

const extras = {
  sysctl: {
    "hw.machine": "x86_64",
    "hw.physicalcpu": "8",
    "hw.logicalcpu": "16",
    "hw.memsize": "68719476736",
    "hw.l2cachesize": "1048576",
    "hw.l3cachesize": "33554432",
    "kern.boottime": "{ sec = 1790859633, usec = 458105 }",
    "vm.swapusage": "vm.swapusage: total = 0.00M used = 0.00M",
    "machdep.cpu.brand_string": "AMD Ryzen 7 9700X 8-Core Processor",
    "machdep.cpu.features": "FPU HTT AVX2",
  },
  swVers: "ProductVersion: 15.7.1\nBuildVersion: 24G90\n",
  df: "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1 1953200000 1592000000 361200000 82% /System/Volumes/Data",
}

describe("parseProfilerJson", () => {
  it("解析本机 system_profiler 样本", () => {
    const parsed = __hardwareTestUtils.parseProfilerJson(sample, extras)
    expect({
      machine: {
        ...parsed.machine,
        uptimeSeconds: null,
        memoryTotal: null,
      },
      cpu: parsed.cpu,
      memory: parsed.memory,
      storage: parsed.storage,
      graphics: parsed.graphics,
      network: parsed.network,
      power: parsed.power,
      peripherals: parsed.peripherals,
      identity: parsed.identity,
    }).toMatchInlineSnapshot(`
      {
        "cpu": {
          "architecture": "x86_64",
          "brand": "AMD Ryzen 7 9700X 8-Core Processor",
          "frequencyMHz": 3800,
          "l2CachePerCore": "1 MB",
          "l3Cache": "32 MB",
          "logicalCores": 16,
          "physicalCores": 8,
        },
        "graphics": {
          "displays": [
            {
              "connection": null,
              "isMain": true,
              "name": "DELL U2723QX",
              "refreshRateHz": 60,
              "resolution": "1920 x 1080",
              "sizeInches": null,
            },
          ],
          "gpus": [
            {
              "bus": null,
              "cores": null,
              "deviceId": "0x67df",
              "memory": 4294967296,
              "model": "AMD Radeon RX 570",
              "pcieWidth": 16,
              "vendor": "sppci_vendor_amd",
            },
          ],
        },
        "identity": {
          "hardwareUuid": "926E5C35-FEDC-5307-BCF0-93B8D82148B2",
          "provisioningUdid": "926E5C35-FEDC-5307-BCF0-93B8D82148B2",
          "serialNumber": "F5KCNUZ4P7QM",
        },
        "machine": {
          "architecture": "x86_64",
          "build": "24G90",
          "firmwareVersion": "2069.0.0.0.0",
          "hyperThreading": true,
          "l2Cache": "1 MB",
          "l3Cache": "32 MB",
          "logicalCores": 16,
          "macOSVersion": "macOS 15.7.1",
          "memoryTotal": null,
          "modelIdentifier": "MacPro7,1",
          "modelName": "Mac Pro",
          "osLoaderVersion": null,
          "physicalCores": 8,
          "processorName": "AMD Ryzen™ 7 9700X",
          "processorSpeed": "3.8 GHz",
          "uptimeSeconds": null,
        },
        "memory": {
          "slots": [
            {
              "capacity": null,
              "name": "P0 CHANNEL A/DIMM 0",
              "speed": null,
              "status": "empty",
              "type": null,
            },
            {
              "capacity": 34359738368,
              "name": "P0 CHANNEL A/DIMM 1",
              "speed": "6000 MHz",
              "status": "ok",
              "type": "RAM",
            },
          ],
          "speed": "6000 MHz",
          "swapTotal": 0,
          "swapUsed": 0,
          "total": 68719476736,
          "type": null,
        },
        "network": {
          "bluetooth": {
            "address": null,
            "chipset": "BCM_4350C2",
            "firmware": "v0 c0",
            "status": "attrib_off",
          },
          "interfaces": [
            {
              "duplex": "full-duplex",
              "ipv4": [
                "192.168.1.59",
              ],
              "ipv6": [
                "fe80::1",
              ],
              "macAddress": "30:56:0f:09:38:2d",
              "name": "en1",
              "speed": "1000baseT",
              "status": "已连接",
              "type": "Ethernet",
            },
          ],
          "wifi": {
            "channel": null,
            "chipset": null,
            "countryCode": null,
            "phyMode": null,
            "signalNoise": null,
          },
        },
        "peripherals": {
          "audioDevices": [
            {
              "name": "Built-in Output",
              "outputChannels": 2,
              "sampleRate": 44100,
              "transport": "coreaudio_device_type_builtin",
              "vendor": "Apple Inc.",
            },
          ],
          "cameras": [],
          "cardReaders": [],
          "usbDevices": [
            {
              "name": "Wired Gaming keyboard",
              "power": "400",
              "productId": "0x505e",
              "serialNumber": null,
              "speed": "full_speed",
              "vendor": "SONiX",
            },
          ],
        },
        "power": {
          "adapter": {
            "connected": true,
            "wattage": null,
          },
          "battery": null,
          "hasBattery": false,
          "settings": [
            "Current Power Source: TRUE",
          ],
        },
        "storage": {
          "devices": [
            {
              "capacity": 2000398934016,
              "mediaName": "WDC WDS200T2B0C-00PXH0",
              "model": "WDC WDS200T2B0C-00PXH0",
              "serialNumber": "20505D805298",
              "smartStatus": "Verified",
              "trim": true,
            },
          ],
          "volumes": [
            {
              "available": 368685473792,
              "fileSystem": "APFS",
              "mountPoint": "/System/Volumes/Data",
              "name": "Mac - 数据",
              "total": 2000083292160,
              "used": 1631397818368,
              "writable": true,
            },
          ],
        },
      }
    `)
  })

  it("字段缺失时返回 null 或空集合", () => {
    const parsed = __hardwareTestUtils.parseProfilerJson(
      {},
      {
        sysctl: {},
        swVers: "",
        df: "",
      }
    )
    expect(parsed).toMatchObject({
      machine: {
        modelName: null,
        modelIdentifier: null,
        processorName: null,
        memoryTotal: null,
      },
      memory: { slots: [], total: null, swapTotal: null, swapUsed: null },
      storage: { volumes: [], devices: [] },
      graphics: { gpus: [], displays: [] },
      network: {
        interfaces: [],
        wifi: { chipset: null },
        bluetooth: { chipset: null },
      },
      power: { hasBattery: false, battery: null },
      peripherals: {
        usbDevices: [],
        audioDevices: [],
        cameras: [],
        cardReaders: [],
      },
      identity: {
        serialNumber: null,
        hardwareUuid: null,
        provisioningUdid: null,
      },
    })
  })
})
