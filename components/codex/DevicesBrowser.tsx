"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { DeviceCard, type DeviceSummary } from "./DeviceCard";

interface Section {
  id: string;
  label: string;
  blurb: string;
}

/** Devices grouped by category, filtered by one search box (device or product name). */
export function DevicesBrowser({ devices, sections }: { devices: DeviceSummary[]; sections: Section[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const visible = useMemo(
    () => (q ? devices.filter((d) => [d.name, ...d.makes].some((t) => t.toLowerCase().includes(q))) : devices),
    [devices, q],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            aria-label="Search devices or products"
            placeholder="Search devices or what they make..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-gold-dim)] transition-colors"
          />
          {query && (
            <button
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className="text-sm text-[var(--text-muted)]">
          {visible.length} of {devices.length} devices
        </span>
      </div>

      {sections.map((section) => {
        const list = visible.filter((d) => d.category === section.id);
        if (!list.length) return null;
        return (
          <section key={section.id} className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <h2 className="font-cinzel text-xl text-[var(--accent-gold)]">{section.label}</h2>
              <span className="text-sm text-[var(--text-muted)]">{section.blurb}</span>
              <div className="divider-ornate flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {list.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </div>
          </section>
        );
      })}

      {visible.length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <p className="text-lg">No devices found</p>
          <p className="text-sm">Try a device name or a product, like &quot;Plank&quot;.</p>
        </div>
      )}
    </div>
  );
}
