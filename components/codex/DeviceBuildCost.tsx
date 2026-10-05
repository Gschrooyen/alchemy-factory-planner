import Link from "next/link";
import { Coins, Hammer } from "lucide-react";
import type { Device } from "@/engine/types";
import { getBuildCost } from "@/lib/codex/entity-configs/devices.config";
import { OrnatePanel } from "@/components/ui/OrnatePanel";

export function DeviceBuildCost({ device }: { device: Device }) {
  const { materials, coins } = getBuildCost(device);
  return (
    <OrnatePanel className="p-5 h-full">
      <div className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 font-cinzel text-lg text-[var(--accent-gold)]">
          <Hammer className="w-4 h-4" /> Building cost
        </h2>
        {materials.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No building cost in the game data.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {materials.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  {m.item ? (
                    <Link href={`/items/${m.item.id}`} className="text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors">
                      {m.item.name}
                    </Link>
                  ) : (
                    <span className="text-[var(--text-primary)]">{m.id}</span>
                  )}
                  <span className="font-mono text-[var(--text-secondary)]">×{m.count}</span>
                </li>
              ))}
            </ul>
            {coins > 0 && (
              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--border)] text-sm">
                <span className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Coins className="w-4 h-4 text-[var(--accent-gold)]" /> Materials value
                </span>
                <span className="font-mono text-[var(--accent-gold)]">≈ {coins.toLocaleString("en-US")}</span>
              </div>
            )}
          </>
        )}
      </div>
    </OrnatePanel>
  );
}
