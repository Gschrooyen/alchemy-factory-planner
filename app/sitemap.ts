import { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { itemsConfig } from "@/lib/codex/entity-configs/items.config";
import { devicesConfig } from "@/lib/codex/entity-configs/devices.config";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/items`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
  ];

  // Dynamic item pages
  const itemPages: MetadataRoute.Sitemap = itemsConfig.getAll().map((item) => ({
    url: `${baseUrl}/items/${item.id}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const devicePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/devices`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    ...devicesConfig.getAll().map((d) => ({
      url: `${baseUrl}/devices/${d.id}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  return [...staticPages, ...itemPages, ...devicePages];
}
