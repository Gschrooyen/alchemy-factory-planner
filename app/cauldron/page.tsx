import type { Metadata } from "next";
import { CauldronExplorer } from "@/components/cauldron/CauldronExplorer";

export const metadata: Metadata = {
  title: "Cauldron Recipes | Alchemy Factory Tools",
  description:
    "Every three-ingredient Cauldron combination in Alchemy Factory and what it brews, with input and output rates, brew time and heat, computed from the game's own transmutation rule.",
};

export default function CauldronPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      <div>
        <h1 className="font-cinzel text-3xl font-bold text-[var(--accent-gold)] mb-2">Cauldron</h1>
        <p className="text-[var(--text-secondary)]">
          The pewter Cauldron has <strong>three</strong> belt-fed slots and only brews while all three
          hold something: it makes one unit of whichever product&apos;s value is closest to the three
          ingredients&apos; combined value, consuming one from each slot. Liquids can&apos;t enter (no
          pipe port). Rates are per cauldron at your current Factory Speed research. This is the
          game&apos;s actual rule, so every combination below is what you&apos;ll get in game. The
          two-slot silver pot has its own page: Advanced Cauldron.
        </p>
      </div>
      <CauldronExplorer kind="basic" />
    </div>
  );
}
