# AGENTS.md

## What this is

A project for a course assignment (CMPM 118). It runs an MCP server that lets an
LLM assemble a monster sprite (body/arms/legs/eyes/mouth/antennas) in a live
Phaser browser game, using art from Kenney's Monster Builder Pack (`assets/`),
look at its own work with `take_screenshot`, and carry lessons between sessions
with `remember`/`recall`.

The interesting part is that the agent is meant to *extend* the game while using
it. New capabilities are invented at runtime and live in an experimental
registry — see **Adding a new capability** below, which is the rule that matters
most in this repo.

## Architecture

```
MCP client ──(stdio)──> Phaser MCP server (Node, index.js)
                       │  also runs a WebSocket server on port 8081
                       ▲
                       │  (WebSocket — the browser connects OUTWARD to the server)
               Phaser game (browser, main.js/scene.js/parts.js via index.html)
```

- **`index.js`** — Node process. Registers MCP tools with `@modelcontextprotocol/sdk`
  (stdio transport) AND runs a `ws` `WebSocketServer` on port **8081**. Each tool
  handler calls `sendToGame(command, params)`, which sends a `{id, command, params}`
  JSON message over the socket and returns a Promise that resolves when the browser
  replies with a matching `id`. Requests **timeout after 5 seconds** if the game
  doesn't respond, and fail immediately with `'No game connected...'` if no browser
  tab has ever connected.
- **`index.html` / `main.js` / `scene.js` / `parts.js`** — Plain browser scripts
  (no bundler, loaded via `<script>` tags in this exact order: `parts.js` →
  `scene.js` → `main.js`). Loads Phaser 4 from a CDN. `MonsterScene` connects
  *out* to `ws://localhost:8081`, auto-reconnecting every 1s on close.
- **`assets/`** — Kenney Monster Builder Pack PNGs. Filenames encode
  color/shape/variant, e.g. `body_blueA.png`, `arm_redC.png`, `leg_darkE.png`,
  `mouthA.png`..`mouthJ.png`, `detail_{color}_antenna_{small|large}.png`,
  `eye_*.png`. `parts.js` documents the naming pattern per part type.
- **`gallery/<series>/NNN.png`** — screenshots plus an `NNN.json` sidecar with the
  monster state at that moment. **`design_notes.json`** — the `remember` store.

## Adding a new capability (the rule that matters)

**`scene.js` may be edited freely, but new capabilities go in the experimental
registry — never as new `switch` cases in `executeCommand`.** The registry is
`this.experimental`, initialized in `create()`. Add an entry keyed by command
name:

```js
this.experimental.add_spikes = {
    description: '...',   // honest, specific — see below
    params: '...',        // prose describing what it accepts
    handler: (params) => { /* mutate this.monster, return a result string */ },
};
```

`executeCommand`'s `default` case looks the command up in `this.experimental` and
calls its `handler(params)` (with `this` bound to the scene, so plain `function`
handlers work too). Nothing else needs wiring. The command is immediately
callable from the MCP side via `experimental_command`, and it advertises itself
through `list_experimental_commands`. A handler may return a string or a Promise
of one; throwing is safe — `update()` catches it and returns the error text.

**Every registry entry needs an honest, specific description.** The description
is the only thing a future session has to go on: it must say what the capability
really does, including what it does *not* do. Describe the observed behavior, not
the intent.

- **Good** — `'Draws N dark triangles along the top arc of the body, evenly
  spaced across a 120° span centered on the body top. Reads the body sprite's
  position and displayHeight only; does not scale with body tint, and looks
  wrong on shape F (the hair tufts overlap the spikes).'`
- **Bad** — `'Adds spikes to the monster to make it look more menacing.'` Vague
  (how many? where? what color?), it advertises an intent rather than a behavior,
  and it silently overclaims — the reader will assume it works on any body and
  any part, then waste an iteration finding out it doesn't.

**`index.js` is edited only during promotion** — that is, when a proven
experimental capability graduates into a real registered MCP tool with a `zod`
schema. Do not add tools there for anything still being tried out; that is what
the escape hatch is for.

**The bridge and queue plumbing in both files is off-limits.** Specifically: the
`WebSocketServer` setup, `sendToGame`, and the `pending` map in `index.js`; and
`connectToBridge`, `ws.onmessage`, `commandQueue`, and the `update()` drain loop
in `scene.js`. Breaking any of these takes down every tool at once, including the
screenshot that would have shown you what broke.

## Critical gotcha: command flow across two processes

- The Node side (`index.js`) and browser side (`scene.js`) are **separate
  processes** connected only by WebSocket messages. There is no shared memory.
- In `scene.js`, `ws.onmessage` **must never touch Phaser game objects
  directly** — it only pushes to `this.commandQueue`. Actual mutation happens
  in `update()`, which drains the queue and calls `executeCommand()` on
  Phaser's own tick. This avoids races with Phaser's render/update cycle.
  Experimental handlers already run inside `update()`, so they are on the right
  tick — but the same rule applies to anything async they schedule.
- Every command's result must be a string (success or error) — `update()` sends
  it back over the socket as `{id, result}`, which resolves the pending Promise
  in `index.js`. A handler that returns nothing produces an empty reply, which
  reads as a silent failure from the MCP side.

## Iteration discipline

- **One series name per style, identical to the memory style tag.** Pick the name
  when you start a style and use that same string in *every* `take_screenshot`
  call and *every* `remember` call for that style. That shared tag is what links
  the images in `gallery/<series>/` to the lessons in `design_notes.json` — if
  the two drift apart, a future session can see a monster but can't find out what
  was learned building it, or reads lessons it can't match to a picture.
- **Git commit before every iteration.** Commit the working state *before*
  editing `scene.js`, not after. Edits here are live-reloaded into a running
  game and a bad one can break the scene badly enough that no tool responds —
  committing first means any broken edit is one `git checkout` from recovery.

## Running / testing

- No test suite (`npm test` is a placeholder that exits 1 — don't try to fix
  this unless asked, it's intentionally unset for the assignment).
- To run: serve the project root over HTTP (e.g. `python -m http.server 8000`;
  the browser must load `index.html` over HTTP, not `file://`) AND separately run
  the MCP server (`node index.js`) so it's available to an MCP client via stdio.
  The WebSocket port (8081) is hardcoded in both `index.js` and `scene.js` —
  keep them in sync if changed.
- Verify manually: open the served `index.html`, confirm the on-screen status
  text turns "bridge connected" (green), then invoke MCP tools and watch the
  monster update in the browser.
- **The game tab must stay open and visible.** Phaser pauses its update loop in a
  hidden/backgrounded tab, so the queue stops draining and every tool call fails
  with "Game did not respond within 5 seconds." A closed tab can leave a stale
  socket on the Node side that fails the same way — reload the page to recover.
- After editing `scene.js`, reload the game tab before calling anything; the
  browser is running the old copy until you do.

## Conventions observed

- Texture key naming: `{part}_{color}{shape}` for body/arm/leg (e.g.
  `body_blueA`), `{part}{shape}` for mouth (e.g. `mouthA`), `detail_{color}_
  {detail}_{size}` for antenna/horn/ear details, `eye_{style}` for eyes, and
  `eye_{style}_{color}` for the two styles with a color axis (`angry`, `human`).
- All coordinates are absolute pixels on an 800x600 canvas (`CENTER_X=400`,
  `CENTER_Y=300` in `parts.js`); part offsets are relative to body center and
  explicitly called out in `parts.js` as approximate/tunable.
- Parts that can appear multiple times (eyes, arms, antennas) are stored on
  `this.monster.<part>` as arrays, so `clearMonster()`'s
  `Object.values(this.monster).flat()` destroys them. Experimental handlers that
  create sprites must store them on `this.monster` too, or they will survive
  `clear_monster` and pile up on the next build.
- Phaser tint is **multiplicative** (`effective = base * tint / 255`) — it can
  only darken a part, never repaint it. `describe_monster_colors` reports the
  effective color, luminance, and contrast against the body for every part.
- `console.error` (not `console.log`) is used for status/logging on **both**
  sides — on the Node side stdout is reserved for the MCP stdio protocol, and the
  browser side matches it for consistency.
