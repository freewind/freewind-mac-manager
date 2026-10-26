import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@web/components/ui/tabs"
import { useState } from "react"
import { GeoIpPanel } from "./GeoIpPanel"
import { GeoSitePanel } from "./GeoSitePanel"
import { AsnPanel, CountryPanel } from "./MmdbPanel"

/** 四份 GEO 数据：文件名就是判断依据，不需要再起别名。 */
const FILES = [
  { key: "geosite", label: "geosite.dat" },
  { key: "geoip", label: "geoip.dat" },
  { key: "country", label: "Country.mmdb" },
  { key: "asn", label: "ASN.mmdb" },
] as const

type FileKey = (typeof FILES)[number]["key"]

/**
 * 规则数据库：内核用的四份 GEO 数据放一页，页内用 tab 分开。
 *
 * 它们都是只读的二进制数据，用途相近（分类与 IP 归属），
 * 拆成四个顶级标签会把标签栏挤满，合起来才好找。
 */
export const GeoDatabasesPanel = () => {
  const [file, setFile] = useState<FileKey>("geosite")
  return (
    <Tabs value={file} onValueChange={(next) => setFile(next as FileKey)}>
      <TabsList className="w-full">
        {FILES.map((item) => (
          <TabsTrigger key={item.key} value={item.key}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="geosite">
        <GeoSitePanel />
      </TabsContent>
      <TabsContent value="geoip">
        <GeoIpPanel />
      </TabsContent>
      <TabsContent value="country">
        <CountryPanel />
      </TabsContent>
      <TabsContent value="asn">
        <AsnPanel />
      </TabsContent>
    </Tabs>
  )
}
