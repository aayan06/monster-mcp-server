import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import * as z from 'zod';
import fs from 'fs';
import path from 'path';

// Create the server
const server = new McpServer({
    name: 'phaser-monster-tools',
    version: '1.0.0',
});

// --- WebSocket bridge to the Phaser game ---
const wss = new WebSocketServer({ port: 8081 });
let gameSocket = null;          // the currently connected game, if any
const pending = new Map();      // message id -> resolve function
let nextId = 1;

wss.on('connection', (ws) => {
    console.error('[bridge] Phaser game connected');
    gameSocket = ws;

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        // Find the promise waiting for this reply, and resolve it
        const resolve = pending.get(msg.id);
        if (resolve) {
            resolve(msg);
            pending.delete(msg.id);
        }
    });

    ws.on('close', () => {
        console.error('[bridge] game disconnected');
        if (gameSocket === ws) gameSocket = null;
    });
});

// Send a command to the game and wait for its reply
function sendToGame(command, params = {}) {
    return new Promise((resolve, reject) => {
        if (!gameSocket) {
            reject(new Error('No game connected. Is the game page open in your browser?'));
            return;
        }
        const id = nextId++;
        pending.set(id, resolve);
        gameSocket.send(JSON.stringify({ id, command, params }));

        // Don't wait forever
        setTimeout(() => {
            if (pending.delete(id)) {
                reject(new Error('Game did not respond within 5 seconds.'));
            }
        }, 5000);
    });
}

// --- Shared styling params, accepted by every part-placing tool ---
const TINT_DOC = ' HOW TINT REALLY WORKS: Phaser tint is MULTIPLICATIVE, not a repaint. '
    + 'Each channel of the tint is multiplied with the texture\'s own pixels '
    + '(effective = base * tint / 255), so a tint can only ever darken a part — it can never '
    + 'lighten it or replace its color. Tinting a dark part (dark = brown) drags it toward mud '
    + 'rather than repainting it: dark #4d3d2e tinted #cd853f lands on ~#3e200b, near-black. '
    + 'Only lighter base parts (blue, green, red, yellow, and the light eye styles) take a tint '
    + 'predictably; to darken a light part use a mid-gray tint, and to get a genuinely different '
    + 'hue pick a different base color instead of tinting. Every reply reports the effective '
    + 'color, and describe_monster_colors shows it for the whole monster.';

const STYLE_DOC = 'Optional styling params: tint (hex string like "#8833ff", multiplied over the '
    + 'part — see below), '
    + 'scale (uniform size multiplier, default 1), scaleX/scaleY (stretch on one axis), '
    + 'angle (rotation in degrees), dx/dy (pixel nudge from the default attachment point; '
    + 'positive dx moves right, positive dy moves down).'
    + TINT_DOC;
const MIRROR_DOC = ' Parts are placed as mirrored left/right pairs: dx is mirrored and angle is '
    + 'negated on the flipped side, so both sides stay symmetric.';

const styleFields = {
    tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe(
        'Hex tint color like "#8833ff". MULTIPLICATIVE: each channel is multiplied with the '
        + 'texture\'s pixels (effective = base * tint / 255), so a tint only ever darkens — '
        + 'tinting a dark part turns it to mud instead of repainting it. Reliable on light bases only.'),
    scale: z.number().optional().describe('Uniform scale multiplier, default 1'),
    scaleX: z.number().optional().describe('Horizontal scale multiplier (overrides scale on the x axis)'),
    scaleY: z.number().optional().describe('Vertical scale multiplier (overrides scale on the y axis)'),
    angle: z.number().optional().describe('Rotation in degrees (negated on the flipped side of mirrored pairs)'),
    dx: z.number().optional().describe('Horizontal pixel nudge from the default attachment point (mirrored on the flipped side of pairs)'),
    dy: z.number().optional().describe('Vertical pixel nudge from the default attachment point'),
};

// --- Register tools
server.registerTool(
    'create_body',
    {
        description: 'Create the monster body. Must be called before adding any other parts. Replaces any existing monster. ' + STYLE_DOC,
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Body color, dark=brown'),
            shape: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).describe('Body shape variant: A=square, B=round, C=oval, D=squat oval, E=long body, F=long body with hair tufts'),
            ...styleFields,
        }),
    },
    async (params) => {
        try {
            const reply = await sendToGame('create_body', params);
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_eyes',
    {
        description: 'Add eyes to the monster. Must be called after create_body. ' + STYLE_DOC,
        inputSchema: z.object({
            style: z.enum([
                'angry', 'human', 'blue', 'red', 'yellow', 'dead',
                'closed_feminine', 'closed_happy', 'cute_dark', 'cute_light',
                'psycho_dark', 'psycho_light',
            ]).describe('Eye style/expression. "angry" and "human" require a color.'),
            color: z.enum(['blue', 'green', 'red']).optional().describe('Eye color, only used for style "angry" or "human", default blue'),
            count: z.number().int().min(1).max(5).optional().describe('Number of eyes, default 2'),
            ...styleFields,
        }),
    },
    async (params) => {
        try {
            const reply = await sendToGame('add_eyes', params);
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_arms',
    {
        description: 'Add arms to the monster (in left/right pairs). Must be called after create_body. ' + STYLE_DOC + MIRROR_DOC,
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Arm color, dark=brown'),
            pose: z.enum(['A', 'B', 'C', 'D', 'E']).optional().describe('Arm pose variant, default A'),
            count: z.number().int().min(2).max(6).multipleOf(2).optional().describe('Number of arms (must be even), default 2'),
            ...styleFields,
        }),
    },
    async (params) => {
        try {
            const reply = await sendToGame('add_arms', params);
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_antennas',
    {
        description: 'Add antennas to the top of the monster. Must be called after create_body. ' + STYLE_DOC,
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Antenna color, dark=brown'),
            count: z.number().int().min(1).max(3).optional().describe('Number of antennas, default 1'),
            size: z.enum(['small', 'large']).optional().describe('Antenna size, default large'),
            ...styleFields,
        }),
    },
    async (params) => {
        try {
            const reply = await sendToGame('add_antennas', params);
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- Color report tool ---
server.registerTool(
    'describe_monster_colors',
    {
        description: 'Report the real on-screen color of every part currently on the monster: part name, '
            + 'base color, tint if any, the effective color after Phaser\'s multiplicative tint '
            + '(effective = base * tint / 255), its luminance (0.2126*R + 0.7152*G + 0.0722*B, rounded), '
            + 'and the luminance gap from the body — that gap is the part\'s contrast against the body. '
            + 'Call this after tinting to confirm a part has not collapsed into mud, and to check that '
            + 'eyes, mouth, and limbs actually stand out from the body instead of disappearing into it.',
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const reply = await sendToGame('describe_monster_colors');
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- Screenshot tool ---
// Screenshots live in gallery/<series-slug>/NNN.png. NNN is derived by scanning
// the folder for the highest existing number each time, so restarts, parallel
// runs, and hand-edited folders can never overwrite an earlier shot.
function nextSeriesShot(series) {
    const slug = series.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dir = path.join(process.cwd(), 'gallery', slug);
    fs.mkdirSync(dir, { recursive: true });
    let highest = 0;
    for (const name of fs.readdirSync(dir)) {
        const m = /^(\d+)\.png$/.exec(name);
        if (m) highest = Math.max(highest, parseInt(m[1], 10));
    }
    const num = String(highest + 1).padStart(3, '0');
    return {
        slug,
        num,
        pngPath: path.join(dir, `${num}.png`),
        jsonPath: path.join(dir, `${num}.json`),
        relPath: `gallery/${slug}/${num}.png`,
    };
}

server.registerTool(
    'take_screenshot',
    {
        description: 'Take a screenshot of the current monster. Returns the image so you can see your work, '
            + 'and saves it into a named series at gallery/<series-slug>/NNN.png (NNN auto-increments from '
            + 'whatever is already in the folder) with a matching NNN.json sidecar holding the monster state '
            + 'at that moment. Use one series name for a whole build so its iterations stay grouped and comparable.',
        inputSchema: z.object({
            series: z.string().min(1).describe(
                'Series name for this batch of screenshots, e.g. "rust bucket" -> gallery/rust-bucket/001.png. '
                + 'Required. Reuse the same name across iterations of the same monster.'),
        }),
    },
    async ({ series }) => {
        try {
            const reply = await sendToGame('take_screenshot');
            const b64 = reply.result;
            const { slug, num, pngPath, jsonPath, relPath } = nextSeriesShot(series);
            fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));

            // Sidecar: whatever the game reports as the current monster state.
            let state;
            try {
                const stateReply = await sendToGame('get_monster_state');
                state = JSON.parse(stateReply.result);
            } catch (err) {
                console.error(`[screenshot] could not capture monster state: ${err.message}`);
                state = { error: err.message };
            }
            fs.writeFileSync(jsonPath, JSON.stringify({
                series,
                slug,
                number: num,
                savedAt: new Date().toISOString(),
                state,
            }, null, 2));

            console.error(`[screenshot] saved ${relPath} (+ ${num}.json)`);
            return {
                content: [
                    { type: 'image', data: b64, mimeType: 'image/png' },
                    { type: 'text', text: `Saved ${relPath}` },
                ],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- Memory tools ---
const NOTES_FILE = path.join(process.cwd(), 'design_notes.json');

function loadNotes() {
    try {
        return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveNotes(notes) {
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

// Entries written before styles existed have no style tag. They are shown as
// "(untagged)" and are only ever returned by an unfiltered recall.
function formatNote(n) {
    return `[${n.timestamp}] (${n.style || 'untagged'}) ${n.lesson}`;
}

function knownStyles(notes) {
    return [...new Set(notes.map(n => n.style).filter(Boolean))];
}

server.registerTool(
    'remember',
    {
        description: 'Save a design lesson to persistent notes (design_notes.json) so future sessions can build better monsters. '
            + 'Lessons are filed under a style name, so pass the same string you use as the take_screenshot series for this build.\n'
            + 'A good lesson is specific and actionable: it names the parts, params, and values involved, and says when it applies.\n'
            + 'CITE YOUR EVIDENCE: any lesson drawn from a specific monster must cite the screenshot that shows it, by the '
            + 'gallery path take_screenshot returned — e.g. "gallery/abyssal-lantern/007.png shows the tint washing out". '
            + 'A later session can then look at the image and judge the claim instead of taking it on faith; an uncited '
            + 'lesson about a specific monster is unverifiable and will be dropped at the next consolidation.\n'
            + 'Good example: "On tall shape-E bodies the default mouth sits too high — pass dy: 25 to add_mouth to center it '
            + 'on the face; gallery/abyssal-lantern/004.png shows the uncorrected version."\n'
            + 'Bad example (too vague to act on later, and cites nothing): "Positioning the parts carefully makes the monster look better."',
        inputSchema: z.object({
            style: z.string().min(1).describe(
                'Style this lesson belongs to. REQUIRED. Use the exact same string as the take_screenshot '
                + 'series name for this build, so the lessons and the images line up.'),
            lesson: z.string().describe('The design lesson to store, citing a gallery/<style>/NNN.png path if it came from a specific monster'),
        }),
    },
    async ({ style, lesson }) => {
        try {
            const notes = loadNotes();
            notes.push({ timestamp: new Date().toISOString(), style, lesson });
            saveNotes(notes);
            const forStyle = notes.filter(n => n.style === style).length;
            console.error(`[remember] +1 lesson under "${style}" (${forStyle} for this style, ${notes.length} total)`);
            return { content: [{ type: 'text', text: `Remembered lesson #${notes.length} under style "${style}" (${forStyle} for this style).` }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'recall',
    {
        description: 'Read back design lessons previously stored with remember. Call this before building a monster to apply past lessons. '
            + 'Pass a style to get only that style\'s lessons — the focused list is what you want while iterating on one build. '
            + 'Omit style to get everything across all styles, which is the right call when starting a new style or before '
            + 'consolidating with replace_notes.',
        inputSchema: z.object({
            style: z.string().optional().describe(
                'Only return lessons filed under this style. Omit to return every lesson from every style.'),
        }),
    },
    async ({ style }) => {
        const notes = loadNotes();
        const matching = style ? notes.filter(n => n.style === style) : notes;

        if (matching.length === 0) {
            const styles = knownStyles(notes);
            const text = style
                ? `No design lessons stored for style "${style}".`
                    + (styles.length ? ` Known styles: ${styles.join(', ')}.` : '')
                : 'No design lessons stored yet.';
            return { content: [{ type: 'text', text }] };
        }

        const header = style
            ? `${matching.length} lesson(s) for style "${style}":`
            : `${matching.length} lesson(s) across ${knownStyles(notes).length} style(s):`;
        return { content: [{ type: 'text', text: `${header}\n${matching.map(formatNote).join('\n')}` }] };
    }
);

server.registerTool(
    'replace_notes',
    {
        description: 'Overwrite every lesson filed under one style with a new, smaller set. This is the consolidation '
            + 'ritual: notes accumulate faster than they stay useful, so periodically recall a style, rewrite its lessons '
            + 'down to what still earns its place, and pass that shorter list here. Other styles are left untouched.\n'
            + 'When consolidating: merge duplicates and near-duplicates into one sharper statement; where two lessons '
            + 'contradict each other keep the LATER finding, since it was learned with more experience; preserve the '
            + 'gallery/<style>/NNN.png evidence paths from the lessons you keep, because a lesson without its screenshot '
            + 'can no longer be checked; and delete anything the current baseline has already absorbed — a lesson that '
            + 'only says what you now do automatically is noise competing for attention with the lessons that still bite.\n'
            + 'This is destructive and cannot be undone: the lessons you leave out are gone. Call recall for the style '
            + 'first and consolidate from what it actually returns, never from memory.',
        inputSchema: z.object({
            style: z.string().describe('The style whose lessons are being replaced. Only entries with this exact style are affected.'),
            lessons: z.array(z.string()).describe(
                'The complete consolidated set of lessons for this style. This REPLACES the existing set — '
                + 'anything omitted is deleted. An empty array erases every lesson for the style.'),
        }),
    },
    async ({ style, lessons }) => {
        try {
            const notes = loadNotes();
            const removed = notes.filter(n => n.style === style).length;
            const kept = notes.filter(n => n.style !== style);
            const timestamp = new Date().toISOString();
            const written = lessons.map(lesson => ({ timestamp, style, lesson }));
            saveNotes([...kept, ...written]);

            console.error(`[replace_notes] "${style}": ${removed} -> ${written.length} lesson(s); `
                + `${kept.length} entr(ies) under other styles untouched`);
            const note = written.length === 0
                ? ` Style "${style}" now has no lessons at all.`
                : '';
            return {
                content: [{
                    type: 'text',
                    text: `Consolidated style "${style}": replaced ${removed} lesson(s) with ${written.length}.${note} `
                        + `${kept.length} entr(ies) under other styles were left untouched.`,
                }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- Escape hatch ---
// Deliberately unvalidated. Everything above this point is a tool whose shape
// was decided ahead of time; this one forwards whatever it is given straight to
// the game, so a capability invented at runtime in scene.js's experimental
// registry is callable immediately, without a matching tool being registered
// here first. Registering one is promotion, and promotion is a separate step.
server.registerTool(
    'experimental_command',
    {
        description: 'Run a game command by name, with no schema validation on the parameters. '
            + 'This is the escape hatch for capabilities that live in the game\'s experimental '
            + 'registry rather than in a registered tool — call list_experimental_commands first '
            + 'to see what is currently registered, what each one does, and what params it takes. '
            + 'Also reaches built-in commands by name. The reply is whatever the game returns; an '
            + 'unrecognized command comes back as "Unknown command: <command>".',
        inputSchema: z.object({
            command: z.string().describe(
                'Command name to run, e.g. an entry from list_experimental_commands'),
            params: z.record(z.any()).optional().describe(
                'Arbitrary parameter object passed through to the command handler untouched. '
                + 'Defaults to {}. The handler decides what it accepts — there is no validation here.'),
        }),
    },
    async ({ command, params }) => {
        try {
            const reply = await sendToGame(command, params ?? {});
            console.error(`[experimental] ran ${command}`);
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'list_experimental_commands',
    {
        description: 'List the commands currently in the game\'s experimental registry, as JSON: '
            + 'each entry\'s name, description, and the params it accepts. These are callable through '
            + 'experimental_command. Call this before inventing a new capability — it may already exist.',
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const reply = await sendToGame('list_experimental_commands');
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);


// -- Start the server on stdio
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server running — waiting for connections.');
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});