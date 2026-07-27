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
const STYLE_DOC = 'Optional styling params: tint (hex string like "#8833ff", recolors the part), '
    + 'scale (uniform size multiplier, default 1), scaleX/scaleY (stretch on one axis), '
    + 'angle (rotation in degrees), dx/dy (pixel nudge from the default attachment point; '
    + 'positive dx moves right, positive dy moves down).';
const MIRROR_DOC = ' Parts are placed as mirrored left/right pairs: dx is mirrored and angle is '
    + 'negated on the flipped side, so both sides stay symmetric.';

const styleFields = {
    tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex tint color like "#8833ff", multiplied over the sprite to recolor it'),
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

// --- Screenshot tool ---
// Next free gallery/monster_N.png path; also creates gallery/ if needed.
function nextGalleryPath() {
    const dir = path.join(process.cwd(), 'gallery');
    fs.mkdirSync(dir, { recursive: true });
    let n = 1;
    while (fs.existsSync(path.join(dir, `monster_${n}.png`))) n++;
    return path.join(dir, `monster_${n}.png`);
}

server.registerTool(
    'take_screenshot',
    {
        description: 'Take a screenshot of the current monster. Returns the image so you can see your work, and saves a copy to the gallery/ folder.',
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const reply = await sendToGame('take_screenshot');
            const b64 = reply.result;
            const file = nextGalleryPath();
            fs.writeFileSync(file, Buffer.from(b64, 'base64'));
            console.error(`[screenshot] saved ${file}`);
            return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
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

server.registerTool(
    'remember',
    {
        description: 'Save a design lesson to persistent notes (design_notes.json) so future sessions can build better monsters. '
            + 'A good lesson is specific and actionable: it names the parts, params, and values involved, and says when it applies. '
            + 'Good example: "On tall shape-E bodies the default mouth sits too high — pass dy: 25 to add_mouth to center it on the face." '
            + 'Bad example (too vague to act on later): "Positioning the parts carefully makes the monster look better."',
        inputSchema: z.object({
            lesson: z.string().describe('The design lesson to store'),
        }),
    },
    async ({ lesson }) => {
        try {
            const notes = loadNotes();
            notes.push({ timestamp: new Date().toISOString(), lesson });
            fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
            return { content: [{ type: 'text', text: `Remembered lesson #${notes.length}.` }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'recall',
    {
        description: 'Read back all design lessons previously stored with remember. Call this before building a monster to apply past lessons.',
        inputSchema: z.object({}),
    },
    async () => {
        const notes = loadNotes();
        const text = notes.length === 0
            ? 'No design lessons stored yet.'
            : notes.map(n => `[${n.timestamp}] ${n.lesson}`).join('\n');
        return { content: [{ type: 'text', text }] };
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