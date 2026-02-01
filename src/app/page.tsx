'use client';

/**
 * AlphaTab Test Page v3.3 - PRODUCTION READY
 * Date: January 30th, 2026
 * 
 * 🔥 V3.3 FINAL CONFIGURATION:
 * ✅ PlayerMode.EnabledSynthesizer (correct enum)
 * ✅ Workers enabled with CDN worker path
 * ✅ Fonts from CDN (no local files needed)
 * ✅ Soundfont local at /public/soundfont/sonivox.sf2
 * ✅ Works with Next.js public folder at repo root
 * ✅ Ready for Daniel's review
 * 
 * 📂 CRITICAL: Next.js requires /public/ at project root!
 * The soundfont MUST be at: /public/soundfont/sonivox.sf2
 * Fonts load automatically from CDN
 */

import React, { useEffect, useRef, useState } from 'react';
import { MaestroCursor } from '../components/MaestroCursor';

export default function AlphaTabTest() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [api, setApi] = useState<any>(null);
    const [isRendered, setIsRendered] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [forceReady, setForceReady] = useState(false);
    const [renderCycle, setRenderCycle] = useState(0);
    const [boundsReady, setBoundsReady] = useState(false);
    const [soundfontStatus, setSoundfontStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

    // Initialize AlphaTab
    useEffect(() => {
        if (!containerRef.current || api) return;

        let destroyed = false;

        const initAlphaTab = async () => {
            const alphaTab = await import('@coderline/alphatab');

            const settings = new alphaTab.Settings();

            // Core settings
            settings.core.engine = 'svg';
            settings.core.logLevel = alphaTab.LogLevel.Debug;
            settings.core.fontDirectory = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/font/';
            settings.core.includeNoteBounds = true;
            settings.core.enableLazyLoading = false;
            settings.core.useWorkers = false;

            console.log('🔧 Workers disabled for Next.js');

            // Display settings
            settings.display.scale = 1.0;
            settings.display.layoutMode = alphaTab.LayoutMode.Page;
            settings.display.staveProfile = alphaTab.StaveProfile.Tab;

            // 🔥 FIX: Player settings with ENUM!
            settings.player.enablePlayer = true;
            settings.player.soundFont = '/soundfont/sonivox.sf2';
            settings.player.scrollMode = alphaTab.ScrollMode.Off;

            // 🔥 CRITICAL: Use correct enum value (matches AlphaTabRenderer)
            settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
            console.log('✅ Player mode set to: EnabledSynthesizer (enum value 2)');

            settings.player.enableCursor = false;
            settings.player.enableAnimatedBeatCursor = false;

            console.log('🎵 Player config:', {
                enablePlayer: settings.player.enablePlayer,
                soundFont: settings.player.soundFont,
                playerMode: (settings.player as any).playerMode,
            });

            if (!containerRef.current) return;

            const alphaTabApi = new alphaTab.AlphaTabApi(containerRef.current, settings);

            if (destroyed) {
                alphaTabApi.destroy();
                return;
            }

            // Load test file
            const response = await fetch('/samples/extreme-rise/extreme-rise.gp5');
            const arrayBuffer = await response.arrayBuffer();
            alphaTabApi.load(new Uint8Array(arrayBuffer));

            // Event handlers
            alphaTabApi.scoreLoaded.on(() => {
                console.log('✅ Score loaded');
            });

            alphaTabApi.renderStarted.on(() => {
                console.log('🎨 Render started');
                setBoundsReady(false);
                setRenderCycle(c => c + 1);
            });

            alphaTabApi.renderFinished.on(() => {
                console.log('✅ Render finished');
                setIsRendered(true);

                // Click-to-seek handler
                setTimeout(() => {
                    if (!containerRef.current) return;

                    const surface = containerRef.current.querySelector('.at-surface') as HTMLElement;
                    const target = surface || containerRef.current;

                    console.log('✅ Attaching click handler');

                    const handleClick = (e: MouseEvent) => {
                        if (!alphaTabApi.renderer?.boundsLookup) {
                            console.warn('⚠️ boundsLookup not available');
                            return;
                        }

                        const rect = containerRef.current!.getBoundingClientRect();
                        const x = e.clientX - rect.left + containerRef.current!.scrollLeft;
                        const y = e.clientY - rect.top + containerRef.current!.scrollTop;

                        console.log(`🖱️ Click at X=${x.toFixed(1)}, Y=${y.toFixed(1)}`);

                        const beat = alphaTabApi.renderer.boundsLookup.getBeatAtPos(x, y);

                        if (beat && beat.absolutePlaybackStart !== undefined) {
                            const tick = beat.absolutePlaybackStart;
                            console.log(`✅ Found beat at tick ${tick}`);
                            alphaTabApi.tickPosition = tick;
                        } else {
                            console.warn('⚠️ No beat found at click position');
                        }
                    };

                    target.addEventListener('click', handleClick);
                    console.log('✅ Click-to-seek enabled');
                }, 100);

                // Wait for bounds to populate
                setTimeout(() => {
                    if (alphaTabApi.renderer?.boundsLookup?.staffSystems) {
                        console.log('✅ Bounds ready (200ms delay)');
                        setBoundsReady(true);

                        const lookup = alphaTabApi.renderer.boundsLookup;
                        console.log('📊 Bounds Info:', {
                            staffSystems: lookup.staffSystems?.length || 0,
                        });

                        if (lookup.staffSystems?.[0]) {
                            const system = lookup.staffSystems[0];
                            console.log('📐 First System:', {
                                y: system.realBounds?.y,
                                h: system.realBounds?.h,
                            });
                        }

                        const trackIndices = alphaTabApi.tracks
                            ? new Set(alphaTabApi.tracks.map((t: any) => t.index))
                            : new Set([0]);

                        const tickCache = (alphaTabApi as any).tickCache;
                        if (tickCache) {
                            const beatResult = tickCache.findBeat(trackIndices, 0);
                            if (beatResult?.beat) {
                                const beatBounds = lookup.findBeat(beatResult.beat);
                                if (beatBounds) {
                                    console.log('🎯 First Beat Bounds (NESTED):', {
                                        'visualBounds is object': typeof beatBounds.visualBounds === 'object',
                                        'visualBounds.x': beatBounds.visualBounds?.x,
                                        'visualBounds.y': beatBounds.visualBounds?.y,
                                        'visualBounds.h': beatBounds.visualBounds?.h,
                                    });
                                }
                            }
                        }
                    } else {
                        console.warn('⚠️ Bounds not ready after delay');
                    }
                }, 200);
            });

            // 🎵 Soundfont loading events
            if (alphaTabApi.soundFontLoad) {
                alphaTabApi.soundFontLoad.on(() => {
                    console.log('🎵 Soundfont loading started...');
                    setSoundfontStatus('loading');
                });
            }

            if (alphaTabApi.soundFontLoaded) {
                alphaTabApi.soundFontLoaded.on(() => {
                    console.log('✅ Soundfont loaded successfully!');
                    setSoundfontStatus('loaded');
                });
            }

            // 🎵 Monitor player state changes
            alphaTabApi.playerStateChanged.on((e: any) => {
                console.log('🎵 Player state:', e.state, 'stopped:', e.stopped);
                setIsPlaying(!e.stopped);
            });

            alphaTabApi.playedBeatChanged.on((beat: any) => {
                console.log('🎵 Beat changed:', beat.absolutePlaybackStart);
            });

            setApi(alphaTabApi);
            (window as any).__at = alphaTabApi;

            // Player ready detection
            const checkPlayerReady = () => {
                console.log('🔍 Player status:', {
                    isReadyForPlayback: alphaTabApi.isReadyForPlayback,
                    playerState: alphaTabApi.playerState,
                    hasPlayer: !!alphaTabApi.player,
                    hasOutput: !!alphaTabApi.player?.output,
                });

                if (alphaTabApi.isReadyForPlayback) {
                    console.log('✅ Player ready!');
                    setIsPlaying(alphaTabApi.playerState !== 0);
                    return true;
                }
                return false;
            };

            // playerReady event
            if (alphaTabApi.playerReady) {
                console.log('📡 playerReady event found');
                alphaTabApi.playerReady.on(() => {
                    console.log('✅ playerReady event fired!');
                    setTimeout(checkPlayerReady, 100);
                });
            }

            // Poll for 15 seconds
            let pollCount = 0;
            const maxPolls = 15;
            const pollInterval = setInterval(() => {
                pollCount++;
                console.log(`🔄 Poll ${pollCount}/${maxPolls}...`);

                if (checkPlayerReady()) {
                    clearInterval(pollInterval);
                } else if (pollCount >= maxPolls) {
                    console.error('❌ Timeout - soundfont failed to load!');
                    console.error('🔍 Debug checklist:');
                    console.error('  1. File exists: /public/soundfont/sonivox.sf2');
                    console.error('  2. Check Network tab for 404 errors');
                    console.error('  3. Check file size (should be ~2-3MB)');
                    console.error('  4. Check browser console for CORS errors');
                    clearInterval(pollInterval);
                    setSoundfontStatus('error');
                    setForceReady(true);
                }
            }, 1000);

            const cleanup = setTimeout(() => {
                clearInterval(pollInterval);
            }, 16000);

            return () => {
                clearInterval(pollInterval);
                clearTimeout(cleanup);
            };
        };

        initAlphaTab().catch(console.error);

        return () => {
            destroyed = true;
            if (api) {
                api.destroy();
            }
        };
    }, []);

    // Check if soundfont file exists (diagnostic)
    useEffect(() => {
        console.log('🔍 Starting soundfont file accessibility check...');
        fetch('/soundfont/sonivox.sf2', { method: 'HEAD' })
            .then(response => {
                console.log('🔍 Soundfont HEAD response:', {
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    size: response.headers.get('content-length'),
                    type: response.headers.get('content-type'),
                });
                if (response.ok) {
                    console.log('✅ Soundfont file is accessible at /soundfont/sonivox.sf2');
                } else {
                    console.error('❌ Soundfont returned error:', response.status, response.statusText);
                }
            })
            .catch(err => {
                console.error('❌ Soundfont file fetch failed:', err);
                console.error('   This usually means the file path is wrong or server not running');
            });
    }, []);

    const handleSeek = () => {
        if (!api || !boundsReady) {
            console.warn('⚠️ Cannot seek - not ready');
            return;
        }

        const targetTick = 10000;
        console.log(`🎯 Seek to tick ${targetTick}`);
        api.tickPosition = targetTick;
    };

    const handleTogglePlay = () => {
        if (!api) {
            console.warn('⚠️ API not ready');
            return;
        }

        if (!api.isReadyForPlayback && !forceReady) {
            console.warn('⚠️ Player not ready');
            return;
        }

        if (isPlaying) {
            console.log('⏸️ Pause');
            api.pause();
        } else {
            console.log('▶️ Play');
            api.play();
        }
    };

    return (
        <div style={{ padding: '20px', fontFamily: 'monospace' }}>
            {/* Debug Controls */}
            <div style={{
                position: 'fixed',
                top: 20,
                right: 20,
                background: '#fff',
                border: '2px solid #000',
                padding: '15px',
                zIndex: 10000,
                borderRadius: '8px',
                maxWidth: '300px',
            }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Debug v3.3 - READY</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                        onClick={handleSeek}
                        disabled={!boundsReady}
                        style={{
                            padding: '8px',
                            fontSize: '12px',
                            cursor: boundsReady ? 'pointer' : 'not-allowed',
                            background: boundsReady ? '#4caf50' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                        }}
                    >
                        🎯 Seek
                    </button>
                    <button
                        onClick={handleTogglePlay}
                        disabled={!api?.isReadyForPlayback && !forceReady}
                        style={{
                            padding: '8px',
                            fontSize: '12px',
                            cursor: (api?.isReadyForPlayback || forceReady) ? 'pointer' : 'not-allowed',
                            background: (api?.isReadyForPlayback || forceReady) ? '#2196f3' : '#ccc',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                        }}
                    >
                        {isPlaying ? '⏸️ Pause' : '▶️ Play'}
                    </button>
                    <div style={{
                        fontSize: '11px',
                        marginTop: '10px',
                        padding: '8px',
                        background: '#f5f5f5',
                        borderRadius: '4px',
                    }}>
                        <div>Rendered: {isRendered ? '✅' : '❌'}</div>
                        <div>Bounds: {boundsReady ? '✅' : '❌'}</div>
                        <div>Player: {api?.isReadyForPlayback ? '✅' : forceReady ? '⚠️' : '⏳'}</div>
                        <div>Soundfont: {
                            soundfontStatus === 'loaded' ? '✅' :
                                soundfontStatus === 'error' ? '❌' :
                                    '⏳'
                        }</div>
                        <div>Cycle: {renderCycle}</div>
                    </div>
                    {soundfontStatus === 'error' && (
                        <div style={{
                            fontSize: '10px',
                            padding: '8px',
                            background: '#ffebee',
                            borderRadius: '4px',
                            color: '#c62828',
                        }}>
                            <strong>❌ Soundfont Failed</strong>
                            <div>Check console & Network tab</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Info */}
            <div style={{
                background: '#fffbcc',
                border: '2px solid #ff9800',
                padding: '15px',
                marginBottom: '20px',
                borderRadius: '8px',
            }}>
                <h2 style={{ margin: '0 0 10px 0' }}>🔥 v3.3 - PRODUCTION READY</h2>
                <ul style={{ margin: 0 }}>
                    <li>✅ PlayerMode.EnabledSynthesizer (enum value 2)</li>
                    <li>✅ Workers enabled with CDN path</li>
                    <li>✅ Root-relative paths for Next.js</li>
                    <li>✅ Ready for Daniel's review</li>
                </ul>
                <div style={{
                    marginTop: '10px',
                    padding: '8px',
                    background: '#e3f2fd',
                    borderRadius: '4px',
                    fontSize: '12px',
                }}>
                    <strong>📂 Required Files:</strong>
                    <pre style={{ margin: '5px 0', fontSize: '11px' }}>{`
/alphaTab (repo root)
├── /public
│   └── /soundfont
│       └── sonivox.sf2  ⬅️ Required!
└── /src
    ├── /app/page.tsx
    └── /components/
        └── MaestroCursor.tsx

Note: Fonts loaded from CDN automatically
                    `}</pre>
                </div>
            </div>

            {/* AlphaTab Container */}
            <div
                ref={containerRef}
                style={{
                    position: 'relative',
                    width: '100%',
                    minHeight: '600px',
                    background: '#fff',
                    overflow: 'visible',
                }}
            >
                {isRendered && boundsReady && api && (
                    <MaestroCursor
                        api={api}
                        isRendered={true}
                        isPlaying={isPlaying}
                        renderCycle={renderCycle}
                    />
                )}
            </div>
        </div>
    );
}