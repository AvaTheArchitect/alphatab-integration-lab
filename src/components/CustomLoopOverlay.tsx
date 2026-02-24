'use client';

/**
 * CustomLoopOverlay.tsx v2.6
 *
 * 🔥 V2.6 CHANGES:
 *
 * ✅ LOOP TAIL (+1): api.playbackRange.endTick = loopEnd + 1.
 *    AlphaTab's internal scheduler can bail before emitting tick >= loopEnd,
 *    causing the manual loop wrapper to never fire → early wrap.
 *    +1 tail keeps the engine alive long enough for the manual wrapper to see
 *    tick >= loopEnd and reset. Manual loop still wraps at the real loopEnd:
 *      if (tick >= loopEnd) api.tickPosition = start  ← real exclusive end
 *    This is the OPPOSITE of the old EPS hack (which cut short); this extends
 *    by 1 tick so the engine doesn't terminate early.
 *
 * ✅ LIQUID BEAT DRAG: beat-mode preciseTick now interpolates within the beat box.
 *    Previous behavior: preciseTick = beat.absolutePlaybackStart → discrete steps.
 *    New behavior: use mouse X within beat visualBounds to compute a proportional
 *    tick inside the beat duration:
 *      t = clamp01((x - vb.x) / vb.w)
 *      insideBeatTick = expandedBeatStart + floor(t * beatDur)
 *    Result: highlight moves continuously as mouse slides, not just on beat boundary.
 *    Applies in handleMouseDown and handleMouseMove.
 *
 * ✅ NO SLIDE-IN on initial drag: isDragging was read from dragRef.current at render
 *    time (stale ref). On the first previewSelection render, isDragging was true in
 *    the ref but hadn't triggered a re-render — so the highlight div appeared with
 *    transition:none at position 0, then on next render got transition applied and
 *    animated from 0 to drag position → visible "fly-in". Fix: isDraggingState is
 *    a real React state (set true on first move past threshold, false on mouseup).
 *    Transition is only active during an established drag, never on initial appear.
 *
 * ✅ BAR CLAMP: preciseTick clamped to [barHit.startTick, barHit.endTick] in both
 *    mousedown and mousemove — prevents snapping into adjacent bar at left/right edges.
 *
 * 🔥 V2.5: EPS removed, left-edge clamp, end-of-bar fallback to barHit.endTick.
 * 🔥 V2.4: Occurrence-based bar resolution, passRefTick cross-bar drag.
 * 🔥 V2.3: beat.absolutePlaybackStart structural — expanded tick via barStart + offset.
 * 🔥 V2.0–V2.2: stable passRefTick, zero-length guard, conditional transition.
 * 🔥 V1.9: resolveExpandedBarStart — single source of truth for expanded-pass identity.
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface BarHitResult {
    masterBar: any;
    startTick: number;
    endTick: number;
    barBounds: { x: number; y: number; w: number; h: number };
}

interface DragState {
    isDragging: boolean;
    startX: number;
    startY: number;
    startBar: BarHitResult | null;
    currentBar: BarHitResult | null;
    startTick: number | null;
    currentTick: number | null;
    passRefTick: number;
}

interface LoopSelection {
    startTick: number;
    endTick: number;
    startBar: BarHitResult;
    endBar: BarHitResult;
}

interface CustomLoopOverlayProps {
    api: any;
    containerRef: React.RefObject<HTMLDivElement>;
    surfaceRef: React.RefObject<HTMLElement>;
    loopEnabled: boolean;
    boundsReady?: boolean;
    boundsEpoch?: number;
    onLoopToggle?: (enabled: boolean) => void;
    onLoopChange?: (startTick: number, endTick: number) => void;
    onLoopClear?: () => void;
}

const CLICK_THRESHOLD_PX = 5;

// ─────────────────────────────────────────────
// Expanded-pass resolvers
// ─────────────────────────────────────────────

function resolveExpandedBarStart(
    tickCache: any,
    visualBarIndex: number,
    refTick: number
): number | null {
    const instances: any[] =
        tickCache?.masterBars?.filter((mb: any) => mb.masterBar?.index === visualBarIndex) ?? [];
    if (instances.length === 0) return null;
    const best = instances.reduce((prev: any, curr: any) =>
        Math.abs(curr.start - refTick) < Math.abs(prev.start - refTick) ? curr : prev
    );
    return best.start ?? null;
}

/**
 * Converts a renderer Beat into the correct *expanded* base tick.
 * Returns the beat START tick only — caller adds intra-beat offset for liquid drag.
 * beat.absolutePlaybackStart is structural (pass 1 only) — never use directly.
 */
function resolveExpandedBeatTickFromRendererBeat(
    api: any,
    rBeat: any | null,
    passRefTick: number,
    visualBarIndexFallback?: number
): number | null {
    if (!rBeat) return null;
    const tickCache = (api as any).tickCache;
    if (!tickCache?.masterBars) return null;
    const visualBarIndex =
        rBeat?.voice?.bar?.masterBar?.index ??
        visualBarIndexFallback;
    if (visualBarIndex == null) return null;
    const barStart = resolveExpandedBarStart(tickCache, visualBarIndex, passRefTick);
    if (barStart == null) return null;
    const offsetInBar = rBeat.playbackStart ?? 0;
    return barStart + offsetInBar;
}

/**
 * Computes a proportional tick WITHIN the beat box based on mouse X position.
 * This is what makes beat-mode drag feel "liquid" — tick advances continuously
 * as the mouse slides, not just when crossing a beat boundary.
 *
 * Returns null if bounds or beat duration unavailable (caller falls back to beat start).
 */
function computeInsideBeatTick(
    api: any,
    rBeat: any,
    expandedBeatStart: number,
    mouseX: number
): number | null {
    if (!rBeat || expandedBeatStart == null) return null;
    const bb = api?.renderer?.boundsLookup?.findBeat(rBeat);
    if (!bb?.visualBounds) return null;
    const vb = bb.visualBounds;
    const beatDur = rBeat.playbackDuration ?? rBeat.duration ?? 0;
    if (beatDur <= 0 || vb.w <= 0) return null;
    const t = Math.max(0, Math.min(1, (mouseX - vb.x) / vb.w));
    return expandedBeatStart + Math.floor(t * beatDur);
}

// ─────────────────────────────────────────────
// Geometric Hit-Testing
// ─────────────────────────────────────────────

/**
 * Transport-independent bar hit-test via occurrence counting.
 * Counts visual order appearances of each masterBar.index before the hit →
 * picks that occurrence from tickCache.masterBars. Zero transport dependency.
 */
function findBarAtPos(api: any, x: number, y: number): BarHitResult | null {
    const systems =
        api?.renderer?.boundsLookup?.staffSystems ||
        api?.renderer?.bounds?.systems ||
        api?.renderer?.bounds?.staffSystems ||
        [];
    const tickCache = (api as any).tickCache;
    const occurrenceCounter = new Map<number, number>();

    for (const sys of systems) {
        const sb = sys?.visualBounds || sys?.realBounds || sys?.bounds;
        const inYRange = sb && y >= sb.y && y <= sb.y + sb.h;

        for (const mbb of (sys?.bars || [])) {
            const visualBarIndex = mbb.masterBar?.index ?? mbb.index;
            if (visualBarIndex == null) continue;

            const occurrence = occurrenceCounter.get(visualBarIndex) ?? 0;
            occurrenceCounter.set(visualBarIndex, occurrence + 1);

            if (!inYRange || !mbb?.visualBounds) continue;

            for (const bar of (mbb?.bars || [])) {
                const b = bar?.visualBounds || bar?.bounds || bar?.realBounds;
                if (!b) continue;
                if (!(x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) continue;

                const mb =
                    mbb?.masterBar ||
                    bar?.masterBar ||
                    bar?.bar?.masterBar ||
                    api.score?.masterBars?.[mbb.index];
                if (!mb) { console.warn('⚠️ Bar found but no masterBar reference'); continue; }

                let startTick = mb.start ?? mb.startTick ?? 0;
                if (tickCache?.masterBars) {
                    const instances = tickCache.masterBars.filter(
                        (e: any) => e.masterBar?.index === visualBarIndex
                    );
                    if (instances[occurrence] != null) {
                        startTick = instances[occurrence].start ?? startTick;
                    } else {
                        console.warn(`⚠️ Occurrence ${occurrence} not found for bar ${visualBarIndex} — ${instances.length} instances`);
                    }
                }

                const dur = typeof mb.calculateDuration === 'function'
                    ? mb.calculateDuration()
                    : (mb.endTick != null ? mb.endTick - (mb.start ?? 0) : 0);

                return {
                    masterBar: mb,
                    startTick,
                    endTick: startTick + dur,
                    barBounds: { x: b.x, y: b.y, w: b.w, h: b.h },
                };
            }
        }
    }
    return null;
}

function getAllBarBoundsInRange(api: any, startTick: number, endTick: number, refTick: number) {
    const results: { x: number; y: number; w: number; h: number }[] = [];
    const tickCache = (api as any).tickCache;

    for (const sys of (api?.renderer?.boundsLookup?.staffSystems || [])) {
        for (const mbb of ((sys as any)?.bars || [])) {
            const mb = mbb.masterBar ?? api.score?.masterBars?.[mbb.index];
            if (!mb) continue;
            const barStart = resolveExpandedBarStart(tickCache, mbb.index, refTick)
                ?? mb.start ?? mb.startTick ?? 0;
            const dur = typeof mb.calculateDuration === 'function'
                ? mb.calculateDuration()
                : (mb.endTick != null ? mb.endTick - (mb.start ?? 0) : 0);
            const barEnd = barStart + dur;
            if (barEnd > startTick && barStart < endTick) {
                for (const bar of (mbb?.bars || [])) {
                    const b = bar?.visualBounds;
                    if (b) results.push({ x: b.x, y: b.y, w: b.w, h: b.h });
                }
            }
        }
    }
    return results;
}

function getPreciseBeatHighlights(api: any, startTick: number, endTick: number, refTick: number) {
    const results: { x: number; y: number; w: number; h: number }[] = [];
    const trackIndices = api.tracks ? new Set(api.tracks.map((t: any) => t.index)) : new Set([0]);
    const tickCache = (api as any).tickCache;

    for (const sys of (api?.renderer?.boundsLookup?.staffSystems || [])) {
        for (const mbb of ((sys as any)?.bars || [])) {
            const mb = mbb.masterBar ?? api.score?.masterBars?.[mbb.index];
            if (!mb) continue;
            const barStart = resolveExpandedBarStart(tickCache, mbb.index, refTick)
                ?? mb.start ?? mb.startTick ?? 0;
            const barDur = typeof mb.calculateDuration === 'function'
                ? mb.calculateDuration() : (mb.duration ?? 0);
            const barEnd = barStart + barDur;
            if (barEnd <= startTick || barStart >= endTick) continue;

            for (const barBounds of (mbb?.bars || [])) {
                const b = barBounds?.visualBounds;
                if (!b) continue;
                if (startTick <= barStart && endTick >= barEnd) {
                    results.push({ x: b.x, y: b.y, w: b.w, h: b.h });
                } else {
                    let x1 = b.x, x2 = b.x + b.w;
                    if (tickCache) {
                        if (Math.max(startTick, barStart) > barStart) {
                            const r = tickCache.findBeat(trackIndices, Math.max(startTick, barStart));
                            if (r?.beat) { const bb2 = api.renderer.boundsLookup.findBeat(r.beat); if (bb2?.visualBounds) x1 = bb2.visualBounds.x; }
                        }
                        if (Math.min(endTick, barEnd) < barEnd) {
                            const r = tickCache.findBeat(trackIndices, Math.min(endTick, barEnd));
                            if (r?.beat) { const bb2 = api.renderer.boundsLookup.findBeat(r.beat); if (bb2?.visualBounds) x2 = bb2.visualBounds.x + bb2.visualBounds.w; }
                        }
                    }
                    results.push({ x: x1, y: b.y, w: x2 - x1, h: b.h });
                }
            }
        }
    }
    return results;
}

function getScaledPos(e: MouseEvent, surface: HTMLElement, scale: number) {
    const rect = surface.getBoundingClientRect();
    const scrollParent = surface.parentElement || surface;
    return {
        x: (e.clientX - rect.left + scrollParent.scrollLeft) / scale,
        y: (e.clientY - rect.top + scrollParent.scrollTop) / scale,
    };
}

function recomputeRects(api: any, sel: LoopSelection, mode: 'bar' | 'beat') {
    return mode === 'beat'
        ? getPreciseBeatHighlights(api, sel.startTick, sel.endTick, sel.startTick)
        : getAllBarBoundsInRange(api, sel.startTick, sel.endTick, sel.startTick);
}

/** Clamp tick into [barHit.startTick, barHit.endTick] */
function clampToBar(tick: number, barHit: BarHitResult): number {
    return Math.max(barHit.startTick, Math.min(barHit.endTick, tick));
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function CustomLoopOverlay({
    api,
    containerRef,
    surfaceRef,
    loopEnabled,
    boundsReady,
    boundsEpoch,
    onLoopToggle,
    onLoopChange,
    onLoopClear,
}: CustomLoopOverlayProps) {
    const loopSelectionRef = useRef<LoopSelection | null>(null);
    const snapModeRef = useRef<'bar' | 'beat'>('bar');
    const dragRef = useRef<DragState>({
        isDragging: false, startX: 0, startY: 0,
        startBar: null, currentBar: null,
        startTick: null, currentTick: null,
        passRefTick: 0,
    });

    const [loopSelection, setLoopSelection] = useState<LoopSelection | null>(null);
    const [snapMode, setSnapMode] = useState<'bar' | 'beat'>('bar');
    const [previewSelection, setPreviewSelection] = useState<LoopSelection | null>(null);
    // 🔒 Real React state for drag — dragRef alone is stale at render time.
    // Without this, the highlight appears with transition:none at pos 0, then
    // transition kicks in on the next render and the rect "flies in" from the left.
    const [isDraggingState, setIsDraggingState] = useState(false);

    const activeSelection = previewSelection ?? loopSelection;
    const highlightRects = useMemo(() => {
        if (!activeSelection || !api) return [];
        return recomputeRects(api, activeSelection, snapMode);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSelection, snapMode, boundsEpoch, api]);

    // ─────────────────────────────────────────
    // Auto-init: 1-bar loop at cursor when Loop toggles ON
    // ─────────────────────────────────────────

    useEffect(() => {
        if (!api || !loopEnabled || !boundsReady) return;
        if (loopSelectionRef.current) return;

        const currentTick = api.tickPosition ?? 0;
        const trackIndices = api.tracks ? new Set(api.tracks.map((t: any) => t.index)) : new Set([0]);
        const tickCache = (api as any).tickCache;
        if (!tickCache) return;

        const beatResult = tickCache.findBeat(trackIndices, currentTick);
        if (!beatResult?.beat) return;

        const masterBar = beatResult.beat.voice?.bar?.masterBar;
        if (!masterBar) return;
        const visualBarIndex = masterBar?.index;
        if (visualBarIndex == null) return;

        const expandedStart = resolveExpandedBarStart(tickCache, visualBarIndex, currentTick);
        if (expandedStart == null) return;

        const barDur = typeof masterBar.calculateDuration === 'function'
            ? masterBar.calculateDuration() : (masterBar.duration ?? 0);
        const barStart = expandedStart;
        const barEnd = barStart + barDur;

        const placeholder: BarHitResult = {
            masterBar, startTick: barStart, endTick: barEnd,
            barBounds: { x: 0, y: 0, w: 0, h: 0 },
        };
        const selection: LoopSelection = { startTick: barStart, endTick: barEnd, startBar: placeholder, endBar: placeholder };
        setLoopSelection(selection);
        loopSelectionRef.current = selection;
        applyLoopSelection(selection);
        onLoopChange?.(barStart, barEnd);
        console.log(`🎯 Auto-init loop: M${masterBar.index} expanded tick ${barStart}–${barEnd}`);
    }, [loopEnabled, boundsReady, api]);

    // ─────────────────────────────────────────
    // Loop Selection Logic
    // ─────────────────────────────────────────

    function applyLoopSelection(selection: LoopSelection) {
        console.log('🔁 LOOP SET:', { startTick: selection.startTick, endTick: selection.endTick });

        const trackIndices = api.tracks ? new Set(api.tracks.map((t: any) => t.index)) : new Set([0]);
        const tickCache = (api as any).tickCache;
        let loopEnd = selection.endTick;

        if (tickCache) {
            // Scan backward from endTick to find the last real beat in the selection.
            // A single findBeat(endTick-1) misses bars that end with a rest or tied
            // note — those have no tickCache entry near the boundary.
            const trackIndices = api.tracks ? new Set(api.tracks.map((t: any) => t.index)) : new Set([0]);
            let lastBeatResult: any = null;
            for (let t = selection.endTick - 1; t >= selection.startTick; t -= 10) {
                const r = tickCache.findBeat(trackIndices, t);
                if (r?.beat) { lastBeatResult = r; break; }
            }
            if (lastBeatResult?.beat) {
                const curBeat = lastBeatResult.beat;
                const isSameBeat = (a: any, b: any) =>
                    a?.absolutePlaybackStart === b?.absolutePlaybackStart &&
                    a?.voice?.bar?.masterBar?.index === b?.voice?.bar?.masterBar?.index;
                let expandedBeatStart = selection.endTick - 1;
                for (let t = selection.endTick - 2; t >= selection.startTick; t--) {
                    const r = tickCache.findBeat(trackIndices, t);
                    if (!r?.beat || !isSameBeat(r.beat, curBeat)) { expandedBeatStart = t + 1; break; }
                }
                const beatDur = curBeat.playbackDuration ?? curBeat.duration ?? 0;
                loopEnd = expandedBeatStart + beatDur;
                console.log(`🎵 Last beat → expandedBeatStart: ${expandedBeatStart}, dur: ${beatDur} → loopEnd: ${loopEnd}`);
            } else {
                console.log(`📐 No beat found in range, using raw boundary: ${loopEnd}`);
            }
        }

        if (api.playbackRange !== undefined) {
            // 🔒 LOOP TAIL: endTick = loopEnd + 1 (not loopEnd, not loopEnd - EPS).
            // AlphaTab's scheduler can terminate before emitting tick >= loopEnd,
            // causing the manual loop wrapper in page.tsx to never fire → early wrap.
            // +1 tail keeps the engine alive so the wrapper sees tick >= loopEnd.
            // page.tsx manual loop still wraps at: if (tick >= loopEnd) → correct.
            // This is NOT the old EPS cut-short hack — it extends by 1, not subtracts.
            api.playbackRange = { startTick: selection.startTick, endTick: loopEnd + 1 };
            console.log(`✅ playbackRange: ${selection.startTick}–${loopEnd + 1} (real end: ${loopEnd})`);
        }

        api.tickPosition = selection.startTick;
        api.isLooping = loopEnabled;
    }

    function clearLoopSelection() {
        if (api) {
            if (api.playbackRange !== undefined) api.playbackRange = null;
            api.isLooping = false;
        }
        loopSelectionRef.current = null;
        setLoopSelection(null);
        setPreviewSelection(null);
        console.log('🧹 Loop selection cleared');
        onLoopClear?.();
    }

    // ─────────────────────────────────────────
    // Beat tick resolution (used in mousedown + mousemove)
    // ─────────────────────────────────────────

    /**
     * Resolves a precise beat-mode tick at pixel position (x, y).
     *
     * 🔒 LIQUID DRAG CONTRACT:
     *   1. getBeatAtPos() finds the beat under the mouse
     *   2. resolveExpandedBeatTickFromRendererBeat gets the expanded beat START tick
     *   3. computeInsideBeatTick adds proportional intra-beat offset from mouse X
     *      → result advances continuously as mouse slides (not just on beat crossings)
     *   4. Fallback to barHit.endTick when null (mouse past last beat in bar)
     *   5. Clamp to [barHit.startTick, barHit.endTick] — prevents left-edge prev-bar snap
     *
     * DO NOT replace step 3 with just the beat start tick — that removes liquid movement.
     */
    function resolveBeatModeTick(x: number, y: number, barHit: BarHitResult, passRefTick: number): number {
        const rBeat = api.renderer?.boundsLookup?.getBeatAtPos?.(x, y);
        let preciseTick: number;

        if (rBeat) {
            const expandedBeatStart = resolveExpandedBeatTickFromRendererBeat(
                api, rBeat, passRefTick, barHit.masterBar?.index
            );
            const insideTick = expandedBeatStart != null
                ? computeInsideBeatTick(api, rBeat, expandedBeatStart, x)
                : null;

            // Diagnostic: log when liquid interpolation fails so we can see why
            if (expandedBeatStart == null || insideTick == null) {
                console.warn('⚠️ resolveBeatModeTick: liquid interp failed', {
                    hasBeat: !!rBeat,
                    beatStructuralStart: rBeat?.absolutePlaybackStart,
                    expandedBeatStart,
                    insideTick,
                    barIndex: barHit.masterBar?.index,
                    passRefTick,
                    mouseX: x,
                });
            }

            preciseTick = insideTick ?? expandedBeatStart ?? barHit.endTick;
        } else {
            // Mouse past last beat → extend to bar end
            preciseTick = barHit.endTick;
        }

        return clampToBar(preciseTick, barHit);
    }

    // ─────────────────────────────────────────
    // Mouse Handlers
    // ─────────────────────────────────────────

    const handleMouseDown = useCallback((e: MouseEvent) => {
        const surface = surfaceRef?.current;
        if (!api || !surface || !api.renderer?.boundsLookup || e.button !== 0 || !loopEnabled) return;

        const scale = api.settings?.display?.scale ?? 1;
        const { x, y } = getScaledPos(e, surface, scale);

        const barHit = findBarAtPos(api, x, y);
        const passRefTick = barHit?.startTick ?? 0;

        let preciseTick: number | null = null;
        if (snapModeRef.current === 'beat' && barHit) {
            preciseTick = resolveBeatModeTick(x, y, barHit, passRefTick);
            console.log('🎯 beatTick mousedown', { passRefTick, preciseTick, visualBar: barHit.masterBar?.index });
        } else {
            preciseTick = barHit?.startTick ?? null;
        }

        dragRef.current = {
            isDragging: true, startX: e.clientX, startY: e.clientY,
            startBar: barHit, currentBar: barHit,
            startTick: preciseTick, currentTick: preciseTick,
            passRefTick,
        };
        if (barHit) e.preventDefault();
    }, [api, surfaceRef, loopEnabled]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag.isDragging || !drag.startBar) return;
        const surface = surfaceRef?.current;
        if (!api || !surface) return;

        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);
        if (dx < CLICK_THRESHOLD_PX && dy < CLICK_THRESHOLD_PX) return;

        // First move past threshold — activate drag state for transition
        if (!isDraggingState) setIsDraggingState(true);

        const scale = api.settings?.display?.scale ?? 1;
        const { x, y } = getScaledPos(e, surface, scale);
        const mode = snapModeRef.current;

        const barHit = findBarAtPos(api, x, y);
        if (!barHit) return;

        drag.currentBar = barHit;

        let preciseTick: number;
        if (mode === 'beat') {
            preciseTick = resolveBeatModeTick(x, y, barHit, drag.passRefTick);
            if (drag.startTick != null && preciseTick === drag.currentTick) return;
        } else {
            preciseTick = barHit.endTick;
        }

        drag.currentTick = preciseTick;

        const startTick = mode === 'beat' && drag.startTick != null
            ? Math.min(drag.startTick, preciseTick)
            : Math.min(drag.startBar.startTick, barHit.startTick);
        const endTick = mode === 'beat' && drag.startTick != null
            ? Math.max(drag.startTick, preciseTick)
            : Math.max(drag.startBar.endTick, barHit.endTick);

        setPreviewSelection({ startTick, endTick, startBar: drag.startBar, endBar: barHit });
    }, [api, surfaceRef, isDraggingState]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag.isDragging) return;
        drag.isDragging = false;
        setIsDraggingState(false);

        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);

        if (dx < CLICK_THRESHOLD_PX && dy < CLICK_THRESHOLD_PX) {
            setPreviewSelection(null);
            const surface = surfaceRef.current;
            if (!api || !surface) return;
            const scale = api.settings?.display?.scale ?? 1;
            const { x, y } = getScaledPos(e, surface, scale);
            const barHit = findBarAtPos(api, x, y);
            if (!barHit) return;
            const selection: LoopSelection = {
                startTick: barHit.startTick, endTick: barHit.endTick,
                startBar: barHit, endBar: barHit,
            };
            setLoopSelection(selection);
            loopSelectionRef.current = selection;
            applyLoopSelection(selection);
            onLoopChange?.(barHit.startTick, barHit.endTick);
            return;
        }

        if (!drag.startBar || !drag.currentBar || !api) {
            setPreviewSelection(null);
            return;
        }

        const mode = snapModeRef.current;
        const startTick = mode === 'beat' && drag.startTick != null && drag.currentTick != null
            ? Math.min(drag.startTick, drag.currentTick)
            : Math.min(drag.startBar.startTick, drag.currentBar.startTick);
        const endTick = mode === 'beat' && drag.startTick != null && drag.currentTick != null
            ? Math.max(drag.startTick, drag.currentTick)
            : Math.max(drag.startBar.endTick, drag.currentBar.endTick);

        if (startTick === endTick) {
            const surface2 = surfaceRef.current;
            if (!surface2) { setPreviewSelection(null); return; }
            const scale2 = api.settings?.display?.scale ?? 1;
            const { x: ex, y: ey } = getScaledPos(e, surface2, scale2);
            const barHit2 = findBarAtPos(api, ex, ey);
            if (!barHit2) { setPreviewSelection(null); return; }
            const committed: LoopSelection = {
                startTick: barHit2.startTick, endTick: barHit2.endTick,
                startBar: barHit2, endBar: barHit2,
            };
            setLoopSelection(committed);
            loopSelectionRef.current = committed;
            setPreviewSelection(null);
            applyLoopSelection(committed);
            onLoopChange?.(committed.startTick, committed.endTick);
            return;
        }

        const startBar = drag.startBar.startTick <= drag.currentBar.startTick ? drag.startBar : drag.currentBar;
        const endBar = drag.startBar.startTick <= drag.currentBar.startTick ? drag.currentBar : drag.startBar;

        const committed: LoopSelection = { startTick, endTick, startBar, endBar };
        setLoopSelection(committed);
        loopSelectionRef.current = committed;
        setPreviewSelection(null);
        applyLoopSelection(committed);
        onLoopChange?.(startTick, endTick);
    }, [api, surfaceRef, onLoopChange]);

    // ─────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────

    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface || !loopEnabled) return;
        surface.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            surface.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseDown, handleMouseMove, handleMouseUp, loopEnabled]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && loopSelectionRef.current) clearLoopSelection();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // ─────────────────────────────────────────
    // Controls
    // ─────────────────────────────────────────

    const handleToggleSnapMode = () => {
        const newMode = snapMode === 'bar' ? 'beat' : 'bar';
        snapModeRef.current = newMode;
        setSnapMode(newMode);
        console.log(`🎛️ Snap mode: ${newMode}`);
    };

    const scale = api?.settings?.display?.scale ?? 1;

    // ─────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────

    return (
        <>
            {highlightRects.length > 0 && (
                <div style={{
                    position: 'absolute', top: 0, left: 0,
                    width: '100%', height: '100%',
                    pointerEvents: 'none', zIndex: 900,
                }}>
                    {highlightRects.map((rect, i) => (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                left: rect.x * scale,
                                top: rect.y * scale,
                                width: rect.w * scale,
                                height: rect.h * scale,
                                background: 'rgba(33, 150, 243, 0.3)',
                                border: '2px solid rgba(33, 150, 243, 0.7)',
                                pointerEvents: 'none',
                                zIndex: 901,
                                // 🔒 Transition only during established drag (isDraggingState is React state).
                                // dragRef.current.isDragging is stale at render time — using it caused
                                // the highlight to "fly in" from left on initial drag appear.
                                transition: isDraggingState
                                    ? 'left 0.06s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.06s cubic-bezier(0.25, 0.1, 0.25, 1)'
                                    : 'none',
                                willChange: isDraggingState ? 'left, width' : 'auto',
                            }}
                        />
                    ))}
                </div>
            )}

            <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', gap: '10px', zIndex: 10001 }}>
                <button
                    onClick={handleToggleSnapMode}
                    style={{
                        padding: '10px 15px', fontSize: '14px', cursor: 'pointer',
                        background: snapMode === 'beat' ? '#9c27b0' : '#607d8b',
                        color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold',
                    }}
                >
                    {snapMode === 'beat' ? '🎵 Beat Snap' : '📦 Bar Snap'}
                </button>

                <button
                    onClick={() => {
                        const newEnabled = !loopEnabled;
                        onLoopToggle?.(newEnabled);
                        if (!newEnabled && loopSelection) clearLoopSelection();
                        console.log(`🔁 Loop mode ${newEnabled ? 'ENABLED' : 'DISABLED'}`);
                    }}
                    style={{
                        padding: '10px 15px', fontSize: '14px', cursor: 'pointer',
                        background: loopEnabled ? '#4caf50' : '#ff9800',
                        color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold',
                    }}
                >
                    {loopEnabled ? '🔁 Loop: ON' : '🔁 Loop: OFF'}
                </button>

                <button
                    onClick={() => clearLoopSelection()}
                    disabled={!loopSelection}
                    style={{
                        padding: '10px 15px', fontSize: '14px',
                        cursor: loopSelection ? 'pointer' : 'not-allowed',
                        background: loopSelection ? '#f44336' : '#ccc',
                        color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold',
                    }}
                >
                    🧹 Clear
                </button>
            </div>
        </>
    );
}