
"use client";

import { AlchemyIcon } from "@/components/icons/AlchemyIcon";
import { useEffect, useMemo, useState, Suspense } from "react";
import { GraphView } from "../components/GraphView";
import {
  FactorySettingsPanel,
  ProductionTargetsPanel,
  AvailableResourcesPanel,
} from "../components/dashboard/FactoryConfigPanel";
import { FactoryTabs } from "../components/dashboard/FactoryTabs";
import { GlobalResearchPanel } from "../components/dashboard/GlobalResearchPanel";
import { IOSummaryPanel } from "../components/dashboard/IOSummaryPanel";
import { ProductionTable } from "../components/dashboard/ProductionTable";
import { ProductionNode, Item } from "../engine/types";
import { useFactoryStore } from "../store/useFactoryStore";
import itemsData from "../data/items.json";
import { SetupgradesHandler } from "../components/SetupgradesHandler";
import { getItem, normalizeItemId } from "../engine/item-utils";

// Types
const items = itemsData as unknown as Item[];
// Hidden items (e.g. the internal Refined Sand tiers) share names with visible ones; they would duplicate rows
const sortedItems = items.filter((i) => !i.hidden).sort((a, b) => a.name.localeCompare(b.name));
// Filter lists for selectors
const FERTILIZERS = items.filter(
  (i) =>
    i.category === "fertilizer" ||
    (Array.isArray(i.category) && i.category.includes("fertilizer")),
);
const FUELS = items.filter((i) => !i.hidden && i.heat_value && i.heat_value > 0);


const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? id;

const summaryClass =
  "cursor-pointer select-none text-xs uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--accent-gold)] list-none flex items-center gap-2 py-1";

export default function PlannerPage() {
  const {
    factories,
    activeFactoryId,
    addFactory,
    updateFactoryConfig,
  } = useFactoryStore();

  const [isLoaded, setIsLoaded] = useState(false);

  // Hydration handling
  useEffect(() => {
    // Avoid sync state update warning by deferring
    if (useFactoryStore.persist.hasHydrated()) {
      setTimeout(() => setIsLoaded(true), 0);
    } else {
      const unsubscribe = useFactoryStore.persist.onFinishHydration(() => setIsLoaded(true));
      return () => unsubscribe();
    }
  }, []);

  const activeFactory = factories.find((f) => f.id === activeFactoryId);

  // Initialize if empty
  useEffect(() => {
    if (isLoaded && factories.length === 0) {
      addFactory();
    }
  }, [isLoaded, factories.length, addFactory]);

  // Derived Stats
  const productionTrees = useMemo(() => activeFactory?.productionTrees || [], [activeFactory?.productionTrees]);

  const stats = useMemo(() => {
    let totalMachines = 0;
    let totalPower = 0;
    const visited = new Set<string>();

    function traverse(node: ProductionNode) {
      const key = node.id || node.itemName;

      // Skip consumption references - they're transparent pass-throughs
      // DON'T add them to visited since they share IDs with production nodes
      if (node.isConsumptionReference) {
        node.inputs.forEach(traverse);
        return;
      }

      if (visited.has(key)) return;
      visited.add(key);

      totalMachines += node.deviceCount;
      totalPower += node.heatConsumption;
      node.inputs.forEach(traverse);
    }

    productionTrees.forEach((root) => traverse(root));
    return { totalMachines, totalPower };
  }, [productionTrees]);

  const ioSummary = useMemo(() => {
    const inputs = new Map<string, number>();
    const outputs = new Map<string, number>();
    const visited = new Set<string>();
    let cost = 0; // copper per minute for bought raw inputs
    // Fuel/fertilizer not produced here comes from outside this factory: free, like available resources
    const cfg = activeFactory?.config;
    const external = new Set<string>();
    if (cfg?.selectedFuel && !(cfg.selfFuel ?? true)) external.add(normalizeItemId(cfg.selectedFuel));
    if (cfg?.selectedFertilizer && !(cfg.selfFertilizer ?? true)) external.add(normalizeItemId(cfg.selectedFertilizer));
    const seeds = new Map<string, number>(); // planted once per nursery: a build cost, not per minute
    let seedCost = 0;

    function traverse(node: ProductionNode, isRoot = false) {
      const key = node.id || node.itemName;

      // Skip consumption references from IO totals, but still traverse their inputs
      // to capture raw materials (e.g., Logs for Plank fuel)
      // DON'T add consumption refs to visited - they share IDs with production nodes
      if (node.isConsumptionReference) {
        node.inputs.forEach((n) => traverse(n));
        return;
      }

      // Raw inputs: each consumer holds its own copy carrying its own rate, so count every copy
      // (deduping by id kept only the first consumer's share). Supplied resources are free; seeds are planted once.
      if (node.planted) {
        seeds.set(node.itemName, (seeds.get(node.itemName) || 0) + node.rate);
        seedCost += node.rate * (getItem(node.itemName)?.cost ?? 0);
      } else if (node.inputs.length === 0 && node.deviceCount === 0) {
        inputs.set(node.itemName, (inputs.get(node.itemName) || 0) + node.rate);
        if (!node.suppliedRate && !external.has(normalizeItemId(node.itemName))) cost += node.rate * (getItem(node.itemName)?.cost ?? 0);
      }

      // Check if already visited (skip for production nodes we've seen)
      if (visited.has(key)) return;
      visited.add(key);

      if (isRoot) {
        // Use netOutputRate for LP planner (accounts for internal consumption)
        const outputRate = node.netOutputRate ?? node.rate;
        outputs.set(
          node.itemName,
          (outputs.get(node.itemName) || 0) + outputRate,
        );
      }
      node.byproducts.forEach((bp) => {
        outputs.set(bp.itemName, (outputs.get(bp.itemName) || 0) + (bp.remaining ?? bp.rate));
      });
      if (!isRoot && node.surplus) {
        outputs.set(node.itemName, (outputs.get(node.itemName) || 0) + node.surplus);
      }
      node.inputs.forEach((n) => traverse(n));
    }

    productionTrees.forEach((root) => traverse(root, true));

    return {
      cost,
      seedCost,
      seeds: Array.from(seeds.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      inputs: Array.from(inputs.entries())
        .map(([name, rate]) => ({ name, rate }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      outputs: Array.from(outputs.entries())
        .map(([name, rate]) => ({ name, rate }))
        .filter((o) => o.rate > 0.005) // fully used byproducts (e.g. steel's recycled Iron Ingot) aren't outputs
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [productionTrees, activeFactory?.config]);

  if (!isLoaded || !activeFactory)
    return <div className="p-10 text-[var(--text-muted)]">Loading Planner...</div>;


  return (
    <div className="bg-[var(--background)] text-[var(--text-primary)] font-sans p-2 lg:p-8 pt-0 lg:pt-0 flex flex-col gap-4 bg-arcane-pattern min-h-screen">
      {/* Query parameter handler */}
      <Suspense fallback={null}>
        <SetupgradesHandler />
      </Suspense>

      {/* Native <details> to collapse each block (no `group` class here: it would fire every group-hover tooltip inside) */}
      <details open className="flex flex-col gap-4 [&[open]_.chev]:rotate-90">
        <summary className={summaryClass} title="Collapse or expand the skills">
          <span className="chev inline-block transition-transform">▶</span> Skills
        </summary>
        <GlobalResearchPanel />
      </details>

      <details open className="flex flex-col gap-4 [&[open]_.chev]:rotate-90">
        <summary className={summaryClass} title="Collapse or expand the factory panels">
          <span className="chev inline-block transition-transform">▶</span> Factory setup
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <ProductionTargetsPanel items={sortedItems} />
          <AvailableResourcesPanel items={sortedItems} />
          <FactorySettingsPanel fertilizers={FERTILIZERS} fuels={FUELS} />
          <IOSummaryPanel stats={stats} ioSummary={ioSummary} />
        </div>
      </details>

      <FactoryTabs />

      <main className="flex-1 flex flex-col gap-6 min-h-0">
        {/* View Area */}
        <section className="flex-1 panel-ornate rounded-xl shadow-xl overflow-hidden min-h-[600px] flex flex-col relative">
          {/* Ornate top accent */}
          <div className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-gold)] to-transparent z-10 pointer-events-none"></div>

          {/* Corner accent elements */}
          <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-[var(--accent-purple-dim)] rounded-tl opacity-60 pointer-events-none"></div>
          <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-[var(--accent-purple-dim)] rounded-tr opacity-60 pointer-events-none"></div>
          <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-[var(--accent-purple-dim)] rounded-bl opacity-60 pointer-events-none"></div>
          <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-[var(--accent-purple-dim)] rounded-br opacity-60 pointer-events-none"></div>

          <div className="flex-1 w-full h-full relative">
            {productionTrees && productionTrees.length > 0 ? (
              activeFactory.viewMode === "graph" ? (
                <GraphView key={activeFactory.id} />
              ) : (
                <div className="p-8 overflow-auto custom-scrollbar h-full pt-16">
                  <ProductionTable roots={productionTrees} />
                </div>
              )
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] flex-col gap-4">
                <div className="relative">
                  <div className="absolute -inset-4 bg-[var(--accent-purple)]/10 rounded-full blur-xl"></div>
                  <div className="relative p-5 bg-[var(--surface-elevated)] rounded-full border border-[var(--border)] glow-purple pulse-mystic">
                    <AlchemyIcon className="w-12 h-12 opacity-50 text-[var(--accent-purple)]" />
                  </div>
                </div>
                {activeFactory.targets.length > 0 ? (
                  <>
                    <p className="text-sm font-[family-name:var(--font-cinzel)] text-[var(--error)]">No feasible plan</p>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] max-w-md text-center">
                      A chosen cauldron or paradox brew needs its own product upstream (a loop with no net output), or the fuel /
                      fertilizer setup can&apos;t be satisfied.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {Object.entries(activeFactory.config.cauldronOverrides ?? {}).map(([id, inputs]) => (
                        <button
                          key={"c" + id}
                          onClick={() => {
                            const { [id]: _, ...rest } = activeFactory.config.cauldronOverrides ?? {};
                            updateFactoryConfig(activeFactory.id, { cauldronOverrides: rest });
                          }}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--error)] hover:text-[var(--error)]"
                          title="Back to normal recipes"
                        >
                          Cauldron {itemName(id)} ← {inputs.map(itemName).join(" + ")} ✕
                        </button>
                      ))}
                      {Object.entries(activeFactory.config.recipeOverrides ?? {}).map(([id, recipeId]) => (
                        <button
                          key={"r" + id}
                          onClick={() => {
                            const { [id]: _, ...rest } = activeFactory.config.recipeOverrides ?? {};
                            updateFactoryConfig(activeFactory.id, { recipeOverrides: rest });
                          }}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--error)] hover:text-[var(--error)]"
                          title="Let the planner choose again"
                        >
                          Recipe {itemName(id)} ← {recipeId} ✕
                        </button>
                      ))}
                      {Object.entries(activeFactory.config.recipeSplits ?? {}).map(([id, shares]) => (
                        <button
                          key={"s" + id}
                          onClick={() => {
                            const { [id]: _, ...rest } = activeFactory.config.recipeSplits ?? {};
                            updateFactoryConfig(activeFactory.id, { recipeSplits: rest });
                          }}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--error)] hover:text-[var(--error)]"
                          title="Let the planner choose again"
                        >
                          Split {itemName(id)} ← {Object.entries(shares).map(([r, s]) => `${r} ${s}`).join(" / ")} ✕
                        </button>
                      ))}
                      {Object.entries(activeFactory.config.paradoxOverrides ?? {}).map(([id, input]) => (
                        <button
                          key={"p" + id}
                          onClick={() => {
                            const { [id]: _, ...rest } = activeFactory.config.paradoxOverrides ?? {};
                            updateFactoryConfig(activeFactory.id, { paradoxOverrides: rest });
                          }}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--error)] hover:text-[var(--error)]"
                          title="Back to normal recipes"
                        >
                          Paradox {itemName(id)} ← {itemName(input)} ✕
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-[family-name:var(--font-cinzel)]">Add a target to begin planning</p>
                    <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Select an item above to calculate production</p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
