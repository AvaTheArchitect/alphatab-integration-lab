'use client';

/**
 * BeatCustomLoopOverlay v1.7.5 — beatCrossed Gate + Zero Fan-Out
 * Date: February 23rd, 2026
 *
 * 🔥 V1.7.5 CHANGES:
 * ✅ beatCrossedRef REPLACES sameBeat CHECK: v1.7.4's intent gate checked
 *    `sameBeat` (tickOf(lo) === tickOf(hi)) at mouseup time. This failed when
 *    the resolver returned a different beat at mouseup than at mousedown due to
 *    tiny trackpad drift — sameBeat became false even though the user never
 *    intentionally dragged. Result: bar-snap didn't fire, "stuck on 1–2 beats."
 *
 *    Fix: beatCrossedRef tracks whether any onMove event ever resolved a
 *    different beat tick than the mousedown beat. This is the ground truth of
 *    "did a drag happen" — immune to resolver drift at mouseup time.
 *
 *    Intent gate: !beatCrossedRef.current && pixelDist < 10 → bar-snap
 *    Everything else → v1.6 beat-level commit
 *
 * ✅ ZERO FAN-OUT: onDown no longer calls setRects at all. The single-beat
 *    rect that caused the "fan-out" animation (small rect → full bar on mouseup)
 *    is never painted. Rects only appear from:
 *      - onMove (drag feedback — first paint when user actually moves)
 *      - onUp bar-snap (full bar painted directly)
 *      - onUp beat-level (final drag range painted)
 *
 *    The 80ms deferred timer from v1.7.4 is removed — it didn't work because
 *    click-holds (press, hesitate, release) exceeded the timer and still showed
 *    the single-beat rect before bar-snap.
 *
 * ✅ V1.7.4 IMPROVEMENTS PRESERVED:
 *    - getBarEdgesFromBeat: beat graph traversal (previousBeat/nextBeat)
 *    - getExpandedBarRange: structural fallback for non-repeat edge cases
 *    - commitBarSnap accepts beat object (no re-resolution by tick)
 *    - Single-authority onUp (no onClick handler, no isDragCommitted)
 *    - All v1.6 code intact (buildRects, resolveBeatWithX, midpoint trimming)
 *
 * INTENT GATE TRUTH TABLE:
 *   beatCrossed | pixelDist | Result
 *   false       | < 10      | Bar-snap ✅ (clean click)
 *   false       | ≥ 10      | Beat-level (v1.6) — trackpad drift, harmless
 *   true        | any       | Beat-level (v1.6) ✅ — real drag
 *
 * Previous versions:
 * 🔥 V1.7.4: Beat-first bar-snap (getBarEdgesFromBeat), structural fallback
 * 🔥 V1.7.3: Single-authority onUp, removed isDragCommitted/onClick dual-path
 * 🔥 V1.7.2: getExpandedBarRange for repeat-safe bar-snap ticks
 * 🔥 V1.7:   Bar-snap on toggle + click
 * 🔥 V1.6:   Expanded tick resolution — tickOf() via tickCache.getBeatStart()
 * 🔥 V1.5:   Midpoint-Interspace Magnet-Snap
 * 🔥 V1.4–V1.0: See git history
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * V1.6 NOTES (preserved — do not remove):
 *
 * beat.absolutePlaybackStart is structural (pass-1 only). In a repeat x3
 * section, all three passes of Measure 25 share the same absolutePlaybackStart
 * (e.g. 96000). tickOf() uses tickCache.getBeatStart(beat) which returns the
 * correct expanded tick from the engine's repeat-aware MIDI timeline.
 * Reference: CoderLine/alphaTab#2548, AlphaTabApiBase.ts:3241
 * Fallback: absolutePlaybackStart when tickCache/getBeatStart unavailable.
 * Fallback warns once only.
 * container prop — scopes .at-surface query for multi-instance safety.
 */

import React, { useEffect, useRef, useState } from 'react';

interface HighlightRect { x: number; y: number; w: number; h: number; }

interface Props {
    api: any;
    container?: HTMLElement | null;
    loopEnabled: boolean;
    onLoopToggle?: (enabled: boolean) => void;
    onLoopChange?: (startTick: number, endTick: number) => void;
    onLoopClear?: () => void;
}

export default function BeatCustomLoopOverlay({
    api, container, loopEnabled, onLoopToggle, onLoopChange, onLoopClear,
}: Props) {

    const loopRef = useRef(loopEnabled);
    const isDragging = useRef(false);
    const startBeat = useRef<any>(null);
    const endBeat = useRef<any>(null);
    const downXRef = useRef<number>(0);
    const downYRef = useRef<number>(0);
    const downTickRef = useRef<number | null>(null);
    const beatCrossedRef = useRef(false);

    // 🔒 Warn once only
    const tickCacheWarnedRef = useRef(false);

    const [rects, setRects] = useState<HighlightRect[]>([]);

    useEffect(() => { loopRef.current = loopEnabled; }, [loopEnabled]);

    // ─────────────────────────────────────────
    // Beat geometry helpers (unchanged from v1.6)
    // ─────────────────────────────────────────

    const getBeatVB = (beat: any) =>
        api?.renderer?.boundsLookup?.findBeat(beat)?.visualBounds ?? null;

    const beatCenter = (beat: any): number | null => {
        const vb = getBeatVB(beat);
        return vb ? vb.x + vb.w / 2 : null;
    };

    const isFirstBeatInBar = (beat: any): boolean => {
        const prev = beat?.previousBeat;
        if (!prev) return true;
        const curBar = beat?.voice?.bar?.index ?? beat?.voice?.bar?.masterBar?.index;
        const prevBar = prev?.voice?.bar?.index ?? prev?.voice?.bar?.masterBar?.index;
        return curBar !== prevBar;
    };

    const isLastBeatInBar = (beat: any): boolean => {
        const next = beat?.nextBeat;
        if (!next) return true;
        const curBar = beat?.voice?.bar?.index ?? beat?.voice?.bar?.masterBar?.index;
        const nextBar = next?.voice?.bar?.index ?? next?.voice?.bar?.masterBar?.index;
        return curBar !== nextBar;
    };

    // ─────────────────────────────────────────
    // Tick resolution (unchanged from v1.6)
    // ─────────────────────────────────────────

    /** 🔒 V1.6 — DO NOT replace with beat.absolutePlaybackStart */
    const tickOf = (beat: any): number => {
        const tickCache = (api as any)?.tickCache;
        if (tickCache && typeof tickCache.getBeatStart === 'function') {
            return tickCache.getBeatStart(beat);
        }
        if (!tickCacheWarnedRef.current) {
            tickCacheWarnedRef.current = true;
            console.warn('⚠️ tickCache.getBeatStart unavailable — falling back to absolutePlaybackStart (repeat sections may be wrong)');
        }
        return beat?.absolutePlaybackStart ?? 0;
    };

    const durOf = (b: any): number => b?.playbackDuration ?? b?.duration ?? 0;

    const loHi = (a: any, b: any): [any, any] =>
        tickOf(a) <= tickOf(b) ? [a, b] : [b, a];

    // ─────────────────────────────────────────
    // Bar-edge helpers (V1.7.4 — beat-first graph traversal)
    // ─────────────────────────────────────────

    /**
     * V1.7.4 — Walks the beat's linked list (previousBeat/nextBeat) to find
     * first and last beats in the same bar. 100% reliable — no tickCache needed.
     */
    const getBarEdgesFromBeat = (beat: any): { first: any; last: any } | null => {
        if (!beat) return null;
        const barIdx = beat?.voice?.bar?.index ?? beat?.voice?.bar?.masterBar?.index;
        if (barIdx == null) return null;

        let first = beat;
        while (first.previousBeat) {
            const prevBarIdx = first.previousBeat?.voice?.bar?.index
                ?? first.previousBeat?.voice?.bar?.masterBar?.index;
            if (prevBarIdx !== barIdx) break;
            first = first.previousBeat;
        }

        let last = beat;
        while (last.nextBeat) {
            const nextBarIdx = last.nextBeat?.voice?.bar?.index
                ?? last.nextBeat?.voice?.bar?.masterBar?.index;
            if (nextBarIdx !== barIdx) break;
            last = last.nextBeat;
        }

        return { first, last };
    };

    /**
     * V1.7.4 — Expanded bar range with structural fallback.
     * Primary: tickCache.masterBars traversal (repeat-safe).
     * Fallback: beat's own masterBar data (structural — wrong in repeats).
     */
    const getExpandedBarRange = (tick: number, beat?: any): { startTick: number; endTick: number } | null => {
        const tickCache = (api as any)?.tickCache;
        const masterBarsArr = (tickCache as any)?.masterBars as any[];

        if (masterBarsArr?.length) {
            for (const mb of masterBarsArr) {
                const dur = mb?.masterBar?.calculateDuration?.() ?? 0;
                if (dur <= 0) continue;
                if (tick >= mb.start && tick < mb.start + dur) {
                    return { startTick: mb.start, endTick: mb.start + dur };
                }
            }
        }

        if (beat) {
            const mb = beat?.voice?.bar?.masterBar;
            if (mb) {
                const start = mb.start ?? 0;
                const dur = typeof mb.calculateDuration === 'function'
                    ? mb.calculateDuration() : (mb.duration ?? 1920);
                if (dur > 0) {
                    console.warn('⚠️ getExpandedBarRange: masterBars miss — using structural fallback');
                    return { startTick: start, endTick: start + dur };
                }
            }
        }

        return null;
    };

    /**
     * V1.7.5 — Direct bar geometry renderer. Bypasses buildRects entirely.
     * No midpoint trimming, no center averaging, no merge heuristics.
     * Draws exact visualBounds of the bar — zero fan-out possible.
     *
     * Used by commitBarSnap ONLY. Drag path still uses buildRects.
     */
    const buildBarRects = (barIndex: number): HighlightRect[] => {
        const results: HighlightRect[] = [];
        const systems = api?.renderer?.boundsLookup?.staffSystems ?? [];
        for (const sys of systems) {
            for (const mbb of (sys?.bars ?? [])) {
                const idx = mbb?.masterBar?.index ?? mbb?.index;
                if (idx !== barIndex) continue;
                for (const bar of (mbb?.bars ?? [])) {
                    const b = bar?.visualBounds;
                    if (!b) continue;
                    results.push({ x: b.x, y: b.y, w: b.w, h: b.h });
                }
            }
        }
        return results;
    };

    /**
     * V1.7.5 — Unified bar-snap commit. Accepts a BEAT OBJECT.
     * Uses buildBarRects for geometry (direct bar bounds — no midpoint math).
     * Uses getExpandedBarRange for ticks (repeat-safe).
     * Returns true on success, false if helpers fail (falls through to beat-level).
     */
    const commitBarSnap = (beat: any, source: string): boolean => {
        const range = getExpandedBarRange(tickOf(beat), beat);
        const barIdx = beat?.voice?.bar?.index ?? beat?.voice?.bar?.masterBar?.index;

        if (!range || barIdx == null) {
            console.warn(`⚠️ commitBarSnap(${source}): helpers returned null`, {
                hasRange: !!range, barIdx,
                tick: tickOf(beat),
            });
            return false;
        }

        const { startTick, endTick } = range;

        console.log(`🎼 BeatLoop bar-snap (${source}):`, {
            startTick, endTick, barIdx,
        });

        api.playbackRange = { startTick, endTick };
        api.isLooping = true;
        setRects(buildBarRects(barIdx));
        onLoopChange?.(startTick, endTick);
        return true;
    };

    // ─────────────────────────────────────────
    // Rect builder — midpoint-interspace trimming (unchanged from v1.6)
    // ─────────────────────────────────────────

    const buildRects = (lo: any, hi: any): HighlightRect[] => {
        if (!lo || !hi || !api?.renderer?.boundsLookup) return [];

        const loBarIdx = lo?.voice?.bar?.index ?? lo?.voice?.bar?.masterBar?.index;
        const hiBarIdx = hi?.voice?.bar?.index ?? hi?.voice?.bar?.masterBar?.index;
        if (loBarIdx == null || hiBarIdx == null) return [];

        const minBar = Math.min(loBarIdx, hiBarIdx);
        const maxBar = Math.max(loBarIdx, hiBarIdx);

        let x1Global: number | null = null;
        const loVB = getBeatVB(lo);
        if (isFirstBeatInBar(lo)) {
            x1Global = null;
        } else {
            const prevCenter = beatCenter(lo.previousBeat);
            const curCenter = beatCenter(lo);
            if (prevCenter != null && curCenter != null) {
                x1Global = (prevCenter + curCenter) / 2;
            } else if (loVB) {
                x1Global = loVB.x;
            }
        }

        let x2Global: number | null = null;
        const hiVB = getBeatVB(hi);
        if (isLastBeatInBar(hi)) {
            x2Global = null;
        } else {
            const curCenter = beatCenter(hi);
            const nextCenter = beatCenter(hi.nextBeat);
            if (curCenter != null && nextCenter != null) {
                x2Global = (curCenter + nextCenter) / 2;
            } else if (hiVB) {
                x2Global = hiVB.x + hiVB.w;
            }
        }

        const results: HighlightRect[] = [];
        const systems = api.renderer.boundsLookup.staffSystems ?? [];

        for (const sys of systems) {
            for (const mbb of (sys?.bars ?? [])) {
                const idx = mbb?.masterBar?.index ?? mbb?.index;
                if (idx == null || idx < minBar || idx > maxBar) continue;

                for (const bar of (mbb?.bars ?? [])) {
                    const b = bar?.visualBounds;
                    if (!b) continue;

                    const x1 = (idx === minBar && x1Global != null) ? x1Global : b.x;
                    const x2 = (idx === maxBar && x2Global != null) ? x2Global : b.x + b.w;
                    const w = Math.max(x2 - x1, 2);

                    const last = results[results.length - 1];
                    if (last && Math.abs(last.y - b.y) < 4 && Math.abs((last.x + last.w) - x1) < 6) {
                        last.w = (x1 + w) - last.x;
                    } else {
                        results.push({ x: x1, y: b.y, w, h: b.h });
                    }
                }
            }
        }

        return results;
    };

    // ─────────────────────────────────────────
    // Beat resolver (unchanged from v1.6)
    // ─────────────────────────────────────────

    const resolveBeatWithX = (e: MouseEvent): { beat: any; mouseX: number } | null => {
        const engine = (api as any)?.boundsLookup ?? api?.renderer?.boundsLookup;
        if (!engine) return null;

        const surface = (e.target as HTMLElement).closest?.('.at-surface') as HTMLElement | null;
        if (!surface) return null;

        const domRect = surface.getBoundingClientRect();
        const x = (e.clientX - domRect.left) + (surface.scrollLeft ?? 0);
        const y = (e.clientY - domRect.top) + (surface.scrollTop ?? 0);

        const raw = engine.getBeatAtPos(x, y);
        const beat = raw?.beat ?? raw ?? null;
        if (beat) return { beat, mouseX: x };

        const systems = api?.renderer?.boundsLookup?.staffSystems ?? [];
        let nearestBeat: any = null;
        let nearestDist = Infinity;

        for (const sys of systems) {
            const sb = sys?.visualBounds ?? sys?.realBounds;
            if (!sb || y < sb.y - 10 || y > sb.y + sb.h + 10) continue;

            for (const mbb of (sys?.bars ?? [])) {
                for (const bar of (mbb?.bars ?? [])) {
                    const b = bar?.visualBounds;
                    if (!b || x < b.x - 20 || x > b.x + b.w + 20) continue;

                    const tickCache = (api as any).tickCache;
                    const trackIndices = api.tracks
                        ? new Set(api.tracks.map((t: any) => t.index))
                        : new Set([0]);

                    if (tickCache) {
                        const mb = mbb?.masterBar;
                        const barStart = mbb?.start ?? mb?.start ?? 0;
                        const barDur = typeof mb?.calculateDuration === 'function'
                            ? mb.calculateDuration() : (mb?.duration ?? 1920);

                        for (let t = barStart; t < barStart + barDur; t += 30) {
                            const r = tickCache.findBeat(trackIndices, t);
                            if (!r?.beat) continue;
                            const vb = getBeatVB(r.beat);
                            if (!vb) continue;
                            const cx = vb.x + vb.w / 2;
                            const dist = Math.abs(cx - x);
                            if (dist < nearestDist) {
                                nearestDist = dist;
                                nearestBeat = r.beat;
                            }
                        }
                    }
                }
            }
        }

        return nearestBeat ? { beat: nearestBeat, mouseX: x } : null;
    };

    // ─────────────────────────────────────────
    // Mouse handlers — v1.7.5: beatCrossed gate + zero fan-out
    // ─────────────────────────────────────────

    useEffect(() => {
        if (!api) return;
        const surface = (container ?? document).querySelector('.at-surface') as HTMLElement | null;
        if (!surface) { console.error('❌ BeatOverlay: .at-surface not found'); return; }

        // ── onDown — record anchors, NO rect painting ─────────
        // V1.7.5: Do NOT call setRects here. This eliminates fan-out entirely.
        // On click: onUp paints the full bar directly (no single-beat flash).
        // On drag: first onMove paints the drag range (imperceptible delay).
        const onDown = (e: MouseEvent) => {
            if (!loopRef.current) return;
            const result = resolveBeatWithX(e);
            if (!result) return;

            isDragging.current = true;
            downXRef.current = e.clientX;
            downYRef.current = e.clientY;
            startBeat.current = result.beat;
            endBeat.current = result.beat;
            downTickRef.current = tickOf(result.beat);
            beatCrossedRef.current = false;
        };

        // ── onMove — beatCrossed tracking + gated painting ──
        // V1.7.5: setRects ONLY fires after a beat boundary is crossed.
        // This prevents single-beat rect flash on clicks (fan-out source).
        //
        // CRITICAL: Paint in the SAME event that detects the crossing, not
        // the next one. Without this, the user has to overshoot to beat 2
        // and then the rect only appears on the following mousemove — feels
        // like a one-frame lag / "have to drag past then come back."
        const onMove = (e: MouseEvent) => {
            if (!isDragging.current || !startBeat.current) return;
            const result = resolveBeatWithX(e);
            if (!result) return;

            endBeat.current = result.beat;

            // Track whether the user ever crossed a beat boundary
            const curTick = tickOf(result.beat);
            if (downTickRef.current != null && curTick !== downTickRef.current) {
                beatCrossedRef.current = true;
            }

            // Only paint rects once a real drag is confirmed (beat crossed).
            // Paints immediately on the same event that flips the flag.
            if (!beatCrossedRef.current) return;

            const [lo, hi] = loHi(startBeat.current, result.beat);
            setRects(buildRects(lo, hi));
        };

        // ── onUp — SOLE AUTHORITY (v1.7.3+ architecture) ─────
        //
        // V1.7.5 Intent Gate:
        //   Bar-snap: !beatCrossedRef.current AND pixelDist < CLICK_DIST
        //   Beat-level: everything else (v1.6 path — always the fallback)
        //
        // WHY beatCrossedRef is better than sameBeat:
        //   sameBeat (tickOf(lo) === tickOf(hi)) checks resolver state at mouseup.
        //   If the resolver drifts to an adjacent beat due to tiny trackpad movement,
        //   sameBeat becomes false and bar-snap fails → "stuck on 1–2 beats."
        //   beatCrossedRef tracks what happened DURING the gesture — if no onMove
        //   ever resolved a different beat, it's a click. Period.
        const onUp = (e: MouseEvent) => {
            if (!isDragging.current) return;
            isDragging.current = false;

            const sb = startBeat.current;
            const eb = endBeat.current;
            if (!sb) return;

            const dx = (e?.clientX ?? downXRef.current) - downXRef.current;
            const dy = (e?.clientY ?? downYRef.current) - downYRef.current;
            const pixelDist = Math.sqrt(dx * dx + dy * dy);

            // ── Click → bar-snap ───────────────────────────────
            // V1.7.5: beatCrossedRef is the sole click discriminator.
            // Pixel distance removed — trackpads generate 20–30px drift on
            // steady clicks, making any fixed threshold unreliable.
            // beatCrossedRef is the musical truth: if no onMove ever resolved
            // a different beat tick, the user never made a musical drag.
            // Worst case: within-beat drag → bar-snap (better than single-beat loop).
            if (!beatCrossedRef.current) {
                if (commitBarSnap(sb, 'click')) return;
                // If bar-snap helpers fail, fall through to beat-level
            }

            // ── Drag → v1.6 beat-level commit ──────────────────
            const [lo, hi] = loHi(sb, eb ?? sb);
            const startTick = tickOf(lo);
            const endTick = tickOf(hi) + durOf(hi);

            console.log('🎼 BeatLoop committed:', {
                startTick,
                endTick,
                pixelDist: pixelDist.toFixed(1),
                beatCrossed: beatCrossedRef.current,
                loAbsStart: lo?.absolutePlaybackStart,
                hiAbsStart: hi?.absolutePlaybackStart,
                expandedMatch: startTick !== lo?.absolutePlaybackStart ? '✅ expanded' : '⚠️ structural (no repeat)',
            });

            api.playbackRange = { startTick, endTick };
            api.isLooping = true;
            setRects(buildRects(lo, hi));
            onLoopChange?.(startTick, endTick);
        };

        surface.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        return () => {
            surface.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [api, container]);

    // ─────────────────────────────────────────
    // Toggle-snap — bar highlight on loop ON (V1.7)
    // ─────────────────────────────────────────

    useEffect(() => {
        if (!loopEnabled || !api) return;
        if (api.playbackRange) return;

        const tick = (api as any).tickPosition ?? 0;

        const tickCache = (api as any)?.tickCache;
        if (tickCache) {
            const trackIndices = api.tracks
                ? new Set(api.tracks.map((t: any) => t.index))
                : new Set([0]);
            const result = tickCache.findBeat(trackIndices, tick);
            if (result?.beat) {
                commitBarSnap(result.beat, 'toggle ON');
                return;
            }
        }

        const range = getExpandedBarRange(tick);
        if (range) {
            console.log('🎼 BeatLoop bar-snap (toggle ON, tick-only fallback):', range);
            api.playbackRange = { startTick: range.startTick, endTick: range.endTick };
            api.isLooping = true;
            onLoopChange?.(range.startTick, range.endTick);
        }
    }, [loopEnabled]);

    // ─────────────────────────────────────────
    // Re-render sync — rebuild rects after AlphaTab layout changes
    // ─────────────────────────────────────────

    /**
     * V1.7.5 — When AlphaTab re-renders (dev tools open/close, window resize,
     * fullscreen toggle, container width change), all internal coordinates shift
     * but the overlay rects are stale. Hook renderFinished to rebuild rects from
     * the current playbackRange using fresh geometry.
     *
     * Uses buildRects (beat-level midpoint trimming) for drag ranges and
     * buildBarRects for full-bar ranges. Both produce correct output because
     * isFirstBeatInBar/isLastBeatInBar handle the full-bar case naturally.
     */
    useEffect(() => {
        if (!api) return;

        const rebuildFromPlaybackRange = () => {
            const range = api.playbackRange;
            if (!range) return;

            const tickCache = (api as any)?.tickCache;
            if (!tickCache) return;

            // Guard: skip if boundsLookup is in a partial/transitional state
            const systems = api?.renderer?.boundsLookup?.staffSystems;
            if (!systems?.length) return;

            const trackIndices = api.tracks
                ? new Set(api.tracks.map((t: any) => t.index))
                : new Set([0]);

            const startResult = tickCache.findBeat(trackIndices, range.startTick);
            const endResult = tickCache.findBeat(trackIndices, range.endTick - 1);
            if (!startResult?.beat || !endResult?.beat) return;

            const startBarIdx = startResult.beat?.voice?.bar?.index
                ?? startResult.beat?.voice?.bar?.masterBar?.index;
            const endBarIdx = endResult.beat?.voice?.bar?.index
                ?? endResult.beat?.voice?.bar?.masterBar?.index;

            // Full-bar selection → buildBarRects (clean, no midpoint math)
            if (startBarIdx != null && startBarIdx === endBarIdx
                && isFirstBeatInBar(startResult.beat)
                && isLastBeatInBar(endResult.beat)) {
                const barRects = buildBarRects(startBarIdx);
                // Guard: skip if geometry produced zero-width rects (transitional)
                if (barRects.length && barRects.every(r => r.w > 0)) {
                    setRects(barRects);
                    return;
                }
            }

            // Beat-level selection → buildRects (midpoint trimming)
            const [lo, hi] = loHi(startResult.beat, endResult.beat);
            const newRects = buildRects(lo, hi);
            if (newRects.length && newRects.every(r => r.w > 0)) {
                setRects(newRects);
            }
        };

        const handleRenderFinished = () => {
            // 🔥 Cancel any in-progress drag — layout changes invalidate all
            // gesture state. Without this, isDragging stays true after resize
            // and mousemove hijacks the overlay (ghost-drag).
            isDragging.current = false;
            startBeat.current = null;
            endBeat.current = null;
            beatCrossedRef.current = false;

            // Double-RAF: wait for layout to fully settle.
            // Frame 1 → DOM resized, AlphaTab begins reflow
            // Frame 2 → boundsLookup fully populated with final coords
            // Opening dev tools causes multiple resize events + layout passes.
            // Single RAF was too early — rebuilt from transitional geometry,
            // causing rects to "fall down" or stick at wrong bar edges.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    rebuildFromPlaybackRange();
                });
            });
        };

        api.renderer.renderFinished.on(handleRenderFinished);
        return () => {
            api.renderer.renderFinished.off(handleRenderFinished);
        };
    }, [api]);

    // ─────────────────────────────────────────
    // Clear
    // ─────────────────────────────────────────

    const clearLoop = () => {
        api.isLooping = false;
        api.playbackRange = null;
        startBeat.current = null;
        endBeat.current = null;
        setRects([]);
        onLoopClear?.();
    };

    // ─────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────

    return (
        <>
            <style>{`
                .beat-loop-highlight {
                    position: absolute;
                    background: rgba(33, 150, 243, 0.25);
                    border: 2px solid rgba(33, 150, 243, 0.65);
                    pointer-events: none;
                    z-index: 900;
                    box-sizing: border-box;
                    transition: none !important;
                }
            `}</style>

            {rects.map((r, i) => (
                <div key={i} className="beat-loop-highlight" style={{
                    left: r.x, top: r.y, width: r.w, height: r.h,
                }} />
            ))}

            <div style={{
                position: 'fixed', bottom: 20, right: 20,
                display: 'flex', gap: '10px', zIndex: 10001,
            }}>
                <button
                    onClick={() => {
                        const next = !loopEnabled;
                        onLoopToggle?.(next);
                        if (!next) clearLoop();
                        console.log(`🔁 Loop mode ${next ? 'ENABLED' : 'DISABLED'}`);
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
                    onClick={clearLoop}
                    disabled={!loopEnabled}
                    style={{
                        padding: '10px 15px', fontSize: '14px',
                        cursor: loopEnabled ? 'pointer' : 'not-allowed',
                        background: loopEnabled ? '#f44336' : '#ccc',
                        color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold',
                    }}
                >
                    🧹 Clear
                </button>
            </div>
        </>
    );
}