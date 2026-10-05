import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cog, Flame } from "lucide-react";
import {
  categoryLabel,
  devicesConfig,
  getDeviceById,
  getDeviceRecipes,
  getRecipeSource,
  heatLine,
} from "@/lib/codex/entity-configs/devices.config";
import { OrnatePanel } from "@/components/ui/OrnatePanel";
import { DeviceBuildCost } from "@/components/codex/DeviceBuildCost";
import { DeviceRecipesTable } from "@/components/codex/DeviceRecipesTable";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Devices whose recipes live in a dedicated tool rather than the recipe data. */
const TOOL_PAGES: Record<string, { href: string; label: string }> = {
  "advanced-cauldron": { href: "/advanced-cauldron", label: "Advanced Cauldron brew explorer" },
};

export async function generateStaticParams() {
  return devicesConfig.getAll().map((d) => ({ id: d.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const device = devicesConfig.getById((await params).id);
  return device ? devicesConfig.generateDetailMetadata(device) : { title: "Device Not Found" };
}

export default async function DevicePage({ params }: PageProps) {
  const device = devicesConfig.getById((await params).id);
  if (!device) notFound();

  const recipes = getDeviceRecipes(device);
  const source = getRecipeSource(device);
  const sourceDevice = source && getDeviceById(source.from);
  const parent = device.parent ? getDeviceById(device.parent) : undefined;
  const heat = heatLine(device);
  const tool = TOOL_PAGES[device.id];

  return (
    <div className="flex flex-col max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 gap-6">
      <Link
        href="/devices"
        className="inline-flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Devices
      </Link>

      <OrnatePanel className="p-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-cinzel text-3xl font-bold text-[var(--accent-gold)]">{device.name}</h1>
            <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded-full border border-[var(--accent-purple)]/30 text-[var(--accent-purple)]">
              {categoryLabel(device.category)}
            </span>
          </div>
          {device.description && <p className="text-[var(--text-secondary)] leading-relaxed">{device.description}</p>}
        </div>
      </OrnatePanel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DeviceBuildCost device={device} />
        <OrnatePanel className="p-5 h-full" accentColor="purple">
          <div className="flex flex-col gap-4">
            <h2 className="flex items-center gap-2 font-cinzel text-lg text-[var(--accent-gold)]">
              <Flame className="w-4 h-4" /> Heat & placement
            </h2>
            {heat ? (
              <p className="text-sm text-[var(--text-secondary)]">{heat}.</p>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Needs no heat. Place it anywhere on the factory floor.</p>
            )}
            {parent && (
              <p className="text-sm text-[var(--text-muted)]">
                Built on top of a{" "}
                <Link href={`/devices/${parent.id}`} className="text-[var(--accent-gold)] hover:underline">
                  {parent.name}
                </Link>
                , which supplies its heat.
              </p>
            )}
          </div>
        </OrnatePanel>
      </div>

      <OrnatePanel className="p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 font-cinzel text-lg text-[var(--accent-gold)]">
              <Cog className="w-4 h-4" /> Can make
              {recipes.length > 0 && <span className="text-sm font-sans text-[var(--text-muted)]">({recipes.length})</span>}
            </h2>
            {recipes.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                Rates are for one machine at base skills. Factory Efficiency research speeds every machine up
                {device.id.includes("nursery") ? "; better fertilizer makes it grow faster" : ""}.
              </p>
            )}
            {sourceDevice && (
              <p className="text-xs text-[var(--text-muted)]">
                Runs the same recipes as the{" "}
                <Link href={`/devices/${sourceDevice.id}`} className="text-[var(--accent-gold)] hover:underline">
                  {sourceDevice.name}
                </Link>
                {source.speed !== 1 ? ` at ${source.speed}× speed` : ""}. {source.note ?? ""}
              </p>
            )}
          </div>
          {recipes.length > 0 ? (
            <DeviceRecipesTable recipes={recipes} />
          ) : tool ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Its brews depend on what you put in. Work them out with the{" "}
              <Link href={tool.href} className="text-[var(--accent-gold)] hover:underline">
                {tool.label}
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              This is a support building: it doesn&apos;t produce goods itself.
            </p>
          )}
        </div>
      </OrnatePanel>
    </div>
  );
}
