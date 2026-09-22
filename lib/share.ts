import type { FactoryState, ResearchState } from "@/engine/types";

/** What a share link carries: the factory's inputs, not its computed plan or layout. */
export interface SharedFactory {
  v: 1;
  name: string;
  targets: FactoryState["targets"];
  availableResources: FactoryState["availableResources"];
  config: FactoryState["config"];
  plannerMode: FactoryState["plannerMode"];
  research: ResearchState; // skills are global, and the plan only makes sense with the same ones
}

// ponytail: plain base64url JSON in the URL (~1-2 KB); add compression if links get unwieldy
const toB64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function encodeShare(data: SharedFactory): string {
  return toB64Url(new TextEncoder().encode(JSON.stringify(data)));
}

export function decodeShare(param: string): SharedFactory | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64Url(param)));
    if (data?.v !== 1 || !Array.isArray(data.targets) || typeof data.config !== "object") return null;
    return data as SharedFactory;
  } catch {
    return null;
  }
}

export const SHARE_PARAM = "f";
