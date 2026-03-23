'use client';

/**
 * AlphaTab Labs Page v5.30 — Stable Repeat + Loop Cursor Engine
 * Date: February 22nd, 2026
 *
 * 🔒 Engine Architecture Locked
 * - Expanded beat resolution via masterBars traversal (occurrence-aware)
 * - isSameBeat() O(1) gate — both scans run once per beat entry only
 * - Backward + forward scans frozen in stable refs for beat duration
 * - Loop safety margin prevents dead-zone exposure in audio worker
 * - Jump detection guards whammy re-sync / repeat / seek discontinuities
 *
 * See /docs/maestro-cursor-postmortem.md for full version history.
 *
 * v5.30.1 — Song selector added (Rise + SRV Pride and Joy).
 * No engine changes from v5.30.
 */

import React, { useEffect, useRef, useState } from 'react';
import { attachMaestroCursor, MaestroCursor } from '../components/MaestroCursor';
import BeatCustomLoopOverlay from '../components/BeatCustomLoopOverlay';

import './alphaTab.css';

const DEBUG = false;

// ─────────────────────────────────────────────────────────────────────────────
// Song config
// ─────────────────────────────────────────────────────────────────────────────

const LAB_SONGS = [
    { id: 'rise', label: 'Rise',               path: '/samples/extreme-rise/extreme-rise.gp5',           trackIndex: 0 },
    { id: 'srv',  label: 'SRV - Pride and Joy', path: '/samples/srv-pride-and-joy/srv-pride-and-joy.gp',  trackIndex: 1 },
] as const;

type SongId = typeof LAB_SONGS[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────

export default function AlphaTabLabsPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<HTMLElement | null>(null);
    const cursorRef = useRef<MaestroCursor | null>(null);
    const apiRef = useRef<any>(null);
    const loopEnabledRef = useRef(false);               // 🔒 ref — closure in playerPositionChanged

    // 🔒 Stable per-beat refs — all written once on beat entry, read every frame
    const lastTickRef = useRef<number | null>(null);           // transport jump detection
    const stableCurBeatRef = useRef<any>(null);                // beat identity — O(1) isSameBeat gate
    const stableExpandedBeatStartRef = useRef<number>(0);      // frozen beat start tick
    const stableNextBeatRef = useRef<any>(null);               // frozen next beat (null = Mode B)

    const [selectedSongId, setSelectedSongId] = useState<SongId>('rise');
    const [isRendered, setIsRendered] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [forceReady, setForceReady] = useState(false);
    const [boundsReady, setBoundsReady] = useState(false);
    const [surfaceReady, setSurfaceReady] = useState(false);
    const [soundfontStatus, setSoundfontStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [persistedLoop, setPersistedLoop] = useState<{ startTick: number; endTick: number } | null>(null);
    const [loopEnabled, setLoopEnabled] = useState(false);
    const [boundsEpoch, setBoundsEpoch] = useState(0);

    const manualLoopDisposerRef = useRef<any>(null);

    // ─────────────────────────────────────────
    // Cursor Helpers
    // ─────────────────────────────────────────

    // findBeat() is visual-first — returns pass-1 (structural) beat only.
    // Only used for immediate snap (initial render, manual seek).
    // Never used for walking resolution — playerPositionChanged owns that.
    function updateCursorForTick(api: any, tick: number) {
        if (!cursorRef.current || !api.renderer?.boundsLookup) return;
        const trackIndices = api.tracks
            ? new Set(api.tracks.map((t: any) => t.index))
            : new Set([0]);
        const tickCache = (api as any).tickCache;
        if (!tickCache) return;
        const beatResult = tickCache.findBeat(trackIndices, tick);
        if (beatResult?.beat) {
            cursorRef.current.setBeat(beatResult.beat);
            cursorRef.current.setTick(tick);
        }
    }

    // ─────────────────────────────────────────
    // Manual Loop Control
    // ─────────────────────────────────────────

    function enableManualLoop(api: any) {
        if (!api?.playbackRange) return;
        const start = api.playbackRange.startTick;
        const endExclusive = api.playbackRange.endTick;

        // 🔒 MANUAL LOOP — DETERMINISTIC LAST-BEAT WRAP
        //
        // Why manual over native (api.isLooping = true):
        //   Native loop causes an audio/cursor hiccup at M4–M5 boundary because
        //   AlphaTab's internal scheduler can stall or emit a tick >= endExclusive
        //   before wrapping, causing a 1-frame cursor poisoning and audible pause.
        //
        // lastValid is computed from the actual last resolvable beat inside the range —
        // deterministic, tempo-independent, always correct. Never use a magic offset.
        const trackIndices = api.tracks
            ? new Set(api.tracks.map((t: any) => t.index))
            : new Set([0]);

        let lastValid = start;
        for (let t = endExclusive - 1; t >= start; t--) {
            const r = api.tickCache?.findBeat(trackIndices, t);
            if (r?.beat) { lastValid = t; break; }
        }

        api.isLooping = false; // disable native — this handler is single source of truth

        manualLoopDisposerRef.current = api.playerPositionChanged.on((e: any) => {
            const tick = e.currentTick ?? e.tickPosition;
            if (tick == null) return;
            if (tick < start) { api.tickPosition = start; return; }
            if (tick >= lastValid) { api.tickPosition = start; }
        });

        console.log(`🎼 Manual Loop Enabled: ${start}–${endExclusive}, lastValid=${lastValid}`);
    }

    function disableManualLoop() {
        if (manualLoopDisposerRef.current) {
            manualLoopDisposerRef.current();
            manualLoopDisposerRef.current = null;
            console.log('🎼 Manual Loop Disabled');
        }
    }

    // ─────────────────────────────────────────
    // Tear down existing AlphaTab instance
    // ─────────────────────────────────────────

    function teardown() {
        disableManualLoop();
        if (cursorRef.current) { cursorRef.current.destroy(); cursorRef.current = null; }
        if (apiRef.current) { apiRef.current.destroy(); apiRef.current = null; }
        surfaceRef.current = null;
        lastTickRef.current = null;
        stableCurBeatRef.current = null;
        stableExpandedBeatStartRef.current = 0;
        stableNextBeatRef.current = null;
    }

    // ─────────────────────────────────────────
    // Initialize AlphaTab
    // ─────────────────────────────────────────

    useEffect(() => {
        if (!containerRef.current) return;

        // Tear down any previous instance before starting fresh
        teardown();

        // Reset UI state for the new load cycle
        setIsRendered(false);
        setIsPlaying(false);
        setForceReady(false);
        setBoundsReady(false);
        setSurfaceReady(false);
        setSoundfontStatus('loading');
        setLoopEnabled(false);
        setPersistedLoop(null);
        loopEnabledRef.current = false;

        let destroyed = false;

        const selectedSong = LAB_SONGS.find(s => s.id === selectedSongId)!;

        const init = async () => {
            const alphaTab = await import('@coderline/alphatab');
            if (destroyed || !containerRef.current) return;

            const settings = new alphaTab.Settings();
            settings.core.engine = 'svg';
            settings.core.logLevel = alphaTab.LogLevel.Debug;
            settings.core.fontDirectory =
                'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/font/';
            settings.core.includeNoteBounds = true;
            settings.core.enableLazyLoading = false;
            settings.core.useWorkers = true;
            settings.display.scale = 1.0;
            settings.display.layoutMode = alphaTab.LayoutMode.Page;
            settings.display.staveProfile = alphaTab.StaveProfile.Tab;
            settings.player.enablePlayer = true;
            settings.player.soundFont = '/soundfont/sonivox.sf2';
            settings.player.scrollMode = alphaTab.ScrollMode.Off;
            settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            settings.player.enableUserInteraction = false;
            settings.player.enableCursor = true;
            settings.player.enableAnimatedBeatCursor = true;

            if (DEBUG) console.log('🔧 AlphaTab Labs v5.30 initializing...');

            const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
            if (destroyed) { api.destroy(); return; }

            apiRef.current = api;
            (window as any).__at = api;

            const response = await fetch(selectedSong.path);
            const arrayBuffer = await response.arrayBuffer();
            api.load(new Uint8Array(arrayBuffer));

            // Render the correct track for this song
            api.scoreLoaded.on(() => {
                if (DEBUG) console.log('✅ Score loaded');
                const score = api.score;
                const tracks = score?.tracks;
                if (tracks && tracks.length > selectedSong.trackIndex) {
                    api.renderTracks([tracks[selectedSong.trackIndex]]);
                }
            });

            setTimeout(() => {
                if (!containerRef.current) return;
                const surface = containerRef.current.querySelector('.at-surface') as HTMLElement;
                if (surface) {
                    surfaceRef.current = surface;
                    setSurfaceReady(true);
                    if (DEBUG) console.log('✅ Surface reference captured for overlay');
                }
            }, 200);

            api.renderStarted.on(() => { setBoundsReady(false); });

            api.renderFinished.on(() => {
                setIsRendered(true);
                setTimeout(() => {
                    if (!api.renderer?.boundsLookup?.staffSystems) {
                        console.warn('⚠️ Bounds not ready after delay');
                        return;
                    }
                    setBoundsReady(true);
                    setBoundsEpoch(e => e + 1);

                    if (containerRef.current && !cursorRef.current) {
                        cursorRef.current = attachMaestroCursor(api, containerRef.current);
                        if (DEBUG) console.log('✅ MaestroCursor attached');
                        setTimeout(() => updateCursorForTick(api, 0), 300);
                    } else if (cursorRef.current) {
                        const currentTick = api.tickPosition ?? 0;
                        setTimeout(() => updateCursorForTick(api, currentTick), 100);
                        if (DEBUG) console.log('🔄 Cursor position refreshed after bounds update');
                    }

                    if (DEBUG) {
                        const systems = api.renderer.boundsLookup.staffSystems || [];
                        console.log(`📊 Bounds ready: ${systems.length} staff systems`);
                    }
                }, 200);
            });

            api.soundFontLoad?.on(() => setSoundfontStatus('loading'));
            api.soundFontLoaded?.on(() => {
                if (DEBUG) console.log('✅ Soundfont loaded');
                setSoundfontStatus('loaded');
            });

            let stateChangeTimeout: NodeJS.Timeout;
            let lastManualToggle = 0;

            api.playerStateChanged.on((e: any) => {
                clearTimeout(stateChangeTimeout);
                stateChangeTimeout = setTimeout(() => {
                    if (Date.now() - lastManualToggle < 100) {
                        if (DEBUG) console.log('🎵 playerStateChanged: ignored (too close to manual toggle)');
                        const snapTick = api.tickPosition ?? lastTickRef.current;
                        if (snapTick != null) {
                            requestAnimationFrame(() => updateCursorForTick(api, snapTick));
                        }
                        return;
                    }
                    const newState = !e.stopped;
                    console.log(`🎵 playerStateChanged: stopped=${e.stopped}, newState=${newState}`);
                    setIsPlaying(newState);
                }, 50);
            });

            (api as any)._lastManualToggle = () => { lastManualToggle = Date.now(); };

            /**
             * 🔒🔒🔒 CURSOR ENGINE LOCK — DO NOT MODIFY THIS BLOCK 🔒🔒🔒
             *
             * Proven stable as of v5.30. Drives Maestro v4.3.8 smooth walking cursor.
             *
             * Contract:
             *   - masterBars occurrence traversal → correct expanded beat (not structural pass-1)
             *   - isSameBeat() O(1) gate → both scans fire ONCE per beat entry
             *   - Backward scan → expandedBeatStart (frozen in stableExpandedBeatStartRef)
             *   - Forward scan → nextBeat (frozen in stableNextBeatRef)
             *   - 3-arg cursor contract: setBeat() + setTick(tick, nextBeat, expandedBeatStart)
             *
             * DO NOT:
             *   - Move either scan outside the isSameBeat gate (reintroduces 720k calls/beat)
             *   - Use beat.nextBeat or beat.absolutePlaybackStart as authoritative values
             *   - Simplify to cursor.setTick(tick) one-arg — drops repeat-aware walk
             *   - Pass expandedBeatStart as FIRST arg to setTick() — zeros progress every frame
             *   - Add interpolation math here — MaestroCursor owns all walking state
             *   - Remove the isSameBeat() structural check — post-repeat instances differ
             *   - Remove loopEnabledRef clamp — state is stale inside this closure
             */
            api.playerPositionChanged.on((e: any) => {
                if (!cursorRef.current) return;

                const tickRaw = e.currentTick ?? e.tickPosition;
                if (tickRaw == null) return;

                // 🔒 LOOP BOUNDARY ENFORCER — DO NOT REMOVE
                // Intercepts ticks before endTick to prevent audio worker dead-zone exposure.
                // SAFETY_MARGIN = 120 ticks (~1/16 note at 480 PPQ).
                // This is NOT a cosmetic clamp — it prevents transport dead-zone stall.
                const range = api.playbackRange;
                if (loopEnabledRef.current && range) {
                    const { startTick, endTick } = range;
                    const SAFETY_MARGIN = 120;
                    if (tickRaw >= endTick - SAFETY_MARGIN) {
                        cursorRef.current?.requestSnap();
                        api.tickPosition = startTick;
                        return;
                    }
                }

                const tick = tickRaw;

                // 🔒 JUMP DETECTION — guards whammy re-sync, repeat wrap, seek discontinuities.
                // Threshold: 2000 ticks (~2 beats at 480 PPQ).
                const lastTick = lastTickRef.current;
                const jumped = lastTick != null && Math.abs(tick - lastTick) > 2000;
                lastTickRef.current = tick;
                if (jumped) {
                    cursorRef.current?.requestSnap();
                    stableCurBeatRef.current = null;
                    stableExpandedBeatStartRef.current = 0;
                }

                const trackIndices = api.tracks
                    ? new Set(api.tracks.map((t: any) => t.index))
                    : new Set([0]);

                const tickCache = (api as any).tickCache;
                if (!tickCache) return;

                // ── Expanded Beat Resolution ─────────────────────────────────────────
                // findBeat() is structurally biased — always returns pass-1 beat instance.
                // masterBars traversal gives the correct occurrence for the current pass.
                //
                // Algorithm:
                //   1. Walk masterBars → find entry [start, start+dur) owning tick
                //      → gives ownerOccurrence + ownerExpandedStart
                //   2. Walk boundsLookup.staffSystems → find Nth visual instance of masterBar
                //   3. Walk BarBounds → VoiceBounds → BeatBounds → match by expanded offset
                //   4. Fallback: findBeat() if masterBars unavailable or traversal fails
                let curBeat: any = null;

                const masterBarsArr = (tickCache as any).masterBars as any[];
                if (masterBarsArr?.length) {
                    const occurrenceMap = new Map<number, number>();
                    let ownerMbIdx: number | null = null;
                    let ownerOccurrence = 0;
                    let ownerExpandedStart = 0;

                    for (const mb of masterBarsArr) {
                        const mbIdx = mb?.masterBar?.index;
                        if (mbIdx == null) continue;
                        const occ = occurrenceMap.get(mbIdx) ?? 0;
                        occurrenceMap.set(mbIdx, occ + 1);
                        const dur = mb.masterBar?.calculateDuration?.() ?? 0;
                        if (tick >= mb.start && tick < mb.start + dur) {
                            ownerMbIdx = mbIdx;
                            ownerOccurrence = occ;
                            ownerExpandedStart = mb.start;
                        }
                    }

                    if (ownerMbIdx != null) {
                        const systems = api.renderer?.boundsLookup?.staffSystems ?? [];
                        const visualOccMap = new Map<number, number>();
                        let targetMbb: any = null;

                        outer2: for (const sys of systems) {
                            for (const mbb of ((sys as any)?.bars ?? [])) {
                                const vbIdx = (mbb as any)?.masterBar?.index ?? (mbb as any)?.index;
                                if (vbIdx == null) continue;
                                const vOcc = visualOccMap.get(vbIdx) ?? 0;
                                visualOccMap.set(vbIdx, vOcc + 1);
                                if (vbIdx === ownerMbIdx && vOcc === ownerOccurrence) {
                                    targetMbb = mbb;
                                    break outer2;
                                }
                            }
                        }

                        // 🔒 NO track filter here — matched correct masterBar occurrence in Step 2.
                        // Track filtering at MasterBar level is sufficient; adding it here causes
                        // silent fallthrough in solo/whammy bars where staff path differs.
                        if (targetMbb) {
                            outer3: for (const barBounds of ((targetMbb as any)?.bars ?? [])) {
                                for (const voiceBounds of ((barBounds as any)?.voices ?? [])) {
                                    for (const beatBounds of ((voiceBounds as any)?.beats ?? [])) {
                                        const beat = (beatBounds as any)?.beat;
                                        if (!beat) continue;
                                        const bOffset = beat.playbackStart ?? 0;
                                        const bDur = beat.playbackDuration ?? beat.duration ?? 0;
                                        const beatExpandedStart = ownerExpandedStart + bOffset;
                                        if (beatExpandedStart <= tick && tick < beatExpandedStart + bDur) {
                                            curBeat = beat;
                                            break outer3;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Fallback: findBeat() — structurally biased, but better than null
                if (!curBeat) {
                    const beatResult = tickCache.findBeat(trackIndices, tick);
                    if (!beatResult?.beat) return;
                    curBeat = beatResult.beat;
                }

                // Structural equality — post-repeat, tickCache returns different Beat instances
                // for the same structural beat. Reference equality is insufficient.
                const isSameBeat = (a: any, b: any) => {
                    if (!a || !b) return false;
                    return (
                        a.absolutePlaybackStart === b.absolutePlaybackStart &&
                        a.voice?.bar?.masterBar?.index === b.voice?.bar?.masterBar?.index
                    );
                };

                // 🔒 BEAT ENTRY GUARD — isSameBeat() is O(1), gates both expensive scans.
                // Both scans run exactly once on beat entry; per-frame cost is O(1).
                //
                // Root cause of v5.27 solo freeze: both scans ran every frame.
                // Beat 380160 (3840 ticks, ~4s): 120 frames × 6000 findBeat = 720,000 calls
                // → main thread stall → audio catches up → cursor teleport.
                if (!isSameBeat(curBeat, stableCurBeatRef.current) || jumped) {
                    stableCurBeatRef.current = curBeat;

                    // Backward scan: find expandedBeatStart.
                    // 🔒 ONCE per beat — O(2000) on entry only, fatal if run per-frame.
                    let expandedBeatStart = tick;
                    for (let t = tick - 1; t >= tick - 2000; t--) {
                        const r = tickCache.findBeat(trackIndices, t);
                        if (!r?.beat || !isSameBeat(r.beat, curBeat)) {
                            expandedBeatStart = t + 1;
                            break;
                        }
                    }
                    stableExpandedBeatStartRef.current = expandedBeatStart;

                    // Forward scan: find nextBeat.
                    // 🔒 ONCE per beat — same reasoning.
                    // null result = Mode B (barline walk). Beat object = Mode A (nextBeat walk).
                    let scannedNextBeat: any = null;
                    for (let t = expandedBeatStart + 1; t <= expandedBeatStart + 4000; t++) {
                        const r = tickCache.findBeat(trackIndices, t);
                        if (r?.beat && !isSameBeat(r.beat, curBeat)) {
                            scannedNextBeat = r.beat;
                            break;
                        }
                    }
                    stableNextBeatRef.current = scannedNextBeat;
                    cursorRef.current.setBeat(curBeat);
                }

                // Per-frame: O(1) — frozen cached values only.
                // 🔒 tick is ALWAYS first arg (real engine position).
                //    expandedBeatStart is ALWAYS third arg (beat-start reference only).
                //    Swapping them zeros progress every frame → stepping.
                cursorRef.current.setTick(tick, stableNextBeatRef.current, stableExpandedBeatStartRef.current);
            });
            // 🔒🔒🔒 END CURSOR ENGINE LOCK 🔒🔒🔒

            const checkReady = () => {
                if (api.isReadyForPlayback) {
                    if (DEBUG) console.log('✅ Player ready');
                    setIsPlaying(api.playerState !== 0);
                    return true;
                }
                return false;
            };

            api.playerReady?.on(() => setTimeout(checkReady, 100));

            let polls = 0;
            const pollId = setInterval(() => {
                polls++;
                if (checkReady() || polls >= 15) {
                    clearInterval(pollId);
                    if (polls >= 15 && !api.isReadyForPlayback) {
                        console.error('❌ Soundfont load timeout');
                        setSoundfontStatus('error');
                        setForceReady(true);
                    }
                }
            }, 1000);
        };

        init().catch(console.error);

        return () => {
            destroyed = true;
            teardown();
        };
    }, [selectedSongId]);

    useEffect(() => {
        fetch('/soundfont/sonivox.sf2', { method: 'HEAD' })
            .then(r => r.ok
                ? (DEBUG && console.log('✅ Soundfont accessible'))
                : console.error(`❌ Soundfont ${r.status}`))
            .catch(err => console.error('❌ Soundfont fetch failed:', err));
    }, []);

    // Click-to-seek (native interaction disabled)
    useEffect(() => {
        const api = apiRef.current;
        const surface = surfaceRef.current;
        if (!api || !surface || !boundsReady) return;

        const handleClick = (e: MouseEvent) => {
            if (loopEnabled) return;
            const rect = surface.getBoundingClientRect();
            const scrollElement = api.renderer?.framer?.scrollElement as HTMLElement | undefined;
            const scrollX = scrollElement?.scrollLeft ?? surface.scrollLeft ?? 0;
            const scrollY = scrollElement?.scrollTop ?? surface.scrollTop ?? 0;
            const x = (e.clientX - rect.left) + scrollX;
            const y = (e.clientY - rect.top) + scrollY;
            const beat = api.renderer?.boundsLookup?.getBeatAtPos?.(x, y);
            const tickCache = (api as any).tickCache;
            if (!beat || !tickCache?.masterBars) return;

            const visualBarIndex = beat.voice?.bar?.masterBar?.index;
            if (visualBarIndex == null) return;
            const offsetInBar = beat.playbackStart ?? 0;
            const currentTick = api.tickPosition ?? 0;

            const instances = tickCache.masterBars.filter(
                (mb: any) => mb.masterBar?.index === visualBarIndex
            );
            if (instances.length === 0) return;

            const candidates = instances.map((mb: any) => mb.start + offsetInBar);
            const trueTargetTick = candidates.reduce((prev: number, curr: number) =>
                Math.abs(curr - currentTick) < Math.abs(prev - currentTick) ? curr : prev
            );

            console.log(`🎯 Repeat-Aware Seek: Visual M${visualBarIndex} → Expanded ${trueTargetTick}`);
            const wasPlaying = api.playerState !== 0;
            if (wasPlaying) api.pause();
            api.tickPosition = trueTargetTick;
            // Do NOT call updateCursorForTick here — findBeat() returns pass-1 beat.
            // Let playerPositionChanged drive cursor after seek.
            if (wasPlaying) requestAnimationFrame(() => api.play());
        };

        surface.addEventListener('click', handleClick);
        return () => surface.removeEventListener('click', handleClick);
    }, [boundsReady, loopEnabled]);

    // ─────────────────────────────────────────
    // Controls
    // ─────────────────────────────────────────

    const handleSeek = () => {
        const api = apiRef.current;
        if (!api || !boundsReady) return;
        const tick = 10000;
        const wasPlaying = api.playerState !== 0;
        if (wasPlaying) api.pause();
        api.tickPosition = tick;
        updateCursorForTick(api, tick);
        if (wasPlaying) requestAnimationFrame(() => api.play());
    };

    const handleTogglePlay = () => {
        const api = apiRef.current;
        if (!api) return;
        if (!api.isReadyForPlayback && !forceReady) return;
        if ((api as any)._lastManualToggle) (api as any)._lastManualToggle();
        const newState = !isPlaying;
        console.log(`🎵 Toggle play: ${isPlaying} → ${newState}`);
        if (newState) { api.play(); } else { api.pause(); }
        setIsPlaying(newState);
    };

    const playerReady = apiRef.current?.isReadyForPlayback || forceReady;
    const selectedSong = LAB_SONGS.find(s => s.id === selectedSongId)!;

    // ─────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────

    return (
        <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            <div style={{
                position: 'fixed', top: 20, right: 20,
                background: '#fff', border: '2px solid #000',
                padding: '15px', zIndex: 10000, borderRadius: '8px', maxWidth: '300px',
            }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
                    🧪 v5.30 — {selectedSong.label}
                </h3>

                {/* ── Song selector ─────────────────────────────────────────────── */}
                <div style={{ marginBottom: '10px' }}>
                    {LAB_SONGS.map(song => (
                        <button
                            key={song.id}
                            onClick={() => { setSurfaceReady(false); setSelectedSongId(song.id); }}
                            style={{
                                padding: '6px 10px', fontSize: '11px', border: 'none',
                                borderRadius: '4px', cursor: 'pointer', marginRight: '6px',
                                marginBottom: '4px', fontFamily: 'monospace',
                                background: song.id === selectedSongId ? '#6a1b9a' : '#888',
                                color: '#fff',
                            }}
                        >
                            {song.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button onClick={handleSeek} disabled={!boundsReady} style={{
                        padding: '8px', fontSize: '12px',
                        cursor: boundsReady ? 'pointer' : 'not-allowed',
                        background: boundsReady ? '#4caf50' : '#ccc',
                        color: 'white', border: 'none', borderRadius: '4px',
                    }}>🎯 Seek (tick 10000)</button>
                    <button onClick={handleTogglePlay} disabled={!playerReady} style={{
                        padding: '8px', fontSize: '12px',
                        cursor: playerReady ? 'pointer' : 'not-allowed',
                        background: playerReady ? '#2196f3' : '#ccc',
                        color: 'white', border: 'none', borderRadius: '4px',
                    }}>{isPlaying ? '⏸️ Pause' : '▶️ Play'}</button>
                    <div style={{
                        fontSize: '11px', marginTop: '10px', padding: '8px',
                        background: '#f5f5f5', borderRadius: '4px',
                    }}>
                        <div>Rendered: {isRendered ? '✅' : '❌'}</div>
                        <div>Bounds: {boundsReady ? '✅' : '❌'}</div>
                        <div>Player: {apiRef.current?.isReadyForPlayback ? '✅' : forceReady ? '⚠️' : '⏳'}</div>
                        <div>Soundfont: {soundfontStatus === 'loaded' ? '✅' : soundfontStatus === 'error' ? '❌' : '⏳'}</div>
                    </div>
                </div>
            </div>

            <div style={{
                background: '#e8f5e9', border: '2px solid #4caf50',
                padding: '15px', marginBottom: '20px', borderRadius: '8px',
            }}>
                <h2 style={{ margin: '0 0 10px 0' }}>🎸 v5.30 — Stable Repeat + Loop Cursor Engine</h2>
                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    ✅ <strong>Smooth walk</strong> — no stepping, no drift<br />
                    ✅ <strong>Repeat-aware</strong> — masterBars occurrence traversal<br />
                    ✅ <strong>O(1) per frame</strong> — both scans gated by isSameBeat()<br />
                    ✅ <strong>Zero-hiccup</strong> loop wrapping at boundaries
                </div>
            </div>

            {/* key={selectedSongId} forces React to fully unmount this subtree before
                the new song boots — prevents removeChild conflict between AlphaTab's
                api.destroy() and React trying to remove the overlay from the same div. */}
            <div key={selectedSongId} style={{ position: 'relative' }}>
                <div ref={containerRef} style={{
                    position: 'relative', width: '100%',
                    minHeight: '600px', background: '#fff', overflow: 'visible',
                }} />
                {apiRef.current && surfaceReady && (
                    <BeatCustomLoopOverlay
                        api={apiRef.current}
                        container={containerRef.current}
                        loopEnabled={loopEnabled}
                        onLoopToggle={(enabled) => {
                            setLoopEnabled(enabled);
                            loopEnabledRef.current = enabled;
                            const api = apiRef.current;
                            if (!api) return;
                            if (enabled) {
                                api.isLooping = true;
                            } else {
                                disableManualLoop();
                                api.isLooping = false;
                                api.playbackRange = null;
                            }
                        }}
                        onLoopChange={(startTick, endTick) => {
                            setPersistedLoop({ startTick, endTick });
                        }}
                        onLoopClear={() => {
                            setPersistedLoop(null);
                        }}
                    />
                )}
            </div>
        </div>
    );
}