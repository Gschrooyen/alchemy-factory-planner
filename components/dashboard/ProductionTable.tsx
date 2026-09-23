import { DoneToggle, useDone } from "./DoneToggle";
import { Flame, Leaf } from "lucide-react";
import { ProductionNode } from "../../engine/types";
import { MachineCountInput } from "./MachineCountInput";
import { CauldronSwapButton } from "./CauldronWizard";
import { ParadoxSwapButton } from "./ParadoxPicker";
import { RecipeSwapButton } from "./RecipePicker";

const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { maximumFractionDigits: d });

interface Row {
    node: ProductionNode;
    stage: number; // longest chain of machines below it (raw = 0), so stages read like the build order
    consumers: string[]; // where the output goes
}

/** Flatten the shared node graph into one row per machine, ordered from raw materials to targets. */
function collectRows(roots: ProductionNode[]) {
    const rows = new Map<string, Row>();
    const consumersOf = new Map<string, Set<string>>();
    const stageOf = new Map<string, number>();
    const key = (n: ProductionNode) => n.id ?? n.itemName;

    const visit = (n: ProductionNode): number => {
        const k = key(n);
        if (stageOf.has(k)) return stageOf.get(k)!;
        stageOf.set(k, 0); // guards loops (fuel cycles): the second visit sees a provisional 0
        let stage = 0;
        for (const input of n.inputs) {
            if (!consumersOf.has(key(input))) consumersOf.set(key(input), new Set());
            consumersOf.get(key(input))!.add(n.itemName);
            const s = visit(input);
            if (input.inputKind === undefined && !input.isRaw) stage = Math.max(stage, s + 1);
        }
        stageOf.set(k, stage);
        if (!rows.has(k) && !n.isConsumptionReference) rows.set(k, { node: n, stage, consumers: [] });
        return stage;
    };
    roots.forEach(visit);

    // References (fuel/fertilizer/raw inputs) point at the real node by id; merge them into the real row
    const list = [...rows.values()];
    for (const r of list) r.consumers = [...(consumersOf.get(key(r.node)) ?? [])].filter((c) => c !== r.node.itemName);
    return list;
}

/** The engine lists a bought and a produced source for the same fuel/fertilizer; show one chip per item. */
function mergeInputs(node: ProductionNode) {
    const merged = new Map<string, { input: ProductionNode; rate: number }>();
    for (const input of node.inputs) {
        const k = `${input.inputKind ?? ""}:${input.itemName}`;
        const rate = input.isConsumptionReference || input.isRaw ? input.rate : (node.inputRates?.[input.itemName] ?? input.rate);
        const e = merged.get(k);
        if (e) e.rate += rate;
        else merged.set(k, { input, rate });
    }
    return [...merged.values()].filter((x) => x.rate > 0.005);
}

function InputChip({ input, rate }: { input: ProductionNode; rate: number }) {
    const kind = input.inputKind;
    const cls =
        kind === "fuel"
            ? "border-[var(--error)]/40 text-[var(--error)]"
            : kind === "fertilizer"
              ? "border-[var(--success)]/40 text-[var(--success)]"
              : "border-[var(--border-subtle)] text-[var(--text-secondary)]";
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap ${cls}`}>
            {kind === "fuel" && <Flame size={9} />}
            {kind === "fertilizer" && <Leaf size={9} />}
            {input.itemName}
            <span className="font-mono opacity-80">{fmt(rate, 2)}</span>
        </span>
    );
}

export function ProductionTable({ roots }: { roots: ProductionNode[] }) {
    const rows = collectRows(roots);
    const raws = rows.filter((r) => r.node.isRaw).sort((a, b) => a.node.itemName.localeCompare(b.node.itemName));
    const machines = rows.filter((r) => !r.node.isRaw && r.node.deviceCount > 0);
    const stages = [...new Set(machines.map((r) => r.stage))].sort((a, b) => a - b);
    const targets = new Set(roots.filter((r) => !r.isOrphanRoot).map((r) => r.itemName));
    const { done, clear } = useDone();
    const built = machines.filter((r) => done.has(r.node.id ?? r.node.itemName)).length;

    return (
        <div className="flex flex-col gap-6 text-sm">
            {/* Shopping list */}
            <section className="flex flex-col gap-2">
                <h3 className="text-[var(--success)] font-bold uppercase text-xs tracking-widest">Raw inputs</h3>
                <div className="flex flex-wrap gap-2">
                    {raws.map(({ node, consumers }) => (
                        <span
                            key={node.id ?? node.itemName}
                            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[var(--success-dim)]/20 border border-[var(--success)]/30"
                            title={consumers.length ? `→ ${consumers.join(", ")}` : undefined}
                        >
                            <span className="text-[var(--text-primary)]">{node.itemName}</span>
                            <span className="font-mono text-[var(--success)]">{fmt(node.suppliedRate ?? node.rate)}/m</span>
                            {node.isBeltSaturated && <span className="text-[9px] uppercase text-[var(--error)]">belt</span>}
                        </span>
                    ))}
                </div>
            </section>

            {/* One row per machine group, in build order; tick them off as you build */}
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span><span className={built === machines.length && machines.length > 0 ? "text-[var(--success)] font-bold" : "text-[var(--text-primary)]"}>{built}</span> / {machines.length} built</span>
                {built > 0 && <button onClick={clear} className="underline hover:text-[var(--text-primary)]">reset</button>}
            </div>
            <table className="w-full border-separate border-spacing-0">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <tr>
                        <th className="w-6 px-2 py-1.5"></th>
                        <th className="text-left px-2 py-1.5 font-semibold">Product</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Out /min</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Machines</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Inputs /min</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Heat</th>
                        <th className="text-left px-2 py-1.5 font-semibold">Feeds</th>
                    </tr>
                </thead>
                <tbody>
                    {stages.map((stage) => (
                        <StageRows
                            key={stage}
                            stage={stage}
                            last={stage === stages[stages.length - 1]}
                            rows={machines.filter((r) => r.stage === stage).sort((a, b) => b.node.rate - a.node.rate)}
                            targets={targets}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function StageRows({ stage, last, rows, targets }: { stage: number; last: boolean; rows: Row[]; targets: Set<string> }) {
    const { done } = useDone();
    return (
        <>
            <tr>
                <td colSpan={7} className="pt-4 pb-1 px-2 text-[10px] uppercase tracking-widest text-[var(--accent-gold)] font-bold">
                    Stage {stage + 1}{last ? " · final" : ""}
                </td>
            </tr>
            {rows.map(({ node, consumers }) => {
                const isTarget = targets.has(node.itemName);
                const key = node.id ?? node.itemName;
                const built = done.has(key);
                return (
                    <tr key={key} className={`align-top hover:bg-[var(--surface-elevated)]/60 ${built ? "opacity-50" : ""}`}>
                        <td className="px-2 py-2.5 border-t border-[var(--border-subtle)]"><DoneToggle nodeKey={key} /></td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)]">
                            <div className="flex items-center gap-2">
                                <span className={`font-semibold ${isTarget ? "text-[var(--accent-gold-bright)]" : "text-[var(--text-primary)]"}`}>{node.itemName}</span>
                                {isTarget && <span className="text-[9px] uppercase tracking-wider text-[var(--accent-gold)] border border-[var(--accent-gold)]/50 px-1 rounded">target</span>}
                                {node.isOrphanRoot && <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border)] px-1 rounded">byproduct sink</span>}
                                {node.isBeltSaturated && <span className="text-[9px] uppercase tracking-wider text-[var(--error)] border border-[var(--error)]/50 px-1 rounded">belt limit</span>}
                            </div>
                            {node.byproducts.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-[var(--accent-purple-bright)]">
                                    {node.byproducts.map((bp) => (
                                        <span key={bp.itemName} className="inline-flex items-center gap-1">
                                            +{bp.itemName} {fmt(bp.remaining ?? bp.rate)}/m
                                            <RecipeSwapButton node={{ itemName: bp.itemName, isRaw: false, rate: bp.rate, deviceCount: 0, heatConsumption: 0, inputs: [], byproducts: [] }} />
                                        </span>
                                    ))}
                                </div>
                            )}
                        </td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)] text-right font-mono text-[var(--accent-gold)] whitespace-nowrap">
                            {fmt(node.rate)}
                            {node.netOutputRate != null && node.rate - node.netOutputRate > 0.01 ? (
                                <div className="text-[10px] text-[var(--success)]" title="What leaves the factory after feeding its own machines">→ {fmt(node.netOutputRate)} net out</div>
                            ) : null}
                            {node.surplus && node.surplus > 0.01 ? <div className="text-[10px] text-[var(--accent-purple-bright)]">+{fmt(node.surplus)} spare</div> : null}
                        </td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                                <span className="text-[var(--accent-gold-bright)] font-bold"><MachineCountInput node={node} /></span>
                                <span className="text-[var(--text-secondary)]">× {node.deviceId ?? "machine"}</span>
                                <CauldronSwapButton node={node} />
                                <ParadoxSwapButton node={node} />
                                <RecipeSwapButton node={node} />
                            </span>
                        </td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)]">
                            <div className="flex flex-wrap gap-1">
                                {mergeInputs(node).map(({ input, rate }) => (
                                    <InputChip key={`${input.inputKind ?? ""}:${input.itemName}`} input={input} rate={rate} />
                                ))}
                            </div>
                        </td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)] text-right font-mono text-[var(--warning)] whitespace-nowrap">
                            {node.heatConsumption > 0 ? fmt(node.heatConsumption, 0) : <span className="text-[var(--text-muted)]">–</span>}
                        </td>
                        <td className="px-2 py-2 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
                            {isTarget ? "output" : consumers.join(", ")}
                        </td>
                    </tr>
                );
            })}
        </>
    );
}
