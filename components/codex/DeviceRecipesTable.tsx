import Link from "next/link";
import { Clock } from "lucide-react";
import type { Recipe } from "@/engine/types";
import { getItemByName } from "@/lib/codex/entity-configs/items.config";
import { formatRate, ratesPerMinute } from "@/lib/codex/entity-configs/devices.config";

function ItemRate({ name, perMinute, percentage, strong }: { name: string; perMinute: number; percentage?: number | string; strong?: boolean }) {
  const item = getItemByName(name);
  const label = (
    <span className={strong ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"}>{name}</span>
  );
  return (
    <div className="flex items-baseline justify-between gap-3">
      {item ? (
        <Link href={`/items/${item.id}`} className="hover:text-[var(--accent-gold)] transition-colors">
          {label}
        </Link>
      ) : (
        label
      )}
      <span className="font-mono text-xs whitespace-nowrap text-[var(--text-muted)]">
        {formatRate(perMinute)}/min{percentage ? ` (${percentage}%)` : ""}
      </span>
    </div>
  );
}

const formatTime = (s: number) => (s < 60 ? `${Number(s.toFixed(1))}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${Math.round(s % 60)}s` : ""}`);

/** What one machine makes per minute and what it eats, per recipe. */
export function DeviceRecipesTable({ recipes }: { recipes: Recipe[] }) {
  const rows = recipes
    .map((r) => ({ recipe: r, ...ratesPerMinute(r) }))
    .sort((a, b) => a.outputs[0].name.localeCompare(b.outputs[0].name));

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-sm border-separate border-spacing-0 min-w-[560px]">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
            <th className="font-normal pb-2 pr-6">Produces</th>
            <th className="font-normal pb-2 pr-6">Consumes</th>
            <th className="font-normal pb-2 text-right">Cycle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ recipe, outputs, inputs }) => (
            <tr key={recipe.id} className="align-top">
              <td className="py-3 pr-6 border-t border-[var(--border)]">
                <div className="flex flex-col gap-1">
                  {outputs.map((o) => (
                    <ItemRate key={o.name} {...o} strong />
                  ))}
                </div>
              </td>
              <td className="py-3 pr-6 border-t border-[var(--border)]">
                <div className="flex flex-col gap-1">
                  {inputs.length ? inputs.map((i) => <ItemRate key={i.name} {...i} />) : <span className="text-[var(--text-muted)]">Nothing</span>}
                </div>
              </td>
              <td className="py-3 border-t border-[var(--border)] text-right whitespace-nowrap text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {formatTime(recipe.time)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
