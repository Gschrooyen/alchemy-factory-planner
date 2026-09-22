import type { Metadata } from "next";
import { CauldronExplorer } from "@/components/cauldron/CauldronExplorer";

export const metadata: Metadata = {
  title: "Advanced Cauldron Recipes | Alchemy Factory Tools",
  description:
    "Every two-ingredient Advanced Cauldron combination in Alchemy Factory and what it brews, with input and output rates, brew time and heat, computed from the game's own transmutation rule.",
};

export default function AdvancedCauldronPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <div>
        <h1 className="font-cinzel text-3xl font-bold text-[var(--accent-gold)] mb-2">Advanced Cauldron</h1>
        <p className="text-[var(--text-secondary)]">
          The silver Advanced Cauldron has <strong>two</strong> belt-fed slots and only brews while both
          hold something. Two different materials brew the product closest to the <em>difference</em>
          of their values, always something cheaper than the pricier input; two of the same step up to
          the next product above it. One from each slot in, one out per brew; liquids can&apos;t enter.
          Rates are per cauldron at your current Factory Speed research.
        </p>
      </div>
      <CauldronExplorer kind="advanced" />
    </div>
  );
}
