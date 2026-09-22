"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useFactoryStore } from "../store/useFactoryStore";
import { ResearchState } from "../engine/types";
import { decodeShare, SHARE_PARAM } from "../lib/share";

// Module-level so remounts of this component (Suspense, StrictMode) can't import the same link twice
const importedLinks = new Set<string>();

export function SetupgradesHandler() {
  const searchParams = useSearchParams();
  const setResearchBulk = useFactoryStore((state) => state.setResearchBulk);
  const importFactory = useFactoryStore((state) => state.importFactory);
  const isHydrated = useFactoryStore.persist.hasHydrated();

  // ?f=<shared factory>: import it as a new tab, then drop the param so a reload doesn't import it again
  useEffect(() => {
    if (!isHydrated) return;
    const param = searchParams.get(SHARE_PARAM);
    if (!param || importedLinks.has(param)) return; // StrictMode / Suspense remounts run this again
    importedLinks.add(param);
    const shared = decodeShare(param);
    if (shared) importFactory(shared);
    else console.warn("Ignoring unreadable share link");
    const url = new URL(window.location.href);
    url.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, "", url.toString());
  }, [isHydrated, searchParams, importFactory]);

  useEffect(() => {
    if (!isHydrated) return;

    const setupgradesParam = searchParams.get("setupgrades");
    if (!setupgradesParam) return;

    // Parse comma-separated list of skill levels
    const values = setupgradesParam.split(",").map((v) => parseInt(v.trim(), 10));

    // Only apply if all 10 values are provided and valid
    if (values.length !== 10 || values.some(isNaN)) {
      console.warn("setupgrades parameter must contain exactly 10 comma-separated numbers");
      return;
    }

    // Map array indices to skill names
    const skillNames: Array<keyof ResearchState> = [
      "logisticsEfficiency",     // [0]
      "throwingEfficiency",      // [1]
      "factoryEfficiency",       // [2]
      "alchemySkill",            // [3]
      "fuelEfficiency",          // [4]
      "fertilizerEfficiency",    // [5]
      "salesAbility",            // [6]
      "negotiationSkill",        // [7]
      "customerMgmt",            // [8]
      "relicKnowledge",          // [9]
    ];

    // Build updates object
    const updates: Partial<ResearchState> = {};
    skillNames.forEach((skillName, index) => {
      updates[skillName] = values[index];
    });

    // Apply all skill updates at once
    setResearchBulk(updates);
  }, [isHydrated, searchParams, setResearchBulk]);

  return null;
}
