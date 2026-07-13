import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import * as z from 'zod';

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

// --- Register tools
server.registerTool(
    'create_body',
    {
        description: 'Create the monster body. Must be called before adding any other parts. Replaces any existing monster.',
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Body color, dark=brown'),
            shape: z.enum(['A', 'B', 'C', 'D', 'E', 'F']).describe('Body shape variant: A=square, B=round, C=oval, D=squat oval, E=long body, F=long body with hair tufts'),
        }),
    },
    async ({ color, shape }) => {
        try {
            const reply = await sendToGame('create_body', { color, shape });
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_eyes',
    {
        description: 'Add eyes to the monster. Must be called after create_body.',
        inputSchema: z.object({
            style: z.enum([
                'angry', 'human', 'blue', 'red', 'yellow', 'dead',
                'closed_feminine', 'closed_happy', 'cute_dark', 'cute_light',
                'psycho_dark', 'psycho_light',
            ]).describe('Eye style/expression. "angry" and "human" require a color.'),
            color: z.enum(['blue', 'green', 'red']).optional().describe('Eye color, only used for style "angry" or "human", default blue'),
            count: z.number().int().min(1).max(5).optional().describe('Number of eyes, default 2'),
        }),
    },
    async ({ style, color, count }) => {
        try {
            const reply = await sendToGame('add_eyes', { style, color, count });
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_arms',
    {
        description: 'Add arms to the monster (in left/right pairs). Must be called after create_body.',
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Arm color, dark=brown'),
            pose: z.enum(['A', 'B', 'C', 'D', 'E']).optional().describe('Arm pose variant, default A'),
            count: z.number().int().min(2).max(6).multipleOf(2).optional().describe('Number of arms (must be even), default 2'),
        }),
    },
    async ({ color, pose, count }) => {
        try {
            const reply = await sendToGame('add_arms', { color, pose, count });
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

server.registerTool(
    'add_antennas',
    {
        description: 'Add antennas to the top of the monster. Must be called after create_body.',
        inputSchema: z.object({
            color: z.enum(['blue', 'green', 'red', 'yellow', 'dark']).describe('Antenna color, dark=brown'),
            count: z.number().int().min(1).max(3).optional().describe('Number of antennas, default 1'),
            size: z.enum(['small', 'large']).optional().describe('Antenna size, default large'),
        }),
    },
    async ({ color, count, size }) => {
        try {
            const reply = await sendToGame('add_antennas', { color, count, size });
            return { content: [{ type: 'text', text: reply.result }] };
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    }
);

// --- TODO: define more tools here


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