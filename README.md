# AlphaTab Custom Cursor - Working Implementation

**AlphaTab Version:** 1.9.0-alpha.1695  
**Test Date:** January 30th, 2026  
**Status:** ✅ **PRODUCTION READY**

---

## 🚀 Quick Start for Testing

### 1. Clone & Install

```bash
git clone [repo-url]
cd alphaTab
npm install
```

### 2. **CRITICAL:** Verify Public Folder Structure

Next.js requires the `public` folder at the **project root**. Verify this structure:

```
/alphaTab (repo root - where package.json lives)
├── /public                              ⬅️ MUST be here!
│   ├── /soundfont                       ⬅️ Audio synthesis
│   │   └── sonivox.sf2 (~1.3MB)
│   └── /samples                         ⬅️ Test files
│       └── extreme-rise/
│           └── extreme-rise.gp5
├── /src
│   ├── /app
│   │   └── page.tsx                     ⬅️ AlphaTab initialization
│   └── /components
│       └── MaestroCursor.tsx            ⬅️ Custom cursor (v2.11)
├── package.json
└── next.config.js
```

**Why This Matters:**  
Next.js only serves static files from `/public/` at the root. The **music fonts are loaded from CDN** (no local files needed), but the **soundfont must be local** for fast loading.

### 3. Run Development Server

```bash
npm run dev
```

Open browser to `http://localhost:3000`

---

## 🎵 What You Should See

**On Initial Load:**

1. **Purple cursor** with white dot at the first note
2. **Debug label** showing: `X: 115.9 | Y: 310.0 | H: 65`
3. **Console logs:**
   ```
   ✅ Soundfont file is accessible at /soundfont/sonivox.sf2
   ✅ Player mode: EnabledSynthesizer (enum value 2)
   🎵 Soundfont loading started...
   ✅ Soundfont loaded successfully!
   ✅ Player ready!
   ```

**Testing Seek (Button):**

1. Click **"🎯 Seek to Tick 10000"**
2. Cursor **instantly snaps** to new position
3. Console shows: `⚡ v2.11: Snapped to X=260.7`

**Testing Playback (Button):**

1. Click **"▶️ Play"**
2. Cursor **smoothly follows** playback
3. Moves between notes with interpolation

---

## 🔧 Technical Configuration

### AlphaTab Settings (page.tsx)

```typescript
const settings = new alphaTab.Settings();

// Core settings
settings.core.engine = "svg";
settings.core.fontDirectory =
  "https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/font/"; // CDN fonts
settings.core.includeNoteBounds = true; // Required for cursor coordinates
settings.core.useWorkers = true; // Required for synthesizer
settings.core.scriptFile =
  "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.9.0-alpha.1695/dist/alphaTab.worker.mjs";

// Display
settings.display.layoutMode = alphaTab.LayoutMode.Page;
settings.display.staveProfile = alphaTab.StaveProfile.Tab;

// Player - ROOT-RELATIVE PATH for soundfont
settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer; // Enum value 2
settings.player.soundFont = "/soundfont/sonivox.sf2"; // Points to /public/soundfont/
settings.player.enableCursor = false; // We use custom cursor
settings.player.enableAnimatedBeatCursor = false;
```

**Key Points:**

- **Fonts from CDN:** No local font files needed - AlphaTab loads them automatically
- **Soundfont local:** Must be at `/public/soundfont/sonivox.sf2` for fast loading
- **Workers MUST be enabled** for synthesizer mode (audio processing requires Web Workers)
- **CDN worker path** avoids Next.js `file://` errors with local node_modules
- **Root-relative soundfont path** (`/soundfont/`) works with Next.js static serving

---

## 🎯 Custom Cursor Implementation

### Coordinate Extraction (NESTED Structure)

AlphaTab 1.9.0-alpha uses **nested objects**, not flat properties:

```typescript
// ✅ CORRECT
const x = beatBounds.visualBounds?.x ?? beatBounds.realBounds?.x ?? 0;
const y = beatBounds.visualBounds?.y ?? beatBounds.realBounds?.y ?? 0;
const h = beatBounds.visualBounds?.h ?? beatBounds.realBounds?.h ?? 99;

// ❌ WRONG (old assumption)
// const x = beatBounds.visualBounds_x;  // Doesn't exist!
```

### Positioning (Beat Level, Not System)

```typescript
// Use beat Y (e.g., 310) for staff-level positioning
// NOT system Y (e.g., 262) which puts cursor above staff

return {
  x: beatBounds.visualBounds.x, // Horizontal position
  y: beatBounds.visualBounds.y, // Staff level (310)
  height: beatBounds.visualBounds.h, // Beat height (65px)
};
```

### Songsterr-Style Rendering

```typescript
const TOP_OVERHANG = 20; // White dot extends above staff
const BOTTOM_OVERHANG = 12; // Cursor extends below staff
const totalHeight = height + TOP_OVERHANG + BOTTOM_OVERHANG;

// Position with top offset
transform: `translate3d(${x}px, ${y - TOP_OVERHANG}px, 0)`;
```

**Container Requirements:**

```typescript
<div style={{ position: 'relative' }}>  {/* Creates coordinate context */}
  {/* AlphaTab renders here */}
  <MaestroCursor api={api} ... />  {/* Cursor inside container */}
</div>
```

---

## 🐛 Troubleshooting

### "Not allowed to load local resource" Error

**Symptom:** Console shows `file:///Users/.../node_modules/...` errors

**Cause:** AlphaTab can't find soundfont in `/public/` folder

**Solutions:**

1. ✅ Verify `public` folder is at **project root** (not nested)
2. ✅ Verify soundfont exists: `ls -la public/soundfont/sonivox.sf2`
3. ✅ Restart dev server: `npm run dev`
4. ✅ Clear Next.js cache: `rm -rf .next`
5. ✅ Browser network tab shows `200 OK` for `/soundfont/sonivox.sf2`

**Note:** Fonts load from CDN automatically - if you see font errors, it's likely a network issue, not missing files.

### Player Times Out (Never Ready)

**Symptom:** Status shows `Player: ⏳ Loading...` forever

**Causes & Solutions:**

| Cause              | Solution                                               |
| ------------------ | ------------------------------------------------------ |
| Wrong player mode  | Use `alphaTab.PlayerMode.EnabledSynthesizer` (value 2) |
| Workers disabled   | Set `settings.core.useWorkers = true`                  |
| Soundfont 404      | Verify `/public/soundfont/sonivox.sf2` exists          |
| CDN worker blocked | Check `scriptFile` points to jsdelivr CDN              |

### Cursor Not Visible

**Symptom:** No purple cursor appears

**Causes & Solutions:**

| Cause                              | Solution                                                |
| ---------------------------------- | ------------------------------------------------------- |
| Container not `position: relative` | Add `position: relative` to AlphaTab container          |
| Bounds not ready                   | Wait for `renderFinished` event before rendering cursor |
| Using system Y instead of beat Y   | Use `beatBounds.visualBounds.y` (not system bounds)     |
| Nested properties not accessed     | Use `visualBounds.x` (not `visualBounds_x`)             |

---

## 📊 Console Output Reference

### Successful Initialization

```
🔧 Workers enabled for synthesizer (CDN)
📂 Fonts: CDN (no local files needed)
🎵 Soundfont: /soundfont/sonivox.sf2 (local)
✅ Player mode: EnabledSynthesizer (enum value 2)
🔍 Soundfont HEAD response: {ok: true, status: 200, size: '1351896'}
✅ Soundfont file is accessible
✅ Score loaded
✅ Render finished
✅ Bounds ready (200ms delay)
🎯 First Beat Bounds (NESTED): {
  visualBounds.x: 115.916,
  visualBounds.y: 310,
  visualBounds.h: 65
}
🎸 MaestroCursor v2.11: Position listener enabled
✅ Player ready!
```

### Successful Seek

```
🎯 Manual seek to tick 10000
🎯 v2.11: Position changed to tick 10000
✅ v2.11: Found beat at new position
✅ v2.11: Extracted X=260.7, Y=450.0, H=65
⚡ v2.11: Snapped to X=260.7
```

---

## 🎨 Visual Design (Songsterr Style)

**Current Implementation:**

- **White dot:** Extends 20px above staff
- **Purple cursor body:** 65px tall (beat height)
- **Bottom extension:** 12px below staff
- **Positioning:** Staff level (Y=310), not floating
- **Animation:** Smooth lerp (0.3 factor) during playback
- **Instant snap:** On seeks and clicks

**Matches Songsterr's cursor behavior perfectly!** ✅

---

## 📝 Files Modified

1. **`src/app/page.tsx`** - AlphaTab initialization with synthesizer
2. **`src/components/MaestroCursor.tsx`** (v2.11) - Custom cursor component
3. **`public/soundfont/sonivox.sf2`** - Audio synthesis soundfont (local)
4. **`public/samples/extreme-rise/extreme-rise.gp5`** - Test file

**Note:** Music fonts (Bravura) are loaded from CDN - no local files needed!

---

## 🤝 For AlphaTab Team (Daniel)

### Key Discoveries

1. **Property Structure:** AlphaTab 1.9.0-alpha uses **nested objects** (`visualBounds.x`), not flat properties
2. **Positioning:** Use **beat bounds** for cursor placement, not system bounds
3. **Event Handling:** Synthesizer mode required for full `playerPositionChanged` support
4. **Next.js Quirk:** Public folder MUST be at project root for static file serving

### Production-Ready Features

✅ Custom cursor with Songsterr-style rendering  
✅ Smooth interpolation during playback  
✅ Instant snap on seeks  
✅ Proper coordinate extraction from nested bounds  
✅ Full synthesizer integration  
✅ Click-to-seek functionality  
✅ React state management  
✅ No console errors

### Test Coverage

- [x] Initial render and positioning
- [x] Manual seek via button
- [x] Click-to-seek on tablature
- [x] Continuous playback tracking
- [x] Orientation changes (mobile)
- [x] Track switching
- [x] Soundfont loading
- [x] Font rendering

---

## 📬 Questions?

The implementation is fully functional and ready for review. All source code is available in the repository.

**Status:** ✅ Production Ready for Daniel's Review

---

**Last Updated:** January 30th, 2026  
**Test Environment:** Next.js 14, React 18, AlphaTab 1.9.0-alpha.1695
