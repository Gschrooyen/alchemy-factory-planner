import type { Metadata } from "next";
import { ParadoxExplorer } from "@/components/paradox/ParadoxExplorer";

export const metadata: Metadata = {
  title: "Paradox Crucible | Alchemy Factory Tools",
  description:
    "What every item turns into in the Paradox Crucible in Alchemy Factory, with brew time and input and output rates, from the game's own rule.",
};

export default function ParadoxCruciblePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <div>
        <h1 className="font-cinzel text-3xl font-bold text-[var(--accent-gold)] mb-2">Paradox Crucible</h1>
        <p className="text-[var(--text-secondary)]">
          Turns <strong>any</strong> belt-fed material into Oblivion Essence (Mors), and Mors into Vitality
          Essence (Vitae). When idle it grabs everything in its input slot as one batch and brews a
          <strong> single</strong> unit of output in <code>1500 ÷ (batch × cauldron cost)</code> seconds
          (0.5s–1500s; Mors and Vitae are a flat 5s). The whole batch is consumed, so anything that piles
          up in the slot is wasted: feed it one at a time for the best yield, and use the batch size to
          see what happens when you don&apos;t. Rates are per crucible at your Factory Speed research.
        </p>
      </div>
      <ParadoxExplorer />
    </div>
  );
}
