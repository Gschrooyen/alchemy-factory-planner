import Link from "next/link";
import { Coins, Flame, Hammer } from "lucide-react";
import { OrnatePanel } from "@/components/ui/OrnatePanel";

/** Plain data for a device card, built on the server so the client list stays light. */
export interface DeviceSummary {
  id: string;
  name: string;
  category: string;
  makes: string[]; // distinct product names
  materials: { name: string; count: number }[];
  coins: number;
  heat?: string; // short heat line, e.g. "Burns 270 heat/s" or "Gives 4 heat/s · 42 slots"
}

const MAX_PRODUCTS = 4;

export function DeviceCard({ device }: { device: DeviceSummary }) {
  const extra = device.makes.length - MAX_PRODUCTS;
  return (
    <Link href={`/devices/${device.id}`} className="h-full">
      <OrnatePanel className="p-4 h-full" hoverGlow>
        <div className="flex flex-col gap-3 h-full">
          <h3 className="font-cinzel font-semibold text-[var(--text-primary)]">{device.name}</h3>

          {device.makes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {device.makes.slice(0, MAX_PRODUCTS).map((name) => (
                <span
                  key={name}
                  className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-purple)]/10 text-[var(--text-secondary)] border border-[var(--accent-purple)]/20"
                >
                  {name}
                </span>
              ))}
              {extra > 0 && <span className="text-xs px-1 py-0.5 text-[var(--text-muted)]">+{extra} more</span>}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] italic">Support building</p>
          )}

          <div className="mt-auto flex flex-col gap-1.5 text-xs text-[var(--text-muted)]">
            {device.materials.length > 0 && (
              <div className="flex items-start gap-1.5">
                <Hammer className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent-gold-dim)]" />
                <span>{device.materials.map((m) => `${m.count}× ${m.name}`).join(", ")}</span>
              </div>
            )}
            {device.coins > 0 && (
              <div className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-[var(--accent-gold)]" />
                <span className="text-[var(--text-secondary)]">≈ {device.coins.toLocaleString("en-US")}</span>
              </div>
            )}
            {device.heat && (
              <div className="flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-[var(--accent-gold-dim)]" />
                <span>{device.heat}</span>
              </div>
            )}
          </div>
        </div>
      </OrnatePanel>
    </Link>
  );
}
