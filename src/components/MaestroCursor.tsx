/**
 * MaestroCursor v3.0 - ICursorHandler Implementation (CLEAN)
 * Date: January 31st, 2026
 * 
 * 🔥 ZERO AlphaTab imports - pure local types only!
 */

'use client';

// ========== LOCAL TYPE DEFINITIONS (NO IMPORTS!) ==========

interface Beat {
    absolutePlaybackStart: number;
    [key: string]: any;
}

interface VisualBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface ICursorHandler {
    update(beat: Beat | null, visualBounds: VisualBounds | null): void;
}

// ========== MAESTRO CURSOR CLASS ==========

export class MaestroCursor implements ICursorHandler {
    private element: HTMLElement;
    private cursorWidth = 14;
    private topOverhang = 20;
    private bottomOverhang = 12;
    private lastBeatTick = 0;
    private svgRendered = false;

    constructor(container: HTMLElement) {
        console.log('🎸 MaestroCursor v3.0: Initializing...');

        // Create cursor element
        this.element = document.createElement('div');
        this.element.id = 'maestro-cursor-v3';
        this.element.className = 'maestro-cursor-icursor';

        // Styles
        this.element.style.position = 'absolute';
        this.element.style.top = '0';
        this.element.style.left = '0';
        this.element.style.pointerEvents = 'none';
        this.element.style.zIndex = '99999';
        this.element.style.willChange = 'transform';
        this.element.style.width = `${this.cursorWidth}px`;
        this.element.style.overflow = 'visible';
        this.element.style.visibility = 'hidden';
        this.element.style.opacity = '0';

        container.appendChild(this.element);
        console.log('✅ MaestroCursor v3.0: Element created');
    }

    /**
     * ICursorHandler method - called by AlphaTab engine
     */
    update(beat: Beat | null, visualBounds: VisualBounds | null): void {
        console.log('🔥 UPDATE CALLED!', {
            tick: beat?.absolutePlaybackStart,
            x: visualBounds?.x,
            y: visualBounds?.y
        });

        if (!beat || !visualBounds) {
            this.element.style.visibility = 'hidden';
            this.element.style.opacity = '0';
            return;
        }

        // Show cursor
        this.element.style.visibility = 'visible';
        this.element.style.opacity = '1';

        // 🎯 CENTERING FIX
        const noteCenterX = visualBounds.x + (visualBounds.w / 2);
        const finalX = noteCenterX - (this.cursorWidth / 2);

        // Calculate dimensions
        const totalHeight = visualBounds.h + this.topOverhang + this.bottomOverhang;
        const finalY = visualBounds.y - this.topOverhang;

        // Apply position (GPU accelerated)
        this.element.style.transform = `translate3d(${finalX}px, ${finalY}px, 0px)`;
        this.element.style.height = `${totalHeight}px`;

        // Render SVG once
        if (!this.svgRendered) {
            this.renderSVG(totalHeight, visualBounds.h);
            this.svgRendered = true;
        }

        // Debug logging
        if (beat.absolutePlaybackStart !== this.lastBeatTick) {
            this.lastBeatTick = beat.absolutePlaybackStart;
            console.log(`[Maestro v3.0] Tick: ${beat.absolutePlaybackStart} | ` +
                `X=${finalX.toFixed(1)}, Y=${visualBounds.y.toFixed(1)}, ` +
                `Center=${noteCenterX.toFixed(1)}`);
        }

        this.updateDebugLabel(finalX, visualBounds.y, visualBounds.h, visualBounds.w);
    }

    private renderSVG(totalHeight: number, beatHeight: number): void {
        this.element.innerHTML = `
            <svg width="${this.cursorWidth}" height="${totalHeight}" 
                 viewBox="0 0 ${this.cursorWidth} ${totalHeight}"
                 style="display:block;overflow:visible;filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.5));">
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
                
                <!-- Purple cursor body (bottom point lowered 2px) -->
                <path d="M 0,7 Q 0,0 7,0 Q 14,0 14,7 
                         V ${beatHeight + this.topOverhang} 
                         L 7 ${totalHeight + 2}
                         L 0 ${beatHeight + this.topOverhang} Z"
                      fill="rgba(168, 85, 247, 0.45)"
                      filter="url(#maestroCursorShadow)" />
                
                <!-- White dot (moved down 3px) -->
                <path d="M 3.5 6 C 3.5 4.3 5 3 7 3 
                         C 9 3 10.5 4.3 10.5 6 
                         C 10.5 8.5 8 12 7 12 
                         C 6 12 3.5 8.5 3.5 6 Z"
                      fill="white" />
            </svg>
        `;
        console.log('✅ SVG rendered');
    }

    private updateDebugLabel(x: number, y: number, h: number, w: number): void {
        let label = this.element.querySelector('.debug-label') as HTMLElement;

        if (!label) {
            label = document.createElement('div');
            label.className = 'debug-label';
            label.style.position = 'absolute';
            label.style.top = '-40px';
            label.style.left = '20px';
            label.style.background = 'rgba(255, 0, 0, 0.9)';
            label.style.color = 'white';
            label.style.padding = '6px 10px';
            label.style.fontSize = '11px';
            label.style.borderRadius = '4px';
            label.style.whiteSpace = 'nowrap';
            label.style.fontWeight = 'bold';
            this.element.appendChild(label);
        }

        label.innerHTML = `🎯 V3.0<br/>X: ${x.toFixed(1)} | Y: ${y.toFixed(1)} | W: ${w.toFixed(1)}`;
    }

    destroy(): void {
        console.log('🧹 MaestroCursor v3.0: Destroying...');
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }
}

// ========== FACTORY FUNCTION ==========

export function attachMaestroCursor(api: any, container: HTMLElement): MaestroCursor {
    const cursor = new MaestroCursor(container);
    api.cursorHandler = cursor;
    console.log('✅ MaestroCursor v3.0: Attached to AlphaTab API');
    return cursor;
}