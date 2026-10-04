import { LayoutList } from "lucide-react";
import { OrnatePanel } from "../ui/OrnatePanel";
import { toCoins } from "../../lib/coins";

interface IOSummaryPanelProps {
    stats: {
        totalMachines: number;
        totalPower: number;
    };
    ioSummary: {
        cost: number; // copper per minute
        seedCost: number; // copper, once
        seeds: { name: string; count: number }[];
        inputs: { name: string; rate: number }[];
        outputs: { name: string; rate: number }[];
    };
}

export function IOSummaryPanel({ stats, ioSummary }: IOSummaryPanelProps) {
    return (
        <OrnatePanel className="p-4 flex flex-col gap-4" accentColor="gold">
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-[var(--accent-gold)] flex items-center gap-2 text-xs uppercase tracking-wider">
                    <LayoutList size={14} className="text-[var(--accent-purple)]" /> Summary
                </h3>
                <div className="flex gap-3 items-center bg-[var(--background-deep)]/80 px-3 py-2 rounded-lg border border-[var(--border-subtle)]">
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider font-bold">
                            Machines
                        </span>
                        <span className="text-sm font-mono text-[var(--accent-gold-bright)] font-bold">
                            {stats.totalMachines.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                            })}
                        </span>
                    </div>
                    <div className="w-[1px] h-6 bg-gradient-to-b from-transparent via-[var(--accent-gold-dim)] to-transparent"></div>
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider font-bold">
                            Heat
                        </span>
                        <span className="text-sm font-mono text-[var(--warning)] font-bold">
                            {stats.totalPower.toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs bg-[var(--background-deep)]/60 px-3 py-2 rounded-lg border border-[var(--border-subtle)]" title="Bought raw inputs at their portal price. Available resources and fuel/fertilizer you don't produce here count as free (they come from outside this factory); nursery seeds are planted once and not counted.">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Cost</span>
                <CoinAmount copper={ioSummary.cost} suffix="/min" />
            </div>

            {ioSummary.seeds.length > 0 && (
                <div className="flex flex-col gap-1 text-xs bg-[var(--background-deep)]/60 px-3 py-2 rounded-lg border border-[var(--border-subtle)]" title="Nursery seeds are planted once per nursery and not used up: a one-time build cost">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Plant once</span>
                        <CoinAmount copper={ioSummary.seedCost} suffix="once" />
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-[var(--text-secondary)]">
                        {ioSummary.seeds.map((s) => (
                            <span key={s.name}>{s.name} <span className="font-mono text-[var(--accent-gold)]">×{s.count}</span></span>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar grid grid-cols-2 gap-4 content-start">
                {/* Inputs */}
                <div>
                    <div className="divider-ornate mb-2"></div>
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase block mb-2 tracking-wide">
                        Inputs
                    </span>
                    <div className="space-y-1.5">
                        {ioSummary.inputs.length > 0 ? (
                            ioSummary.inputs.map((item, i) => (
                                <div key={i} className="flex justify-between text-xs bg-[var(--background-deep)]/40 px-2 py-1 rounded">
                                    <span className="text-[var(--text-secondary)]">{item.name}</span>
                                    <span className="text-[var(--accent-gold)] font-mono">
                                        {item.rate.toFixed(1)}/m
                                    </span>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs text-[var(--text-muted)] italic">None</span>
                        )}
                    </div>
                </div>
                {/* Outputs */}
                <div>
                    <div className="divider-ornate mb-2"></div>
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase block mb-2 tracking-wide">
                        Outputs
                    </span>
                    <div className="space-y-1.5">
                        {ioSummary.outputs.map((item, i) => (
                            <div key={i} className="flex justify-between text-xs bg-[var(--success-dim)]/20 px-2 py-1 rounded">
                                <span className="text-[var(--text-primary)] font-medium">
                                    {item.name}
                                </span>
                                <span className="text-[var(--success)] font-mono font-bold">
                                    {item.rate.toFixed(1)}/m
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </OrnatePanel>
    );
}

/** "1 gold 3 silver 14 copper /min", each coin in its own colour. */
function CoinAmount({ copper, suffix }: { copper: number; suffix: string }) {
    const c = toCoins(copper);
    const parts = [
        { n: c.gold, label: "gold", cls: "text-[var(--accent-gold-bright)]" },
        { n: c.silver, label: "silver", cls: "text-slate-300" },
        { n: c.copper, label: "copper", cls: "text-orange-400" },
    ].filter((p) => p.n > 0);
    return (
        <span className="font-mono font-bold flex items-baseline gap-1.5">
            {parts.length === 0 ? (
                <span className="text-orange-400">{copper > 0 ? "<1" : "0"} copper</span>
            ) : (
                parts.map((p) => (
                    <span key={p.label} className={p.cls}>
                        {p.n.toLocaleString()} {p.label}
                    </span>
                ))
            )}
            <span className="text-[var(--text-muted)] font-normal">{suffix}</span>
        </span>
    );
}
