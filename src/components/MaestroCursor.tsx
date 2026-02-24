'use client';

/**
 * MaestroCursor v4.5 — Production Master
 * ⚠️ API VERSION: setTick(tick, nextBeat?, overrideBeatStart?) — THREE args
 * page.tsx must call: cursor.setTick(authorityTick, nextBeat, expandedBeatStart)
 *
 * Date: February 22nd, 2026
 *
 * 🔒🔒🔒 CURSOR ENGINE LOCK — DO NOT SIMPLIFY 🔒🔒🔒
 *
 * 🔥 V4.5 CHANGES:
 * ✅ PAUSE CLAMP: When playback is stopped and progress >= 0.999, interpolatedX
 *    is clamped to currentNoteX instead of walking to the barline.
 *
 *    Root cause: the last beat of a loop range has no nextBeatCenterX (Mode B),
 *    so it walks to the masterBar right edge. With correct expanded tick boundaries
 *    (introduced in BeatCustomLoopOverlay v1.7.1 + page.tsx v5.30), progress now
 *    reaches exactly 1.000 at loop end. On pause, the cursor parked at the barline
 *    rather than the note head.
 *
 *    This was always latent in v4.4 — correct loop math in the overlay exposed it.
 *    Mid-measure pauses are unaffected (Mode A clamps at nextBeatCenterX already).
 *
 *    Fix is strictly post-interpolation. Nothing else touched:
 *    — nextBeatCenterX logic unchanged
 *    — walk mode system unchanged
 *    — interpolation math unchanged
 *    — beat/repeat resolution unchanged
 *    — setBeat() unchanged
 *    — requestSnap() unchanged
 *
 * Version history / why each was wrong:
 *   ❌ v3.3:     one-arg setTick(), beat.nextBeat structural (wrong in repeats). Works
 *                smoothly because AlphaTab fires playerPositionChanged many times/beat.
 *   ❌ v4.3.1:   3-arg setTick(), no RAF → smooth (events drive rendering directly).
 *                BUT setBeat() drops nextBeat lookup → nextBeatCenterX always null when
 *                page.tsx calls setTick(tick) one-arg → stepping.
 *   ❌ v4.3.2:   Added RAF because of false assumption "playerPositionChanged fires
 *                once/beat." The log was throttled — events actually fire ~10-30fps.
 *                RAF caused drift: lastTickTime never resets on pause → elapsed grows
 *                unbounded → cursor walks forward while stopped.
 *   ❌ v4.3.3:   RAF + cap at beatEnd → cursor parks at wrong position on pause.
 *                Debug label was purple (rgba(128,0,200)) instead of red.
 *   ✅ v4.3.4:   RAF removed entirely. Direct rendering in setTick() (like v3.3).
 *                Hybrid nextBeat: setBeat() resolves beat.nextBeat as structural default,
 *                setTick()'s nextBeat arg overrides for repeat-aware walk.
 *                SVG + cursorWidth restored to v3.3 exactly (14px, hardcoded geometry).
 *                Red debug label restored.
 *   ❌ v4.3.5:   setTick() mutates nextBeatCenterX on every call.
 *                If page.tsx passes a nextBeat that fails sameBar/sameRow check,
 *                the else branch sets nextBeatCenterX = null → mode switches to barline
 *                mid-beat → different endpoint → visible jerk backward on whammy notes.
 *   ❌ v4.3.6:   Cipher's RAF ratchet refactor — far more issues than it solved.
 *   ❌ v4.3.7:   Pure ratio walk (vbX + progress × vbW). Eliminated mode switching
 *                but AlphaTab assigns near-zero vbW to long/whammy sustained notes →
 *                cursor barely moves on those beats → visual stutter.
 *   ✅ v4.4:     Production master. Two audit improvements applied:
 *                1. Log key changed from beatStart → beatStartToUse so repeat passes
 *                   each log independently (beatStart is structural/same every pass;
 *                   beatStartToUse is expanded/unique per pass).
 *                2. Early return guard extended: `!this.currentBeat || this.beatDuration <= 0`
 *                   defends against malformed/zero-duration beats from edge-case GP files.
 *   ✅ v4.5:     Pause clamp — see top of file.
 *
 * Walk modes (DO NOT collapse into one — vbW is near-zero on sustained/whammy notes):
 *   MODE A (nextBeatCenterX set):   walk currentNoteX → nextBeatCenterX
 *   MODE B (nextBeatCenterX null):  walk currentNoteX → masterBar right edge (barline)
 *   Mode is LOCKED for the entire beat duration. setTick() never clears the mode.
 *
 * Contract (DO NOT CHANGE):
 *   page.tsx → cursor.setBeat(beat)
 *   page.tsx → cursor.setTick(tick)                          ← 1-arg: structural walk
 *   page.tsx → cursor.setTick(tick, nextBeat, beatStart)     ← 3-arg: repeat-aware walk
 *   cursor   → owns all interpolation, no external math needed
 *   page.tsx → NEVER computes interpolation math
 */

interface Beat {
    absolutePlaybackStart?: number;
    playbackStart?: number;
    playbackDuration?: number;
    duration?: number;
    nextBeat?: Beat | null;
    voice?: any;
    [key: string]: any;
}

export class MaestroCursor {
    private element: HTMLElement;
    private api: any;

    // Cursor styling — v3.3 dimensions (DO NOT change to 12px — affects color/shape)
    private readonly cursorWidth = 14;
    private readonly topOverhang = 26;
    private readonly bottomOverhang = 12;
    private readonly bottomPointBaseShift = 2;

    // Current beat geometry
    private currentBeat: Beat | null = null;
    private currentNoteX: number = 0;
    private currentY: number = 0;
    private currentHeight: number = 0;
    private currentVbW: number = 0;
    // 🔒 Frozen at setBeat(). setTick() may only SET if null, NEVER clear.
    private nextBeatCenterX: number | null = null;

    // Beat timing
    private beatStart: number = 0;
    private beatDuration: number = 0;
    private beatStartToUse: number = 0;

    // DOM / SVG caching
    private svgRendered = false;
    private lastSvgHeight = 0;
    private lastFinalX = -1;
    private lastFinalY = -1;
    private hasInitialPosition = false;

    // Diagnostics
    private lastLogBeat = -1;
    private lastDebugUpdate = 0;

    constructor(api: any, container: HTMLElement) {
        this.api = api;
        this.element = document.createElement('div');
        this.element.id = 'maestro-cursor-v4';
        this.element.className = 'maestro-cursor-icursor';
        Object.assign(this.element.style, {
            position: 'absolute', top: '0', left: '0',
            pointerEvents: 'none', zIndex: '99999',
            willChange: 'transform', width: `${this.cursorWidth}px`,
            overflow: 'visible', visibility: 'hidden', opacity: '0',
            transform: 'translate3d(-100vw, 0px, 0px)',
        });
        container.appendChild(this.element);
        console.log('✅ MaestroCursor v4.5: Ready');
    }

    // ─────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────

    /**
     * Called by page.tsx when beat changes.
     * Resolves beat.nextBeat as structural default and FREEZES nextBeatCenterX.
     * setTick() will only fill it in if still null (repeat-aware override).
     */
    setBeat(beat: Beat | null): void {
        if (!beat) { this.hide(); return; }

        this.currentBeat = beat;
        this.beatStart = beat.absolutePlaybackStart ?? beat.playbackStart ?? 0;
        this.beatDuration = beat.playbackDuration ?? beat.duration ?? 0;
        this.beatStartToUse = this.beatStart;

        const bb = this.api?.renderer?.boundsLookup?.findBeat(beat);
        if (!bb?.visualBounds) { this.hide(); return; }

        const vb = bb.visualBounds;
        this.currentNoteX = typeof bb.onNotesX === 'number'
            ? bb.onNotesX
            : vb.x + vb.w / 2;
        this.currentY = vb.y;
        this.currentHeight = vb.h;
        this.currentVbW = vb.w;

        // ── Resolve structural nextBeat and FREEZE ──
        // 🔒 nextBeatCenterX is locked here for the entire beat duration.
        // setTick() may only fill it if null; it never clears an established value.
        this.nextBeatCenterX = null;
        const structuralNext = beat.nextBeat;
        if (structuralNext) {
            const nb = this.api?.renderer?.boundsLookup?.findBeat(structuralNext);
            if (nb?.visualBounds) {
                const nx = typeof nb.onNotesX === 'number'
                    ? nb.onNotesX
                    : nb.visualBounds.x + nb.visualBounds.w / 2;
                const sameRow = Math.abs(nb.visualBounds.y - this.currentY) < 5;
                const curBarIdx = beat?.voice?.bar?.index ?? beat?.voice?.bar?.masterBar?.index;
                const nextBarIdx = structuralNext?.voice?.bar?.index ?? structuralNext?.voice?.bar?.masterBar?.index;
                if (sameRow && curBarIdx === nextBarIdx) {
                    this.nextBeatCenterX = nx;
                }
            }
        }

        // Snap to beat-start position immediately
        const finalX = this.currentNoteX - this.cursorWidth / 2;
        const totalH = vb.h + this.topOverhang + this.bottomOverhang + this.bottomPointBaseShift;
        const finalY = vb.y - this.topOverhang;
        this.applyTransform(finalX, finalY, totalH, !this.hasInitialPosition);
        this.hasInitialPosition = true;
        this.show();
    }

    // ─────────────────────────────────────────
    // Transport Snap (Loop + Jump Safety)
    // ─────────────────────────────────────────
    public requestSnap(): void {
        this.nextBeatCenterX = null;
        this.beatStartToUse = this.beatStart;
        this.lastFinalX = -1;
        this.lastFinalY = -1;
    }

    /**
     * Called by page.tsx on every playerPositionChanged (~10-30fps).
     * Renders directly — no RAF needed, events are frequent enough.
     *
     * 🔒 DO NOT re-add RAF — causes drift on pause (elapsed grows unbounded).
     * 🔒 nextBeatCenterX is READ-ONLY here once set. Only fills if currently null.
     *    NEVER sets it to null — that's what caused the v4.3.5 mid-beat mode switch.
     * 🔒 Two-mode walk is intentional — vbW is near-zero on whammy/sustained notes.
     */
    setTick(tick: number, nextBeat: Beat | null = null, overrideBeatStart: number | null = null): void {
        if (!this.currentBeat || this.beatDuration <= 0) return;

        // 🔒 Expanded beat start override (repeat-aware path from page.tsx)
        this.beatStartToUse = overrideBeatStart ?? this.beatStart;

        // 🔒 Only fill nextBeatCenterX if setBeat() didn't find one.
        // NEVER clear it — clearing mid-beat causes the v4.3.5 jerk.
        if (nextBeat && this.nextBeatCenterX === null) {
            const nb = this.api?.renderer?.boundsLookup?.findBeat(nextBeat);
            if (nb?.visualBounds) {
                const nx = typeof nb.onNotesX === 'number'
                    ? nb.onNotesX
                    : nb.visualBounds.x + nb.visualBounds.w / 2;
                const sameRow = Math.abs(nb.visualBounds.y - this.currentY) < 5;
                const curBarIdx = this.currentBeat?.voice?.bar?.index ?? this.currentBeat?.voice?.bar?.masterBar?.index;
                const nextBarIdx = nextBeat?.voice?.bar?.index ?? nextBeat?.voice?.bar?.masterBar?.index;
                if (sameRow && curBarIdx === nextBarIdx) {
                    this.nextBeatCenterX = nx;
                }
                // 🔒 No else-null here — if check fails, keep existing value (frozen).
            }
        }

        // ── Progress ──
        let progress = 0;
        if (this.beatDuration > 0) {
            progress = (tick - this.beatStartToUse) / this.beatDuration;
            progress = Math.max(0, Math.min(1, progress));
        }

        // ── Walk distance ──
        // 🔒 Two modes required — DO NOT collapse into ratio formula.
        // AlphaTab assigns near-zero vbW to whammy/sustained notes (see v4.3.7 failure).
        // MODE A: next beat exists in same bar/row → walk to its note head.
        // MODE B: last beat in bar / no next → walk to masterBar right edge.
        // Mode is FROZEN for the beat (nextBeatCenterX never cleared above).
        let walkDistance: number;

        if (this.nextBeatCenterX !== null && this.nextBeatCenterX > this.currentNoteX) {
            // MODE A
            walkDistance = this.nextBeatCenterX - this.currentNoteX;
        } else {
            // MODE B — walk to barline
            const masterBar = this.currentBeat?.voice?.bar?.masterBar;
            const mbBounds = this.api?.renderer?.boundsLookup?.findMasterBar?.(masterBar);
            if (mbBounds?.visualBounds) {
                const vb = mbBounds.visualBounds;
                walkDistance = (vb.x + vb.w) - this.currentNoteX;
            } else {
                walkDistance = this.currentVbW; // safety fallback
            }
        }

        let interpolatedX = this.currentNoteX + walkDistance * progress;

        // Overshoot guard (MODE A only)
        if (this.nextBeatCenterX !== null && this.nextBeatCenterX > this.currentNoteX) {
            interpolatedX = Math.min(interpolatedX, this.nextBeatCenterX);
        }

        // ✅ V4.5 — Pause clamp: prevent barline parking at loop end.
        //
        // When playback stops on the last beat of a loop, Mode B has walked the
        // cursor to progress = 1.000 (bar right edge). On pause the cursor should
        // anchor visually to the note head, not the barline.
        //
        // Condition: transport stopped AND beat fully elapsed.
        // Only intercepts Mode B at completion — Mode A is already clamped by the
        // overshoot guard above. Does not affect playback, repeat math, or seek.
        //
        // 🔒 DO NOT move above interpolatedX calculation.
        // 🔒 DO NOT modify walkDistance, nextBeatCenterX, or beatStartToUse here.
        const isPlaying = this.api?.player?.isPlaying ?? false;
        if (!isPlaying && progress >= 0.999) {
            interpolatedX = this.currentNoteX;
        }

        const finalX = interpolatedX - this.cursorWidth / 2;
        const totalH = this.currentHeight + this.topOverhang + this.bottomOverhang + this.bottomPointBaseShift;
        const finalY = this.currentY - this.topOverhang;

        this.applyTransform(finalX, finalY, totalH, false);

        // Throttled log — once per expanded beat pass (beatStartToUse, not beatStart)
        // 🔒 beatStart is structural — same value every repeat pass → logs only fire once.
        //    beatStartToUse is expanded — unique per pass → each pass logs independently.
        if (this.beatStartToUse !== this.lastLogBeat) {
            this.lastLogBeat = this.beatStartToUse;
            const mode = this.nextBeatCenterX !== null ? 'A→nextBeat' : 'B→barline';
            console.log(`[Maestro v4.5] Beat ${this.beatStartToUse} | ${mode} Walk ${walkDistance.toFixed(1)}px`, {
                tick, overrideBeatStart, progress: progress.toFixed(3),
                nextBeatCenterX: this.nextBeatCenterX?.toFixed(1) ?? null,
            });
        }

        // Throttled debug label (10fps)
        const now = performance.now();
        if (now - this.lastDebugUpdate > 100) {
            this.lastDebugUpdate = now;
            this.updateDebugLabel(finalX, progress);
        }
    }

    destroy(): void {
        if (this.element.parentElement) this.element.parentElement.removeChild(this.element);
        console.log('🧹 MaestroCursor v4.5: Destroyed');
    }

    // ─────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────

    private applyTransform(x: number, y: number, h: number, snap: boolean): void {
        if (Math.abs(x - this.lastFinalX) < 0.5 && Math.abs(y - this.lastFinalY) < 0.5) return;
        this.lastFinalX = x;
        this.lastFinalY = y;
        if (snap) this.element.style.transition = 'none';
        this.element.style.transform = `translate3d(${x}px, ${y}px, 0px)`;
        this.element.style.height = `${h}px`;
        if (!this.svgRendered || Math.abs(h - this.lastSvgHeight) > 5) {
            this.renderSVG(h, this.currentHeight);
            this.svgRendered = true;
            this.lastSvgHeight = h;
        }
    }

    private show(): void {
        this.element.style.visibility = 'visible';
        this.element.style.opacity = '1';
    }

    private hide(): void {
        this.element.style.visibility = 'hidden';
        this.element.style.opacity = '0';
    }

    private renderSVG(totalHeight: number, beatHeight: number): void {
        // 🔒 v3.3 SVG — DO NOT replace with dynamic variable geometry.
        // Hardcoded coordinates match cursorWidth=14 exactly.
        this.element.innerHTML = `
            <svg width="${this.cursorWidth}" height="${totalHeight}"
                 viewBox="0 0 ${this.cursorWidth} ${totalHeight}"
                 style="display:block;overflow:visible;filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.5));">
                <defs>
                    <filter id="maestroCursorShadow">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
                        <feOffset dx="0" dy="2"/>
                        <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
                        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                </defs>
                <!-- Purple cursor body -->
                <path d="M 0,7 Q 0,0 7,0 Q 14,0 14,7
                         V ${beatHeight + this.topOverhang}
                         L 7 ${totalHeight + 2}
                         L 0 ${beatHeight + this.topOverhang} Z"
                      fill="rgba(168, 85, 247, 0.45)"
                      filter="url(#maestroCursorShadow)"/>
                <!-- White dot -->
                <path d="M 3.5 6 C 3.5 4.3 5 3 7 3
                         C 9 3 10.5 4.3 10.5 6
                         C 10.5 8.5 8 12 7 12
                         C 6 12 3.5 8.5 3.5 6 Z"
                      fill="white"/>
            </svg>`;
    }

    private updateDebugLabel(x: number, progress: number): void {
        let label = this.element.querySelector('.debug-label') as HTMLElement;
        if (!label) {
            label = document.createElement('div');
            label.className = 'debug-label';
            // ✅ Red label
            label.style.cssText = `position:absolute;top:-40px;left:20px;
                background:rgba(255,0,0,0.9);color:white;padding:6px 10px;
                font-size:11px;border-radius:4px;white-space:nowrap;font-weight:bold;`;
            this.element.appendChild(label);
        }
        label.innerHTML = `🎯 v4.5<br/>X:${x.toFixed(1)} P:${(progress * 100).toFixed(1)}%`;
    }
}

export function attachMaestroCursor(api: any, container: HTMLElement): MaestroCursor {
    const cursor = new MaestroCursor(api, container);
    return cursor;
}
