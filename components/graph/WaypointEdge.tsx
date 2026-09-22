import { BaseEdge, EdgeLabelRenderer, useInternalNode, useNodes, type EdgeProps } from "@xyflow/react";
import type { CSSProperties } from "react";

type Pt = { x: number; y: number };
type Rect = { x1: number; y1: number; x2: number; y2: number };
const PAD = 12; // keep this far from node borders
const moved = (live: Pt | undefined, laidOut: Pt | undefined) =>
    !!live && !!laidOut && (Math.abs(live.x - laidOut.x) > 0.5 || Math.abs(live.y - laidOut.y) > 0.5);

/** Does the axis-aligned segment a→b cut through any rect? */
const hits = (a: Pt, b: Pt, rects: Rect[]) => {
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x], [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
    return rects.some((r) => x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1);
};
const clear = (pts: Pt[], rects: Rect[]) => pts.every((p, i) => i === 0 || !hits(pts[i - 1], p, rects));

/** Orthogonal route from s to t avoiding rects: a 3-segment step if some vertical x is free, else a
 *  5-segment detour through a free horizontal channel. Returns the interior corner points. */
function routeAround(s: Pt, t: Pt, rects: Rect[]): Pt[] {
    const mid = (s.x + t.x) / 2;
    // candidate verticals: the middle, then every gap edge between the two ends
    const xs = [mid, ...rects.flatMap((r) => [r.x1 - PAD, r.x2 + PAD])].filter((x) => x > s.x + PAD && x < t.x - PAD);
    xs.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    for (const x of xs) {
        const pts = [s, { x, y: s.y }, { x, y: t.y }, t];
        if (clear(pts, rects)) return pts.slice(1, -1);
    }
    // detour: leave right of s, cross in a free horizontal channel, come in left of t
    const x1 = s.x + PAD, x2 = t.x - PAD, avg = (s.y + t.y) / 2;
    const ys = [avg, ...rects.flatMap((r) => [r.y1 - PAD, r.y2 + PAD])].sort((a, b) => Math.abs(a - avg) - Math.abs(b - avg));
    for (const y of ys) {
        const pts = [s, { x: x1, y: s.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: t.y }, t];
        if (clear(pts, rects)) return pts.slice(1, -1);
    }
    return [{ x: mid, y: s.y }, { x: mid, y: t.y }]; // nothing clean; plain step
}

/** Orthogonal edge along ELK's route. Once either end is dragged away from its laid-out spot the route is
 *  stale, so the edge re-routes live around the other nodes' current boxes. */
export function WaypointEdge({ source, target, sourceX, sourceY, targetX, targetY, data, label, labelStyle, labelBgStyle, style, markerEnd }: EdgeProps) {
    const src = useInternalNode(source), tgt = useInternalNode(target);
    const nodes = useNodes();
    const layout = data?.layout as { source: Pt; target: Pt } | undefined;
    const stale = moved(src?.internals.positionAbsolute, layout?.source) || moved(tgt?.internals.positionAbsolute, layout?.target);
    const live = stale || !data?.route; // no ELK route (heat/fertilizer edges): always route live

    let d: string;
    let labelAt: Pt;
    if (live) {
        // Route live around every other node's current box
        const rects: Rect[] = nodes
            .filter((n) => n.id !== source && n.id !== target && n.measured?.width)
            .map((n) => ({ x1: n.position.x, y1: n.position.y, x2: n.position.x + n.measured!.width!, y2: n.position.y + n.measured!.height! }));
        const s = { x: sourceX, y: sourceY }, t = { x: targetX, y: targetY };
        const corners = routeAround(s, t, rects);
        const all = [s, ...corners, t];
        d = all.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
        const m = corners.length === 2 ? corners : [corners[1], corners[2]];
        labelAt = { x: (m[0].x + m[1].x) / 2, y: (m[0].y + m[1].y) / 2 };
    } else {
        // ELK's orthogonal route: start/end points sit on the estimated port positions, so snap the first
        // and last runs onto the real handles; everything in between is used as-is.
        const route = ((data?.route as Pt[] | undefined) ?? []).slice(1, -1);
        const pts: Pt[] = [{ x: sourceX, y: sourceY }];
        if (route.length >= 2) {
            pts.push({ x: route[0].x, y: sourceY }, ...route.slice(1, -1), { x: route[route.length - 1].x, y: targetY });
        } else {
            const mid = (sourceX + targetX) / 2;
            pts.push({ x: mid, y: sourceY }, { x: mid, y: targetY });
        }
        pts.push({ x: targetX, y: targetY });
        d = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
        // Label on the longest vertical run
        let best = 1, len = -1;
        for (let i = 1; i < pts.length; i++) {
            const l = Math.abs(pts[i].y - pts[i - 1].y);
            if (pts[i].x === pts[i - 1].x && l > len) { len = l; best = i; }
        }
        labelAt = { x: pts[best].x, y: (pts[best].y + pts[best - 1].y) / 2 };
    }
    const { x: lx, y: ly } = labelAt;
    return (
        <>
            <BaseEdge path={d} style={style} markerEnd={markerEnd} />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
                            background: (labelBgStyle as CSSProperties)?.fill as string,
                            color: (labelStyle as CSSProperties)?.fill as string,
                            fontWeight: labelStyle?.fontWeight,
                            fontSize: labelStyle?.fontSize,
                            padding: "2px 4px",
                            borderRadius: 4,
                            pointerEvents: "none",
                        }}
                        className="nodrag nopan"
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
