import { Plus, Settings, Trash2 } from "lucide-react";
import { Item } from "../../engine/types";
import { useFactoryStore } from "../../store/useFactoryStore";
import { InfoTooltip } from "../ui/InfoTooltip";
import { OrnatePanel } from "../ui/OrnatePanel";
import { SearchableSelect } from "../ui/SearchableSelect";

interface ProductionTargetsPanelProps {
    items: Item[]; // Sorted
}

export function ProductionTargetsPanel({
    items,
}: ProductionTargetsPanelProps) {
    const { factories, activeFactoryId, updateFactoryTargets } = useFactoryStore();
    const activeFactory = factories.find((f) => f.id === activeFactoryId);

    if (!activeFactory) return null;

    const targets = activeFactory.targets;

    const addTarget = () => {
        const newTargets = [...targets, { item: items[0].name, rate: 10 }];
        updateFactoryTargets(activeFactory.id, newTargets);
    };

    const removeTarget = (index: number) => {
        const newTargets = [...targets];
        newTargets.splice(index, 1);
        updateFactoryTargets(activeFactory.id, newTargets);
    };

    const updateTarget = (index: number, field: "item" | "rate", value: string | number) => {
        const newTargets = [...targets];
        // @ts-expect-error dynamic access
        newTargets[index][field] = value;
        updateFactoryTargets(activeFactory.id, newTargets);
    };

    return (
        <OrnatePanel className="p-4 space-y-3 flex flex-col" accentColor="gold">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-xs font-bold text-[var(--accent-gold)] uppercase flex items-center gap-2 tracking-wider">
                    <Settings size={12} className="text-[var(--accent-purple)]" /> Production Targets
                </h2>
                <button
                    onClick={addTarget}
                    className="text-xs flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent-gold)] font-bold px-2 py-1 rounded border border-[var(--border)] border-dashed hover:border-[var(--accent-gold)]/50 hover:bg-[var(--accent-gold)]/5 transition-all cursor-pointer"
                >
                    <Plus size={12} /> Add
                </button>
            </div>

            <div className="space-y-2 overflow-y-auto custom-scrollbar max-h-[200px] flex-1">
                {targets.map((target, idx) => (
                    <div
                        key={idx}
                        className="flex gap-2 items-center bg-[var(--background-deep)]/60 p-2.5 rounded-lg border border-[var(--border-subtle)] text-sm hover:border-[var(--accent-gold-dim)]/50 transition-colors group"
                    >
                        <div className="flex-1 w-24">
                            <SearchableSelect
                                options={items.map((i) => ({ value: i.name, label: i.name }))}
                                value={target.item}
                                onChange={(val) => updateTarget(idx, "item", val)}
                                className="bg-transparent text-[var(--accent-gold-bright)] font-medium text-xs hover:bg-[var(--surface)] border-none p-0 h-auto"
                            />
                        </div>
                        <div className="flex items-center bg-[var(--surface)]/50 px-2 py-1 rounded">
                            <input
                                type="number"
                                className="bg-transparent text-[var(--accent-gold-bright)] font-medium outline-none w-12 text-right focus:text-[var(--accent-gold)] text-xs"
                                value={target.rate}
                                onChange={(e) =>
                                    updateTarget(idx, "rate", parseFloat(e.target.value) || 0)
                                }
                            />
                            <span className="text-[10px] text-[var(--text-muted)] font-mono ml-1">
                                /m
                            </span>
                        </div>
                        {targets.length > 1 && (
                            <button
                                onClick={() => removeTarget(idx)}
                                className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors p-1 cursor-pointer opacity-0 group-hover:opacity-100"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </OrnatePanel>
    );
}

interface FactorySettingsPanelProps {
    fertilizers: Item[];
    fuels: Item[];
}

export function FactorySettingsPanel({
    fertilizers,
    fuels,
}: FactorySettingsPanelProps) {
    const { factories, activeFactoryId, updateFactoryConfig, setPlannerMode } = useFactoryStore();
    const activeFactory = factories.find((f) => f.id === activeFactoryId);

    if (!activeFactory) return null;

    const config = {
        selectedFertilizer: activeFactory.config.selectedFertilizer || "",
        selectedFuel: activeFactory.config.selectedFuel || "",
        selfFuel: activeFactory.config.selfFuel ?? true,
        selfFertilizer: activeFactory.config.selfFertilizer ?? true,
        burnByproducts: activeFactory.config.burnByproducts ?? false,
        wholeMachines: activeFactory.config.wholeMachines ?? false,
        autoBrews: activeFactory.config.autoBrews ?? false,
        optimizeFor: activeFactory.config.optimizeFor ?? "cost",
        machineCost: activeFactory.config.machineCost ?? 25,
        useThermalExtractor: activeFactory.config.useThermalExtractor ?? false,
        thermalExtractorFloors: activeFactory.config.thermalExtractorFloors ?? 0,
    };

    const sortedFertilizers = [...fertilizers].sort((a, b) => (a.nutrient_value || 0) - (b.nutrient_value || 0));
    const sortedFuels = [...fuels].sort((a, b) => (a.heat_value || 0) - (b.heat_value || 0));

    const updateConfig = (field: "selectedFertilizer" | "selectedFuel" | "selfFuel" | "selfFertilizer" | "burnByproducts" | "wholeMachines" | "autoBrews" | "machineCost" | "thermalExtractorFloors" | "useThermalExtractor" | "optimizeFor", value: string | boolean | number) => {
        updateFactoryConfig(activeFactory.id, { [field]: value });
    };

    const optimizeOptions = [
        { value: "cost", label: "Lowest raw material cost" },
        { value: "machines", label: "Fewest machines" },
    ];

    const plannerOptions = [
        { value: "recursive", label: "Recursive (Tree-based)" },
        { value: "lp", label: "Matrix (Linear Programming)" },
    ];

    const fertilizerOptions = [
        { value: "", label: "No Fertilizer" },
        ...sortedFertilizers.map((f) => ({
            value: f.name,
            label: `${f.name} (Val: ${f.nutrient_value})`,
        })),
    ];

    const fuelOptions = [
        { value: "", label: "No Fuel Selected" },
        ...sortedFuels.map((f) => ({
            value: f.name,
            label: `${f.name} (Heat: ${f.heat_value})`,
        })),
    ];

    return (
        <OrnatePanel className="p-4 space-y-4" accentColor="gold">
            <h3 className="font-semibold text-[var(--accent-gold)] flex items-center gap-2 text-xs uppercase tracking-wider">
                <Settings size={14} className="text-[var(--accent-purple)]" /> Factory Configuration
            </h3>

            <div className="space-y-3">
                <div>
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1.5 block tracking-wide">
                        Fertilizer Strategy
                    </label>
                    <SearchableSelect
                        options={fertilizerOptions}
                        value={config.selectedFertilizer}
                        onChange={(val) => updateConfig("selectedFertilizer", val)}
                        placeholder="Select Fertilizer..."
                        className="w-full bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                    />
                    {!config.selectedFertilizer && (
                        <p className="mt-1.5 text-[10px] text-[var(--warning)]">
                            None selected: nurseries are planned at base growth time with no fertilizer input.
                        </p>
                    )}
                    {config.selectedFertilizer && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                            <input
                                type="checkbox"
                                checked={config.selfFertilizer}
                                onChange={(e) => updateConfig("selfFertilizer", e.target.checked)}
                                className="accent-[var(--accent-gold)] cursor-pointer"
                            />
                            <span>Produce fertilizer internally</span>
                        </label>
                    )}
                </div>

                <div>
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1.5 flex items-center tracking-wide">
                        Fuel Type
                        <InfoTooltip text="Assumes Stone Furnace heating. Different heater types coming soon." />
                    </label>
                    <SearchableSelect
                        options={fuelOptions}
                        value={config.selectedFuel}
                        onChange={(val) => updateConfig("selectedFuel", val)}
                        placeholder="Select Fuel..."
                        className="w-full bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                    />
                    {config.selectedFuel && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                            <input
                                type="checkbox"
                                checked={config.selfFuel}
                                onChange={(e) => updateConfig("selfFuel", e.target.checked)}
                                className="accent-[var(--accent-gold)] cursor-pointer"
                            />
                            <span>Produce fuel internally</span>
                        </label>
                    )}
                    {config.selectedFuel && activeFactory.plannerMode === "lp" && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                            <input
                                type="checkbox"
                                checked={config.burnByproducts}
                                onChange={(e) => updateConfig("burnByproducts", e.target.checked)}
                                className="accent-[var(--accent-gold)] cursor-pointer"
                            />
                            <span>Burn byproducts for heat first</span>
                        </label>
                    )}
                    {activeFactory.plannerMode === "lp" && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                            <input
                                type="checkbox"
                                checked={config.wholeMachines}
                                onChange={(e) => updateConfig("wholeMachines", e.target.checked)}
                                className="accent-[var(--accent-gold)] cursor-pointer"
                            />
                            <span>Whole machines</span>
                        </label>
                    )}
                    {activeFactory.plannerMode === "lp" && (
                        <label
                            className="flex items-center gap-2 mt-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                            title="Searches every cauldron, advanced cauldron and paradox brew for ones cheaper (or more compact) than an item's normal recipes and lets the planner use them. Your own brews and pins still win."
                        >
                            <input
                                type="checkbox"
                                checked={config.autoBrews}
                                onChange={(e) => updateConfig("autoBrews", e.target.checked)}
                                className="accent-[var(--accent-gold)] cursor-pointer"
                            />
                            <span>Brew solver (auto cauldron / paradox)</span>
                        </label>
                    )}
                </div>

                {activeFactory.plannerMode === "lp" && (
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1.5 flex items-center tracking-wide">
                            Optimize For
                            <InfoTooltip text="Lowest cost buys the cheapest raw materials, which can mean long chains. Fewest machines picks the shortest route instead, buying pricier inputs to save buildings." />
                        </label>
                        <SearchableSelect
                            options={optimizeOptions}
                            value={config.optimizeFor}
                            onChange={(val) => updateConfig("optimizeFor", val)}
                            placeholder="Optimize For..."
                            className="w-full bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                        />
                        {config.optimizeFor === "cost" && (
                            <div className="mt-2 flex items-center gap-2" title="Each machine is charged this much per minute on top of raw material cost, so a cheaper-but-slower route only wins if it saves more than the extra machines cost. 0 = raw cost only.">
                                <input
                                    type="number"
                                    min={0}
                                    step={5}
                                    value={config.machineCost}
                                    onChange={(e) => updateConfig("machineCost", Math.max(0, Number(e.target.value) || 0))}
                                    className="w-20 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                                />
                                <span className="text-[10px] text-[var(--text-muted)]">gold/min per machine</span>
                            </div>
                        )}
                    </div>
                )}

                <div>
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1.5 flex items-center tracking-wide">
                        Extraction
                        <InfoTooltip text="Thermal Extractors run the same recipes as Extractors, but burn heat and gain +12.5% output per storey built above ground, capped at +200% (16 storeys)." />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors">
                        <input
                            type="checkbox"
                            checked={config.useThermalExtractor}
                            onChange={(e) => updateConfig("useThermalExtractor", e.target.checked)}
                            className="accent-[var(--accent-gold)] cursor-pointer"
                        />
                        <span>Use Thermal Extractors</span>
                    </label>
                    {config.useThermalExtractor && (
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={16}
                                step={1}
                                value={config.thermalExtractorFloors}
                                onChange={(e) => updateConfig("thermalExtractorFloors", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                                className="w-20 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                            />
                            <span className="text-[10px] text-[var(--text-muted)]">
                                floors up &rarr; +{Math.round(Math.min(2, config.thermalExtractorFloors * 0.125) * 100)}% output
                            </span>
                        </div>
                    )}
                </div>

                <div>
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1.5 flex items-center tracking-wide">
                        Planner Algorithm
                        <InfoTooltip text="Matrix (LP) is WIP but will be preferred. Recursive will be deprecated." />
                    </label>
                    <SearchableSelect
                        options={plannerOptions}
                        value={activeFactory.plannerMode || "lp"}
                        onChange={(val) => setPlannerMode(activeFactory.id, val as "recursive" | "lp")}
                        placeholder="Select Planner..."
                        className="w-full bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border)]"
                    />
                </div>
            </div>
        </OrnatePanel>
    );
}

interface AvailableResourcesPanelProps {
    items: Item[];
}

export function AvailableResourcesPanel({ items }: AvailableResourcesPanelProps) {
    const { factories, activeFactoryId, updateFactoryAvailableResources } = useFactoryStore();
    const activeFactory = factories.find((f) => f.id === activeFactoryId);

    if (!activeFactory) return null;

    const resources = activeFactory.availableResources || [];

    const addResource = () => {
        const newResources = [...resources, { item: items[0].name, rate: 10 }];
        updateFactoryAvailableResources(activeFactory.id, newResources);
    };

    const removeResource = (index: number) => {
        const newResources = [...resources];
        newResources.splice(index, 1);
        updateFactoryAvailableResources(activeFactory.id, newResources);
    };

    const updateResource = (
        index: number,
        field: "item" | "rate",
        value: string | number
    ) => {
        const newResources = [...resources];
        // @ts-expect-error dynamic access
        newResources[index][field] = value;
        updateFactoryAvailableResources(activeFactory.id, newResources);
    };

    return (
        <OrnatePanel className="p-4 space-y-3 flex flex-col" accentColor="green">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-xs font-bold text-[var(--success)] uppercase flex items-center gap-2 tracking-wider">
                    <Settings size={12} className="text-[var(--accent-purple)]" /> Available Input Resources
                </h2>
                <button
                    onClick={addResource}
                    className="text-xs flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--success)] font-bold px-2 py-1 rounded border border-[var(--border)] border-dashed hover:border-[var(--success)]/50 hover:bg-[var(--success)]/5 transition-all cursor-pointer"
                >
                    <Plus size={12} /> Add
                </button>
            </div>

            <div className="space-y-2 overflow-y-auto custom-scrollbar max-h-[200px] flex-1">
                {resources.map((res, idx) => (
                    <div
                        key={idx}
                        className="flex gap-2 items-center bg-[var(--background-deep)]/60 p-2.5 rounded-lg border border-[var(--border-subtle)] text-sm hover:border-[var(--success)]/30 transition-colors group"
                    >
                        <div className="flex-1 w-24">
                            <SearchableSelect
                                options={items.map((i) => ({ value: i.name, label: i.name }))}
                                value={res.item}
                                onChange={(val) => updateResource(idx, "item", val)}
                                className="bg-transparent text-[var(--success)] font-medium text-xs hover:bg-[var(--surface)] border-none p-0 h-auto"
                            />
                        </div>
                        <div className="flex items-center bg-[var(--surface)]/50 px-2 py-1 rounded">
                            <input
                                type="number"
                                className="bg-transparent text-[var(--success)] font-medium outline-none w-12 text-right text-xs"
                                value={res.rate}
                                onChange={(e) =>
                                    updateResource(idx, "rate", parseFloat(e.target.value) || 0)
                                }
                            />
                            <span className="text-[10px] text-[var(--text-muted)] font-mono ml-1">
                                /m
                            </span>
                        </div>
                        <button
                            onClick={() => removeResource(idx)}
                            className="text-[var(--text-muted)] hover:text-[var(--error)] transition-colors p-1 cursor-pointer opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
                {resources.length === 0 && (
                    <div className="text-[10px] text-[var(--text-muted)] italic text-center py-4 border border-dashed border-[var(--border-subtle)] rounded-lg">
                        No available resources configured.
                    </div>
                )}
            </div>
        </OrnatePanel>
    );
}
