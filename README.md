AlphaTab Maestro Cursor - 1.8.1 Stable Implementation
AlphaTab Version: 1.8.1 (Stable)

Latest Update: February 7th, 2026

Status: ✅ STABLE - WITH DANIEL'S PRECISION PATCH

🚀 What's New in the 1.8.1 Migration

1. The "Daniel Patch" (onNotesX)
   In version 1.8.1, the engine occasionally miscalculates startBeatX for certain GP3/GP5 files, causing the cursor to sit off-center. We have implemented Daniel's recommended fix: Ignoring startBeatX in favor of onNotesX.

2. Global Type Definitions
   To fix CSS import errors and allow for the Red Debug Cursor (window-level access), a src/global.d.ts has been added.

📂 Project Structure Update
/alphaTab (repo root)
├── /public
│ ├── /soundfont
│ │ └── sonivox.sf2
│ └── /samples
│ └── extreme-rise.gp5 ⬅️ Current Test Case (Issue #2548)
├── /src
│ ├── /app
│ │ └── page.tsx
│ ├── /components
│ │ └── MaestroCursor.tsx ⬅️ v2.15 (Stable 1.8.1 Logic)
│ └── global.d.ts ⬅️ NEW: Fixes CSS & Window types
├── package.json
└── next.config.js
🎯 The 1.8.1 Precision Logic
Daniel’s Cursor Alignment Fix
If you notice the cursor is "off-center" on notes (especially in GP3 files), we now use onNotesX instead of visualBounds.x.

TypeScript
// MaestroCursor.tsx - v2.15 Precision Logic
placeBeatCursor(beatCursor, beatBounds) {
const barBounds = beatBounds.barBounds.masterBarBounds.visualBounds;

    // ✅ DANIEL'S 1.8.1 FIX:
    // We ignore startBeatX/visualBounds.x as they may be incorrect in this version.
    const precisionX = beatBounds.onNotesX;

    beatCursor.setBounds(precisionX, barBounds.y, 1, barBounds.h);

}
src/global.d.ts for CSS & Debugging
To resolve "Module not found" for .css files in Next.js and to expose AlphaTab for the Red Debug Cursor:

TypeScript
declare module "\*.css";

interface Window {
alphaTab: any; // Allows console debugging and Red Cursor access
}
🔧 Technical Configuration (1.8.1 Stable)
AlphaTab Settings
TypeScript
const settings = new alphaTab.Settings();

// Core 1.8.1 settings
settings.core.engine = "svg";
settings.core.fontDirectory = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.1/dist/font/";
settings.core.includeNoteBounds = true;
settings.core.scriptFile = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.1/dist/alphaTab.worker.mjs";

// Player
settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia; // For YouTube Sync
settings.player.enableCursor = false; // We use the Maestro Purple Cursor
🐛 Known Issues & Workarounds

1. The "Extreme - Rise" Repeat Bug (#2548)
   Symptom: In songs with 3x repeats, seeking into the 2nd/3rd pass causes the cursor to desync (jumps back to 1st pass). Workaround: We use the "Mode Toggle" trick before seeking:

Flip playerMode to EnabledSynthesizer.

Call api.updateSettings().

Flip back to EnabledExternalMedia.

Perform the Seek.

2. Red Debug Cursor
   For development, you can toggle the Red Cursor via the browser console to see exactly where AlphaTab thinks the beat is vs. where our Maestro Cursor is drawing it.

🤝 Information for Daniel (CoderLine)
We are providing the following files for the current Issue #2548 investigation:

GP5 File: /public/samples/extreme-rise.gp5

Video Ref: https://youtu.be/stt11W1L2OQ

Observation: Desync occurs specifically on the 2nd pass of the repeat at Tick [X].

Last Updated: February 7th, 2026

Environment: Next.js 14, AlphaTab 1.8.1 (Stable)
