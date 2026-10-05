import type { Metadata } from "next";
import { DEVICE_CATEGORIES, devicesConfig, toDeviceSummary } from "@/lib/codex/entity-configs/devices.config";
import { DevicesBrowser } from "@/components/codex/DevicesBrowser";

export const metadata: Metadata = devicesConfig.generateListMetadata();

export default function DevicesPage() {
  const devices = devicesConfig
    .getAll()
    .map(toDeviceSummary)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-cinzel text-3xl font-bold text-[var(--accent-gold)]">{devicesConfig.displayNamePlural}</h1>
        <p className="text-[var(--text-secondary)]">{devicesConfig.description}</p>
      </div>
      <DevicesBrowser devices={devices} sections={DEVICE_CATEGORIES} />
    </div>
  );
}
