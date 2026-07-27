// Attachment offsets are relative to the body center, in pixels.
// These are starting points — students are expected to tune them.
const PARTS = {
    body:   {
        colors: ['blue', 'green', 'red', 'yellow', 'dark'],
        shapes: ['A', 'B', 'C', 'D', 'E', 'F'],
        // texture key pattern: body_{color}{shape}
        offset: { x: 0,   y: 0 }
    },
    arm:     { 
        colors: ['blue', 'green', 'red', 'yellow', 'dark'],
        shapes: ['A', 'B', 'C', 'D', 'E'],
        // arm_{color}{A|B|C|D|E}
        offset: { x: 90,  y: 10  } 
    },  
    // TODO: need to add colors and shapes (or alternate) to the below 
    leg:     { offset: { x: 45,  y: 100 } },   // leg_{color}{A|B|C}
    eye:     { offset: { x: 0,   y: -30 }, spacing: 40 },  // eye_{style}
    mouth:   { offset: { x: 0,   y: 30  } },   // mouth{A..J}
    antenna: { offset: { x: 0,   y: -95 }, spacing: 50 },  // detail_{color}_antenna_{small|large}
};
const CENTER_X = 400;
const CENTER_Y = 300;

// --- Color instrumentation ---------------------------------------------------
// Phaser's setTint() is MULTIPLICATIVE, not a repaint: every channel of the tint
// is multiplied with the texture's own pixels (effective = base * tint / 255).
// A tint can therefore only darken a part, never lighten or recolor it — tinting
// an already-dark part just drags it toward mud. Only the lighter bases take a
// tint predictably.
//
// The hexes below are averages of the opaque pixels of the shipped assets, so
// they fold in outlines and shading: approximate by design, good enough to
// predict whether a tint will read on screen. Detail sprites (antennas) run a
// little darker than the body/arm/leg average listed here.
const PART_BASE_COLORS = {
    blue:   '#41d3e0',
    green:  '#2dc86f',
    red:    '#fa4361',
    yellow: '#ffb202',
    dark:   '#4d3d2e',   // dark = brown
};

// Eyes and mouths have no color param — their base color comes from the style.
// Keys match the texture-key suffix used in scene.js.
const EYE_BASE_COLORS = {
    // angry/human eyes are mostly white sclera, so they read very light
    angry_blue:      '#b9d3d3',
    angry_green:     '#c9dccf',
    angry_red:       '#dfb4b9',
    human_blue:      '#bad9db',
    human_green:     '#b9d9c4',
    human_red:       '#d28b94',
    blue:            '#49cdd9',
    red:             '#d63e55',
    yellow:          '#daa412',
    dead:            '#33291e',
    closed_feminine: '#33291e',
    closed_happy:    '#33291e',
    cute_dark:       '#423527',
    cute_light:      '#867e76',
    psycho_dark:     '#60584f',
    psycho_light:    '#d9d6d2',
};

const MOUTH_BASE_COLORS = {
    A: '#a47678', B: '#7f5f5c', C: '#765f5a', D: '#5b3f39', E: '#765e5a',
    F: '#6f4c49', G: '#634c46', H: '#975257', I: '#502d28', J: '#774949',
};

function hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [clamp(r), clamp(g), clamp(b)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
}

// What a tinted part actually ends up looking like: each channel of the base
// texture multiplied by the matching channel of the tint. No tint => base.
function effectiveColor(baseHex, tintHex) {
    if (!baseHex) return null;
    const base = hexToRgb(baseHex);
    if (!tintHex) return rgbToHex(base.r, base.g, base.b);
    const tint = hexToRgb(tintHex);
    return rgbToHex(base.r * tint.r / 255, base.g * tint.g / 255, base.b * tint.b / 255);
}

// Perceived brightness, 0 (black) to 255 (white).
function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

// Base color of a part from the params it was placed with -> { name, hex }.
// hex is null when the asset's base color isn't known.
function basePartColor(partType, params = {}) {
    switch (partType) {
        case 'eyes': {
            const style = params.style || 'blue';
            const key = (style === 'angry' || style === 'human')
                ? `${style}_${params.color || 'blue'}`
                : style;
            return { name: key.replace('_', ' '), hex: EYE_BASE_COLORS[key] || null };
        }
        case 'mouth': {
            const style = (params.style || 'A').toUpperCase();
            return { name: `mouth ${style}`, hex: MOUTH_BASE_COLORS[style] || null };
        }
        default: {
            const name = params.color || 'blue';
            return { name, hex: PART_BASE_COLORS[name] || null };
        }
    }
}

// Reply-text fragment spelling out what a tint did, e.g.
//   " (base dark, tint #cd853f, effective ≈ #3e200b)"
// Empty string when no tint was applied.
function tintNote(base, tintHex) {
    if (!tintHex) return '';
    if (!base || !base.hex) return ` (tint ${tintHex}, base color unknown)`;
    return ` (base ${base.name}, tint ${tintHex}, effective ≈ ${effectiveColor(base.hex, tintHex)})`;
}