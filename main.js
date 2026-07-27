// forceSetTimeOut drives the game loop with setTimeout instead of
// requestAnimationFrame. This is what keeps the MCP bridge answering while the
// tab is in the background: the bridge only replies from scene.js's update(),
// and browsers suspend requestAnimationFrame outright for a hidden page — which
// on Chrome includes a window fully covered by another window. An rAF-driven
// loop cannot be rescued from that by any amount of un-pausing, so the driver
// itself has to change. Background setTimeout is throttled to ~1Hz, comfortably
// inside the bridge's 5s timeout.
//
// The other half of this fix is in scene.js create(), which drops Phaser's own
// pause-on-hidden listener. Both are needed; either alone still freezes.
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#2d2d44',
    fps: { forceSetTimeOut: true },
    scene: [MonsterScene],
};

new Phaser.Game(config);