// The computer's mode guard with fake programs (nothing real is closed). Run: node tests/modes.guard.test.js
const assert = require('assert');
const E = require('../shared/engine.js');
const { Guard, PRESET } = require('../desktop/modes.js');

const MAC = process.platform === 'darwin';
const GAME = MAC ? 'com.game' : 'game.exe', STEAM = MAC ? 'com.valvesoftware.steam' : 'steam.exe', CODE = MAC ? 'com.microsoft.VSCode' : 'code.exe', OPERA = PRESET.apps[0];
let t = new Date(2026, 10, 16, 9, 0).getTime();
const state = E.emptyState();
Object.assign(state.modes, E.opPut('modes', { id: 'draw', name: 'Drawing', list: 'black', dev: { mac1: { apps: [STEAM, CODE, GAME] } } }, 'A', t).modes);
Object.assign(state.events, E.opPut('events', { id: 'ev', title: 'Draw', start: t + 60000, end: t + 3600000, mode: 'draw' }, 'A', t).events);

let open = [{ id: STEAM, name: 'Steam', pid: 101 }, { id: CODE, name: 'Code', pid: 102 }, { id: OPERA, name: 'Opera', pid: 103 }, { id: GAME, name: 'Game', pid: 104 }];
const log = [], shown = { ask: null, blocked: [] }, local = { frozen: {} };
const g = Guard({
  Engine: E, getState: () => state, local, saveLocal() {}, deviceId: 'mac1',
  ui: { blocked: (n, m, forced) => shown.blocked.push(n + (forced ? '!' : '')), ask: (l) => { shown.ask = l.map((x) => x.name + ':' + x.waits); }, hideAsk: () => { shown.ask = null; }, cover() {} },
  sys: { listOpen: async () => open.slice(), closeGently: (p) => { log.push('gentle ' + p); open = open.filter((x) => x.pid !== p); }, closeHard: (p) => { log.push('hard ' + p); open = open.filter((x) => x.pid !== p); }, freeze: (p, on) => log.push((on ? 'freeze ' : 'thaw ') + p), now: () => t }
});

(async () => {
  let pass = 0; const ok = () => pass++;
  try {
    await g.tick(); assert.strictEqual(shown.ask, null); assert.deepStrictEqual(log, []); ok();          // no mode yet
    t += 120000; await g.tick();
    assert.deepStrictEqual(shown.ask, ['Steam:0', 'Code:0', 'Game:0'], 'open blocked programs are asked, the browser is not'); ok();
    g.action('freeze', CODE); assert.deepStrictEqual(log, ['freeze 102']); assert.deepStrictEqual(shown.ask, ['Steam:0', 'Game:0']); ok();
    g.action('close', GAME); assert.ok(log.includes('gentle 104')); assert.deepStrictEqual(shown.ask, ['Steam:0']); ok();
    g.action('wait', STEAM); assert.strictEqual(shown.ask, null); ok();
    t += 121000; await g.tick(); assert.deepStrictEqual(shown.ask, ['Steam:1'], 'asked again after 2 minutes'); ok();
    g.action('wait', STEAM); t += 121000; await g.tick(); assert.deepStrictEqual(shown.ask, ['Steam:2']); ok();
    g.action('wait', STEAM); t += 121000; await g.tick();
    assert.ok(log.includes('hard 101') && shown.blocked.includes('Steam!') && shown.ask === null, 'after the 3rd wait it is closed'); ok();
    assert.strictEqual(log.filter((x) => x === 'hard 101').length, 1, 'closed once'); ok();
    open.push({ id: STEAM, name: 'Steam', pid: 201 }); await g.tick();
    assert.ok(log.includes('hard 201') && shown.blocked.includes('Steam'), 'opening it again during the mode: closed at once'); ok();
    t = new Date(2026, 10, 16, 10, 2).getTime(); await g.tick();
    assert.ok(log.includes('thaw 102'), 'the mode ended: frozen programs come back'); assert.deepStrictEqual(local.frozen, {}); ok();
    console.log(pass + ' guard checks passed');
  } catch (e) { console.error('FAIL', e.message, log, shown); process.exitCode = 1; }
})();
