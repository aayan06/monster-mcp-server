class MonsterScene extends Phaser.Scene {
    constructor() {
        super('MonsterScene');
        this.commandQueue = [];
        this.monster = {};
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
                this.ws.send(JSON.stringify({ id: msg.id, result }));
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
    }

    // Destroy an existing part so re-adding it replaces instead of stacking
    destroyPart(name) {
        const val = this.monster[name];
        if (!val) return;
        for (const obj of [].concat(val)) {
            if (obj && obj.destroy) obj.destroy();
        }
        delete this.monster[name];
    }

    executeCommand(command, params) {
        switch (command) {

            case 'clear_monster':
                this.clearMonster();
                return 'Monster cleared.';

            case 'create_body': {
                this.clearMonster();
                const key = `body_${params.color}${params.shape}`;
                this.monster.body = this.add.image(CENTER_X, CENTER_Y, key);
                return `Created a ${params.color} type-${params.shape} body.`;
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
                    arms.push(this.add.image(CENTER_X + off.x, y, key));
                    arms.push(this.add.image(CENTER_X - off.x, y, key).setFlipX(true));
                }
                this.monster.arms = arms;
                return `Added ${arms.length} ${color} arms (pose ${pose}).`;
            }

            case 'add_legs': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('legs');
                const color = params.color || 'blue';
                const shape = params.shape || 'A';
                const key = `leg_${color}${shape}`;
                const off = PARTS.leg.offset;
                const rightLeg = this.add.image(CENTER_X + off.x, CENTER_Y + off.y, key);
                const leftLeg  = this.add.image(CENTER_X - off.x, CENTER_Y + off.y, key).setFlipX(true);
                this.monster.legs = [leftLeg, rightLeg];
                return `Added ${color} legs (shape ${shape}).`;
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
                    eyes.push(this.add.image(CENTER_X, CENTER_Y + off.y, key));
                } else {
                    const startX = CENTER_X - (spacing * (count - 1)) / 2;
                    for (let i = 0; i < count; i++) {
                        eyes.push(this.add.image(startX + i * spacing, CENTER_Y + off.y, key));
                    }
                }
                this.monster.eyes = eyes;
                return `Added ${count} ${style} eye(s).`;
            }

            case 'add_mouth': {
                if (!this.monster.body) return 'Error: no body exists yet. Call create_body first.';
                this.destroyPart('mouth');
                const style = params.style || 'A';
                const key = `mouth${style.toUpperCase()}`;
                const off = PARTS.mouth.offset;
                this.monster.mouth = this.add.image(CENTER_X + off.x, CENTER_Y + off.y, key);
                return `Added mouth style ${style}.`;
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
                    antennas.push(this.add.image(startX + i * spacing, CENTER_Y + off.y, key));
                }
                this.monster.antennas = antennas;
                return `Added ${count} ${color} ${size} antenna(s).`;
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

            default:
                return `Unknown command: ${command}`;
        }
    }
}