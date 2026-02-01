'use client';

/**
 * MaestroCursor.tsx v2.11 FINAL - Complete Working Version
 * Date: January 29th, 2026
 * 
 * 🎉 FULLY FUNCTIONAL:
 * ✅ NESTED structure (visualBounds.x) - correct accessor pattern
 * ✅ Beat Y positioning (310) - cursor at staff level
 * ✅ Position listener - moves on seeks
 * ✅ Top overhang (20px) - white dot above staff
 * ✅ Bottom overhang (12px) - extends below staff (Songsterr style)
 */

import React, { useEffect, useState } from 'react';

interface MaestroCursorProps {
    api: any;
    isRendered: boolean;
    isPlaying: boolean;
    renderCycle?: number;
}

interface CursorPosition {
    x: number;
    y: number;
    height: number;
    visible: boolean;
}

export const MaestroCursor: React.FC<MaestroCursorProps> = ({
    api,
    isRendered,
    isPlaying,
    renderCycle = 0,
}) => {
    const [cursorPos, setCursorPos] = useState<CursorPosition>({
        x: 0,
        y: 0,
        height: 99,
        visible: false,
    });

    useEffect(() => {
        if (!api || !isRendered) {
            console.log('⏳ MaestroCursor v2.11: Waiting...');
            return;
        }

        if (!api.renderer?.boundsLookup?.staffSystems) {
            console.log('⏳ MaestroCursor v2.11: BoundsLookup not ready');
            return;
        }

        console.log('🎸 MaestroCursor v2.11: Position listener enabled');

        let animationFrameId: number | null = null;
        let currentX = 0;
        let currentY = 0;
        let targetX = 0;
        let targetY = 0;
        let currentHeight = 99;
        let currentBeat: any = null;
        let lastTickPosition = api.tickPosition || 0;

        /**
         * 🎯 Extract coordinates - USE BEAT Y NOT SYSTEM Y!
         * AlphaTab 1.9.0-alpha uses NESTED objects: visualBounds.x (not visualBounds_x)
         */
        const extractCoordinates = (beat: any) => {
            if (!beat || !api?.renderer?.boundsLookup) {
                console.warn('⚠️ v2.11: No beat or boundsLookup');
                return null;
            }

            try {
                const beatBounds = api.renderer.boundsLookup.findBeat(beat);
                if (!beatBounds) {
                    console.warn('⚠️ v2.11: findBeat returned null');
                    return null;
                }

                // 🎯 NESTED ACCESSOR (AlphaTab 1.9.0-alpha structure)
                const x = beatBounds.visualBounds?.x
                    ?? beatBounds.realBounds?.x
                    ?? beatBounds.x
                    ?? 0;

                // 🔥 CRITICAL: Use BEAT Y (310) not system Y (262)!
                const y = beatBounds.visualBounds?.y
                    ?? beatBounds.realBounds?.y
                    ?? beatBounds.y
                    ?? 0;

                const h = beatBounds.visualBounds?.h
                    ?? beatBounds.realBounds?.h
                    ?? beatBounds.h
                    ?? 99;

                console.log(`✅ v2.11: Extracted X=${x.toFixed(1)}, Y=${y.toFixed(1)}, H=${h}`);

                return { x, y, height: h };

            } catch (err) {
                console.error('❌ v2.11: Extract error:', err);
                return null;
            }
        };

        /**
         * Update cursor position
         */
        const updateFromBeat = (beat: any, instant: boolean = false) => {
            if (!beat) return;

            const coords = extractCoordinates(beat);
            if (!coords) {
                console.warn('⚠️ v2.11: No coordinates extracted');
                return;
            }

            console.log(`🎯 v2.11: Setting cursor to X=${coords.x.toFixed(1)}, Y=${coords.y.toFixed(1)}, H=${coords.height}`);

            if (instant) {
                currentX = coords.x;
                currentY = coords.y;
                targetX = coords.x;
                targetY = coords.y;
                currentHeight = coords.height;

                setCursorPos({
                    x: coords.x,
                    y: coords.y,
                    height: coords.height,
                    visible: true,
                });

                console.log(`⚡ v2.11: Snapped to X=${coords.x.toFixed(1)}`);
            } else {
                targetX = coords.x;
                targetY = coords.y;
                currentHeight = coords.height;
            }
        };

        /**
         * Animation loop (60fps smooth interpolation)
         */
        const smoothUpdate = () => {
            const lerp = 0.3;

            currentX += (targetX - currentX) * lerp;
            currentY += (targetY - currentY) * lerp;

            setCursorPos({
                x: currentX,
                y: currentY,
                height: currentHeight,
                visible: true,
            });

            animationFrameId = requestAnimationFrame(smoothUpdate);
        };

        /**
         * 🎵 Beat changed (during playback)
         */
        const handleBeatChanged = (beat: any) => {
            if (!beat) return;
            console.log('🎵 v2.11: Beat changed');
            currentBeat = beat;
            updateFromBeat(beat, false);
        };

        /**
         * 🎯 Position changed (manual seeks)
         */
        const handlePositionChanged = (e: any) => {
            const currentTick = e?.currentTick ?? api.tickPosition;
            console.log(`🎯 v2.11: Position changed to tick ${currentTick}`);

            if (api.score) {
                const trackIndices = api.tracks
                    ? new Set(api.tracks.map((t: any) => t.index))
                    : new Set([0]);

                const tickCache = (api as any).tickCache;

                if (tickCache) {
                    const beatResult = tickCache.findBeat(trackIndices, currentTick);

                    if (beatResult?.beat) {
                        console.log('✅ v2.11: Found beat at new position');
                        currentBeat = beatResult.beat;
                        updateFromBeat(beatResult.beat, true);
                    } else {
                        console.warn('⚠️ v2.11: No beat at tick', currentTick);
                    }
                }
            }
        };

        /**
         * 🔄 Render started
         */
        const handleRenderStarted = () => {
            console.log('🔄 v2.11: Render started');
        };

        /**
         * 🎯 Seek detection (polling for manual seeks)
         * This catches seeks that don't trigger positionChanged
         */
        const checkForSeeks = () => {
            const currentTick = api.tickPosition;
            const tickDelta = Math.abs(currentTick - lastTickPosition);

            // Detect significant jumps (>500 ticks = likely a seek)
            if (tickDelta > 500) {
                console.log(`🎯 v2.11: Seek detected! Δ=${tickDelta}`);
                handlePositionChanged({ currentTick });
            }

            lastTickPosition = currentTick;
        };

        // Start animation
        animationFrameId = requestAnimationFrame(smoothUpdate);

        // Attach listeners
        if (api.playedBeatChanged) {
            api.playedBeatChanged.on(handleBeatChanged);
            console.log('✅ v2.11: playedBeatChanged listener attached');
        }

        if (api.playerPositionChanged) {
            api.playerPositionChanged.on(handlePositionChanged);
            console.log('✅ v2.11: playerPositionChanged listener attached');
        }

        if (api.renderStarted) {
            api.renderStarted.on(handleRenderStarted);
        }

        // Start seek polling (100ms interval)
        const seekPollInterval = setInterval(checkForSeeks, 100);
        console.log('✅ v2.11: Seek polling started');

        // 🎯 INITIALIZATION - 300ms delay
        const initTimer = setTimeout(() => {
            console.log('🎯 v2.11: Initializing cursor (300ms delay)...');

            if (api.score) {
                const trackIndices = api.tracks
                    ? new Set(api.tracks.map((t: any) => t.index))
                    : new Set([0]);

                const tickCache = (api as any).tickCache;

                if (tickCache) {
                    const beatResult = tickCache.findBeat(trackIndices, 0);

                    if (beatResult?.beat) {
                        console.log('✅ v2.11: Found beat at tick 0');
                        currentBeat = beatResult.beat;
                        updateFromBeat(beatResult.beat, true);
                    } else {
                        console.warn('⚠️ v2.11: No beat at tick 0');
                    }
                }
            }
        }, 300);

        // Cleanup
        return () => {
            console.log('🧹 v2.11: Cleanup');

            clearTimeout(initTimer);
            clearInterval(seekPollInterval);

            if (api.playedBeatChanged) {
                api.playedBeatChanged.off(handleBeatChanged);
            }

            if (api.playerPositionChanged) {
                api.playerPositionChanged.off(handlePositionChanged);
            }

            if (api.renderStarted) {
                api.renderStarted.off(handleRenderStarted);
            }

            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [api, isRendered]);

    // 🎨 SONGSTERR-STYLE RENDERING
    // Top overhang: White dot extends 20px above staff
    // Bottom overhang: Cursor extends 12px below staff (like Songsterr!)
    const TOP_OVERHANG = 20;
    const BOTTOM_OVERHANG = 12;
    const totalHeight = cursorPos.height + TOP_OVERHANG + BOTTOM_OVERHANG;

    return (
        <div
            className="maestro-cursor-v211"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 99999,
                // Apply top offset so cursor extends above staff
                transform: `translate3d(${cursorPos.x}px, ${cursorPos.y - TOP_OVERHANG}px, 0)`,
                width: '14px',
                height: `${totalHeight}px`,
                overflow: 'visible',
                willChange: 'transform',

                // 🚨 DEBUG STYLES - Remove these in production
                border: '2px solid red',
                backgroundColor: 'rgba(255, 0, 0, 0.2)',
            }}
        >
            <svg
                width="14"
                height={totalHeight}
                viewBox={`0 0 14 ${totalHeight}`}
                preserveAspectRatio="none"
                style={{
                    display: 'block',
                    overflow: 'visible',
                    filter: 'drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.5))',
                }}
            >
                <defs>
                    <filter id="maestroCursorShadow">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
                        <feOffset dx="0" dy="2" />
                        <feComponentTransfer>
                            <feFuncA type="linear" slope="0.5" />
                        </feComponentTransfer>
                        <feMerge>
                            <feMergeNode />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Purple cursor body - extends ABOVE and BELOW staff */}
                <path
                    d={`M 0,7 Q 0,0 7,0 Q 14,0 14,7 
              V ${cursorPos.height + TOP_OVERHANG} 
              L 7 ${totalHeight} 
              L 0 ${cursorPos.height + TOP_OVERHANG} Z`}
                    fill="rgba(168, 85, 247, 0.45)"
                    filter="url(#maestroCursorShadow)"
                />

                {/* White dot indicator at top */}
                <path
                    d="M 3.5 3 C 3.5 1.3 5 0 7 0 
             C 9 0 10.5 1.3 10.5 3 
             C 10.5 5.5 8 9 7 9 
             C 6 9 3.5 5.5 3.5 3 Z"
                    fill="white"
                />
            </svg>

            {/* Debug label - shows live coordinates */}
            <div
                style={{
                    position: 'absolute',
                    top: -40,
                    left: 20,
                    background: 'rgba(255, 0, 0, 0.9)',
                    color: 'white',
                    padding: '6px 10px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    fontWeight: 'bold',
                }}
            >
                🚨 V2.11 FINAL<br />
                X: {cursorPos.x.toFixed(1)} | Y: {cursorPos.y.toFixed(1)} | H: {cursorPos.height}
            </div>
        </div>
    );
};

export default MaestroCursor;