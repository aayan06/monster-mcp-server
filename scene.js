class MonsterScene extends Phaser.Scene {
    constructor() {
        super('MonsterScene');
        this.commandQueue = [];
        this.monster = {};
        this.partColors = {};   // part name -> { base: {name, hex}, tint }
        this.ws = null;
        this.connected = false;
    }

    preload() {
        // Load body variants
        for (const color of PARTS.body.colors) {
            for (const shape of PARTS.body.shapes) {
                const key = `body_${color}${shape}`;
                this.load.image(key, `assets/${key}.png`);
            }
        }
        // Load arm variants
        for (const color of PARTS.arm.colors) {
            for (const shape of PARTS.arm.shapes) {
                const key = `arm_${color}${shape}`;
                this.load.image(key, `assets/${key}.png`);
            }
        }
        // Load legs
        const legColors = ['blue', 'green', 'red', 'yellow', 'dark'];
        const legShapes = ['A', 'B', 'C'];
        for (const color of legColors) {
            for (const shape of legShapes) {
                const key = `leg_${color}${shape}`;
                this.load.image(key, `assets/${key}.png`);
            }
        }
        // Load eyes
        const eyeColorStyles = ['angry', 'human'];
        const eyeColors = ['blue', 'green', 'red'];
        for (const style of eyeColorStyles) {
            for (const color of eyeColors) {
                this.load.image(`eye_${style}_${color}`, `assets/eye_${style}_${color}.png`);
            }
        }
        const eyePlainStyles = [
            'blue', 'red', 'yellow', 'dead',
            'closed_feminine', 'closed_happy', 'cute_dark', 'cute_light',
            'psycho_dark', 'psycho_light',
        ];
        for (const style of eyePlainStyles) {
            this.load.image(`eye_${style}`, `assets/eye_${style}.png`);
        }
        // Load mouths
        for (const shape of ['A','B','C','D','E','F','G','H','I','J']) {
            this.load.image(`mouth${shape}`, `assets/mouth${shape}.png`);
        }
        // Load antennas
        for (const color of PARTS.body.colors) {
            for (const size of ['small', 'large']) {
                const key = `detail_${color}_antenna_${size}`;
                this.load.image(key, `assets/${key}.png`);
            }
        }
    }

    create() {
        this.statusText = this.add.text(10, 10, 'waiting for bridge connection...',
            { color: '#888', fontSize: '14px' });

        // Experimental capability registry. New capabilities are added here —
        // NOT as new cases in executeCommand. Each entry is keyed by command
        // name and holds three fields:
        //   description — honest, specific prose about what it actually does
        //   params      — prose describing the params it accepts
        //   handler     — (params) => string, the result sent back over the
        //                 bridge (may return a Promise of one)
        // Entries are reachable from the MCP side via experimental_command,
        // and list themselves via list_experimental_commands.
        this.experimental = {};

        // Arms with a caller-controlled gap between stacked pairs. The built-in
        // add_arms hardcodes pairSpacing = 45, which is narrower than a pose-C
        // arm at scale 0.7 (~105px), so count 4 always collapses into one clump
        // per side — the limit recorded in abyssal-lantern lesson #19. This
        // exists to test whether genuinely spaced four-arm layouts read better.
        // add_arms itself is left untouched.
        this.experimental.add_arms_spaced = {
            description: 'Arms in mirrored left/right pairs, like add_arms, but with a caller-controlled '
                + 'vertical gap between stacked pairs instead of the hardcoded 45px. Replaces any existing '
                + 'arms rather than stacking on them, and stores its sprites on this.monster.arms so '
                + 'clear_monster and create_body still destroy them. Identical to add_arms in every other '
                + 'respect, and does not modify add_arms. Only the vertical gap is configurable — the '
                + 'horizontal offset is still PARTS.arm.offset.x, so every pair sits at the same width.',
            params: 'color (blue|green|red|yellow|dark, default blue), pose (A-E, default A), '
                + 'count (number of arms, rounded up to a whole number of pairs, default 4), '
                + 'spacing (pixels between stacked pairs, default 100), plus the usual styling params '
                + 'tint/scale/scaleX/scaleY/angle/dx/dy, which behave exactly as in add_arms — dx is '
                + 'mirrored and angle negated on the flipped side of each pair.',
            handler: function (params) {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('arms');
                const color = params.color || 'blue';
                const pose = params.pose || 'A';
                const count = params.count || 4;
                const spacing = params.spacing !== undefined ? params.spacing : 100;
                const key = `arm_${color}${pose}`;
                const off = PARTS.arm.offset;
                const pairs = Math.ceil(count / 2);
                const arms = [];
                const startY = CENTER_Y + off.y - (spacing * (pairs - 1)) / 2;
                for (let i = 0; i < pairs; i++) {
                    const y = startY + i * spacing;
                    arms.push(this.applyStyle(this.add.image(CENTER_X + off.x, y, key), params));
                    arms.push(this.applyStyle(this.add.image(CENTER_X - off.x, y, key).setFlipX(true), params, true));
                }
                this.monster.arms = arms;
                const note = this.recordColors('arms', 'arms', params);
                return `Added ${arms.length} ${color} arms (pose ${pose}) at ${spacing}px pair spacing${note}.`;
            },
        };

        // Keep the game loop running when this tab is hidden or fully covered.
        // Phaser's Game.onHidden calls loop.pause() on the visibility event,
        // which stops update() draining commandQueue and makes every MCP call
        // fail with "Game did not respond within 5 seconds". Phaser 4 registers
        // exactly one 'hidden' listener, so clearing the event is safe.
        //
        // This lives here rather than in main.js on purpose: Game.start()
        // registers the listener AFTER both postBoot and the READY event, so
        // removing it from main.js would run too early and silently do nothing.
        // A scene's create() is the first point that is reliably after start().
        // See main.js for the other half — the loop must also be driven by
        // setTimeout, since browsers suspend requestAnimationFrame when hidden.
        this.game.events.off('hidden');

        this.connectToBridge();
    }

    connectToBridge() {
        this.ws = new WebSocket('ws://localhost:8081');
        this.ws.onopen = () => {
            this.connected = true;
            this.statusText.setText('bridge connected');
            this.statusText.setColor('#6f6');
        };
        this.ws.onmessage = (event) => {
            this.commandQueue.push(JSON.parse(event.data));
        };
        this.ws.onclose = () => {
            this.connected = false;
            this.statusText.setText('bridge disconnected — retrying...');
            this.statusText.setColor('#f66');
            setTimeout(() => this.connectToBridge(), 1000);
        };
        this.ws.onerror = () => {};
    }

    update() {
        while (this.commandQueue.length > 0) {
            const msg = this.commandQueue.shift();
            let result;
            try {
                result = this.executeCommand(msg.command, msg.params);
            } catch (err) {
                result = `Error executing ${msg.command}: ${err.message}`;
            }
            try {
                if (result instanceof Promise) {
                    result.then(res => this.ws.send(JSON.stringify({ id: msg.id, result: res })));
                } else {
                    this.ws.send(JSON.stringify({ id: msg.id, result }));
                }
            } catch (err) {
                console.error('Failed to send reply over bridge:', err);
            }
        }
    }

    clearMonster() {
        for (const part of Object.values(this.monster).flat()) {
            if (part && part.destroy) part.destroy();
        }
        this.monster = {};
        this.partColors = {};
    }

    // Destroy an existing part so re-adding it replaces instead of stacking
    destroyPart(name) {
        delete this.partColors[name];
        const val = this.monster[name];
        if (!val) return;
        for (const obj of [].concat(val)) {
            if (obj && obj.destroy) obj.destroy();
        }
        delete this.monster[name];
    }

    // Record the base/tint colors a part was placed with, and hand back the
    // reply-text fragment describing the tint's real (multiplicative) result.
    recordColors(partName, partType, params) {
        const base = basePartColor(partType, params);
        this.partColors[partName] = { base, tint: params.tint || null };
        return tintNote(base, params.tint);
    }

    // Apply the optional styling params (tint, scale, scaleX, scaleY, angle,
    // dx, dy) to a placed part. mirrored=true marks the flipped side of a
    // left/right pair: dx is mirrored and angle negated so the pair stays
    // symmetric.
    applyStyle(img, params, mirrored = false) {
        const m = mirrored ? -1 : 1;
        if (params.tint !== undefined) img.setTint(parseInt(params.tint.slice(1), 16));
        if (params.scale !== undefined) img.setScale(params.scale);
        if (params.scaleX !== undefined) img.scaleX = params.scaleX;
        if (params.scaleY !== undefined) img.scaleY = params.scaleY;
        if (params.angle !== undefined) img.setAngle(params.angle * m);
        if (params.dx !== undefined) img.x += params.dx * m;
        if (params.dy !== undefined) img.y += params.dy;
        return img;
    }

    executeCommand(command, params) {
        switch (command) {

            case 'clear_monster':
                this.clearMonster();
                return 'Monster cleared.';

            case 'create_body': {
                this.clearMonster();
                const key = `body_${params.color}${params.shape}`;
                this.monster.body = this.applyStyle(this.add.image(CENTER_X, CENTER_Y, key), params);
                const note = this.recordColors('body', 'body', params);
                return `Created a ${params.color} type-${params.shape} body${note}.`;
            }

            case 'add_arms': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('arms');
                const color = params.color || 'blue';
                const pose = params.pose || 'A';
                const count = params.count || 2;
                const key = `arm_${color}${pose}`;
                const off = PARTS.arm.offset;
                const pairs = Math.ceil(count / 2);
                const pairSpacing = 45; // vertical gap between stacked arm pairs
                const arms = [];
                const startY = CENTER_Y + off.y - (pairSpacing * (pairs - 1)) / 2;
                for (let i = 0; i < pairs; i++) {
                    const y = startY + i * pairSpacing;
                    arms.push(this.applyStyle(this.add.image(CENTER_X + off.x, y, key), params));
                    arms.push(this.applyStyle(this.add.image(CENTER_X - off.x, y, key).setFlipX(true), params, true));
                }
                this.monster.arms = arms;
                const note = this.recordColors('arms', 'arms', params);
                return `Added ${arms.length} ${color} arms (pose ${pose})${note}.`;
            }

            case 'add_legs': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('legs');
                const color = params.color || 'blue';
                const shape = params.shape || 'A';
                const key = `leg_${color}${shape}`;
                const off = PARTS.leg.offset;
                const rightLeg = this.applyStyle(this.add.image(CENTER_X + off.x, CENTER_Y + off.y, key), params);
                const leftLeg  = this.applyStyle(this.add.image(CENTER_X - off.x, CENTER_Y + off.y, key).setFlipX(true), params, true);
                this.monster.legs = [leftLeg, rightLeg];
                const note = this.recordColors('legs', 'legs', params);
                return `Added ${color} legs (shape ${shape})${note}.`;
            }

            case 'add_eyes': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('eyes');
                const style = params.style || 'blue';
                const count = params.count || 2;
                const colorStyles = ['angry', 'human'];
                const key = colorStyles.includes(style)
                    ? `eye_${style}_${params.color || 'blue'}`
                    : `eye_${style}`;
                const off = PARTS.eye.offset;
                const spacing = PARTS.eye.spacing;
                const eyes = [];
                if (count === 1) {
                    eyes.push(this.applyStyle(this.add.image(CENTER_X, CENTER_Y + off.y, key), params));
                } else {
                    const startX = CENTER_X - (spacing * (count - 1)) / 2;
                    for (let i = 0; i < count; i++) {
                        eyes.push(this.applyStyle(this.add.image(startX + i * spacing, CENTER_Y + off.y, key), params));
                    }
                }
                this.monster.eyes = eyes;
                const note = this.recordColors('eyes', 'eyes', params);
                return `Added ${count} ${style} eye(s)${note}.`;
            }

            case 'add_mouth': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('mouth');
                const style = params.style || 'A';
                const key = `mouth${style.toUpperCase()}`;
                const off = PARTS.mouth.offset;
                this.monster.mouth = this.applyStyle(this.add.image(CENTER_X + off.x, CENTER_Y + off.y, key), params);
                const note = this.recordColors('mouth', 'mouth', params);
                return `Added mouth style ${style}${note}.`;
            }

            case 'add_antennas': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('antennas');
                const color = params.color || 'blue';
                const count = params.count || 1;
                const size = params.size || 'large';
                const key = `detail_${color}_antenna_${size}`;
                const off = PARTS.antenna.offset;
                const spacing = PARTS.antenna.spacing;
                const antennas = [];
                const startX = CENTER_X - (spacing * (count - 1)) / 2;
                for (let i = 0; i < count; i++) {
                    antennas.push(this.applyStyle(this.add.image(startX + i * spacing, CENTER_Y + off.y, key), params));
                }
                this.monster.antennas = antennas;
                const note = this.recordColors('antennas', 'antennas', params);
                return `Added ${count} ${color} ${size} antenna(s)${note}.`;
            }

            case 'take_screenshot': {
                return new Promise((resolve) => {
                    this.game.renderer.snapshot((image) => {
                        resolve(image.src.split(',')[1]);
                    });
                });
            }

            case 'describe_monster_colors': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                const bodyInfo = this.partColors.body;
                const bodyEff = bodyInfo && bodyInfo.base.hex
                    ? effectiveColor(bodyInfo.base.hex, bodyInfo.tint)
                    : null;
                const bodyLum = bodyEff === null ? null : luminance(bodyEff);

                const lines = [];
                for (const part of Object.keys(this.monster)) {
                    const info = this.partColors[part];
                    if (!info) {
                        lines.push(`${part}: color unknown (placed before color tracking).`);
                        continue;
                    }
                    const tintText = info.tint ? `tint ${info.tint}` : 'no tint';
                    if (!info.base.hex) {
                        lines.push(`${part}: base ${info.base.name} (hex unknown), ${tintText}, effective color not computable.`);
                        continue;
                    }
                    const eff = effectiveColor(info.base.hex, info.tint);
                    const lum = luminance(eff);
                    let line = `${part}: base ${info.base.name} ${info.base.hex}, ${tintText}, `
                        + `effective ${eff}, luminance ${lum}`;
                    if (part === 'body') {
                        line += ' (body reference)';
                    } else if (bodyLum !== null) {
                        line += `, contrast vs body ${Math.abs(lum - bodyLum)}`;
                    }
                    lines.push(line + '.');
                }
                return 'Phaser tint is multiplicative — effective = base * tint / 255, so tints only darken.\n'
                    + 'Luminance = 0.2126*R + 0.7152*G + 0.0722*B (0=black, 255=white); '
                    + 'contrast is the luminance gap from the body.\n'
                    + lines.join('\n');
            }

            case 'get_monster_state': {
                const state = {};
                for (const [part, val] of Object.entries(this.monster)) {
                    if (Array.isArray(val)) {
                        state[part] = `${val.length} piece(s)`;
                    } else if (val) {
                        state[part] = 'present';
                    }
                }
                return JSON.stringify(state);
            }

            case 'build_monster': {
                this.clearMonster();
                const results = [];
                if (params.body) {
                    results.push(this.executeCommand('create_body', params.body));
                }
                if (params.arms) {
                    results.push(this.executeCommand('add_arms', params.arms));
                }
                if (params.legs) {
                    results.push(this.executeCommand('add_legs', params.legs));
                }
                if (params.eyes) {
                    results.push(this.executeCommand('add_eyes', params.eyes));
                }
                if (params.mouth) {
                    results.push(this.executeCommand('add_mouth', params.mouth));
                }
                if (params.antennas) {
                    results.push(this.executeCommand('add_antennas', params.antennas));
                }
                return `Built monster: ${results.join(' ')}`;
            }

            case 'list_experimental_commands': {
                const list = Object.entries(this.experimental).map(([name, entry]) => ({
                    name,
                    description: entry.description,
                    params: entry.params,
                }));
                return JSON.stringify(list, null, 2);
            }

            // Anything not handled above falls through to the experimental
            // registry, so a capability added to this.experimental is callable
            // without touching this switch.
            default: {
                const entry = this.experimental[command];
                if (entry && typeof entry.handler === 'function') {
                    console.error(`[experimental] ${command}`);
                    return entry.handler.call(this, params || {});
                }
                return `Unknown command: ${command}`;
            }
        }
    }
}