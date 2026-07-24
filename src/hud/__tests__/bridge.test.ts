import { EventEmitter } from 'eventemitter3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initBridge } from '../bridge';
import type { EventBus, Registry } from '../bridge';
import { useHudStore } from '../store';

/**
 * Node-pure bridge tests (plan 046 Step 3). No Phaser, no DOM: a plain eventemitter3 stands in for
 * `game.events`, and a Map-backed mock for `game.registry` (a DataManager fires `setdata` on the
 * first set of a key and `changedata-<key>` on later sets — the mock reproduces both). Covers
 * event→store mapping, the `emit` passthrough, inventory rebind, and death→restart re-sync.
 */

/** A stand-in for Phaser's `DataManager`: `get` + an `events` emitter firing setdata/changedata. */
class MockRegistry implements Registry {
  readonly events = new EventEmitter() as unknown as EventBus;
  private readonly store = new Map<string, unknown>();
  private readonly emitter = this.events as unknown as EventEmitter;

  get(key: string): unknown {
    return this.store.get(key);
  }

  /** Mirror DataManager.set: `setdata (parent,key,value)` first time, else `changedata-<key>`. */
  set(key: string, value: unknown): void {
    const existed = this.store.has(key);
    this.store.set(key, value);
    if (existed) this.emitter.emit(`changedata-${key}`, this, value);
    else this.emitter.emit('setdata', this, key, value);
  }
}

/** Minimal `Inventory` stand-in: emits `'change'` with a snapshot the bridge forwards to the store. */
class MockInventory extends EventEmitter {
  constructor(private snap: Record<string, number>) {
    super();
  }
  snapshot(): Record<string, number> {
    return this.snap;
  }
  setSnapshot(next: Record<string, number>): void {
    this.snap = next;
    this.emit('change', next);
  }
}

const DEFAULTS = { ...useHudStore.getState() };
const s = () => useHudStore.getState();

let bus: EventEmitter;
let registry: MockRegistry;

beforeEach(() => {
  // Reset the persistent module-level store between tests (isolate:false shares module state).
  useHudStore.setState(DEFAULTS, true);
  bus = new EventEmitter();
  registry = new MockRegistry();
});

const init = () => initBridge(bus as unknown as EventBus, registry);

describe('outbound event → store mapping', () => {
  it('maps every outbound world→HUD event onto the store', () => {
    const bridge = init();

    bus.emit('player:hpChanged', { hp: 7, maxHp: 10 });
    expect(s().hp).toBe(7);
    expect(s().maxHp).toBe(10);

    const before = s().hitNonce;
    bus.emit('player:hit');
    expect(s().hitNonce).toBe(before + 1);

    bus.emit('hunger:changed', { hunger: 42, max: 100 });
    expect(s().hunger).toBe(42);
    expect(s().maxHunger).toBe(100);

    // `needs:fed` bumps the feed-pulse nonce + records the gain (drives the hunger meter's "+N" cue).
    const fedBefore = s().fedNonce;
    bus.emit('needs:fed', { amount: 25 });
    expect(s().fedNonce).toBe(fedBefore + 1);
    expect(s().fedAmount).toBe(25);

    // A `cooldownMs` on the eat starts the hotbar's cooldown sweep (active + duration + nonce bump).
    const cdBefore = s().eatCooldownNonce;
    bus.emit('needs:fed', { amount: 10, cooldownMs: 5000 });
    expect(s().eatCooldownActive).toBe(true);
    expect(s().eatCooldownMs).toBe(5000);
    expect(s().eatCooldownNonce).toBe(cdBefore + 1);

    bus.emit('fire:changed', { fuel: 30, maxFuel: 60, lit: true });
    expect(s().fire).toEqual({ fuel: 30, maxFuel: 60, lit: true });
    bus.emit('fire:changed', null);
    expect(s().fire).toBeNull();

    bus.emit('supply:changed', { wood: 5, rock: 3 });
    expect(s().supply).toEqual({ wood: 5, rock: 3 });

    bus.emit('time:changed', { phase: 'night', dayCount: 2, cycleMs: 1, tNorm: 0.5 });
    expect(s().dayPhase).toBe('night');
    expect(s().dayCount).toBe(2);
    expect(s().time).toBe(0.5);
    expect(s().waveInfo.active).toBe(true); // wave banner keys off the night phase

    bus.emit('time:changed', { phase: 'day', dayCount: 3, cycleMs: 1, tNorm: 0.1 });
    expect(s().waveInfo.active).toBe(false);

    // `time:progress` moves only the cycle position (the dial's continuous sweep) — phase/day/wave,
    // owned by the sparse `time:changed`, must be left untouched.
    bus.emit('time:progress', { tNorm: 0.42 });
    expect(s().time).toBe(0.42);
    expect(s().dayPhase).toBe('day'); // unchanged from the last time:changed
    expect(s().dayCount).toBe(3);
    expect(s().waveInfo.active).toBe(false);

    bus.emit('tasks:changed', { current: 'harvest', pending: 2 });
    expect(s().tasks).toEqual({ current: 'harvest', pending: 2 });

    bus.emit('mode:changed', 'combat');
    expect(s().mode).toBe('combat');

    bus.emit('build:modeChanged', true);
    expect(s().buildMode).toBe(true);

    bus.emit('build:select', { id: 'wall' });
    expect(s().selection).toBe('wall');
    expect(s().orientable).toBe(true); // wall is orientable in BUILDABLES

    bus.emit('build:select', { id: 'campfire' });
    expect(s().orientable).toBe(false); // campfire is not

    bus.emit('demolish:modeChanged', true);
    expect(s().demolishMode).toBe(true);

    bus.emit('combat:activeChanged', true);
    expect(s().combatActive).toBe(true);

    const stats = { name: 'Skeleton', maxHp: 5, currentHp: 3 };
    bus.emit('inspect:show', stats);
    expect(s().inspectTarget).toEqual(stats);
    bus.emit('inspect:hide');
    expect(s().inspectTarget).toBeNull();

    bus.emit('zoom:changed', 1.5);
    expect(s().zoom).toBe(1.5);

    bus.emit('camera:followChanged', false);
    expect(s().following).toBe(false);

    // A workbench tap opens the craft menu with the bench's id + live hp (plan 048 Step 7).
    bus.emit('craft:menuOpen', { benchId: 'workbench-0', hp: 40, maxHp: 60 });
    expect(s().craftMenu).toEqual({ open: true, benchId: 'workbench-0', hp: 40, maxHp: 60 });

    bridge.dispose(); // clears the pending eat-cooldown timer scheduled by the needs:fed emit above
  });
});

describe('playerStats registry binding', () => {
  it('reads playerStats already on the registry at init', () => {
    const stats = { maxHp: 20, armour: 2, speed: 60, strength: 3, dex: 1, dodge: 5 };
    registry.set('playerStats', stats);
    init();
    expect(s().playerStats).toEqual(stats);
  });

  it('re-reads playerStats when the registry re-sets it (restart)', () => {
    registry.set('playerStats', { maxHp: 20, armour: 2, speed: 60, strength: 3, dex: 1, dodge: 5 });
    init();
    const next = { maxHp: 25, armour: 4, speed: 55, strength: 5, dex: 2, dodge: 8 };
    registry.set('playerStats', next);
    expect(s().playerStats).toEqual(next);
  });
});

describe('inventory registry binding', () => {
  it('snapshots an inventory already on the registry at init', () => {
    registry.set('inventory', new MockInventory({ wood: 4 }));
    init();
    expect(s().inventory).toEqual({ wood: 4 });
  });

  it("follows the bound inventory's change events", () => {
    const inv = new MockInventory({ wood: 1 });
    registry.set('inventory', inv);
    init();
    inv.setSnapshot({ wood: 1, stone: 2 });
    expect(s().inventory).toEqual({ wood: 1, stone: 2 });
  });
});

describe('emit passthrough', () => {
  it('forwards inbound events (with and without payload) onto the bus', () => {
    const bridge = init();
    const withPayload = vi.fn();
    const noPayload = vi.fn();
    bus.on('build:select', withPayload);
    bus.on('combat:attack', noPayload);

    bridge.emit({ type: 'build:select', payload: { id: 'wall' } });
    expect(withPayload).toHaveBeenCalledWith({ id: 'wall' });

    bridge.emit({ type: 'combat:attack' });
    expect(noPayload).toHaveBeenCalledTimes(1);
    expect(noPayload).toHaveBeenCalledWith(); // no trailing payload arg
  });
});

describe('death → restart re-sync', () => {
  it('rebinds to the fresh inventory and stops following the dead one', () => {
    const invA = new MockInventory({ wood: 1 });
    registry.set('inventory', invA);
    init();
    expect(s().inventory).toEqual({ wood: 1 });

    // Restart: GameScene builds a NEW Inventory and sets it on the registry (fires changedata).
    const invB = new MockInventory({ stone: 9 });
    registry.set('inventory', invB);
    expect(s().inventory).toEqual({ stone: 9 }); // re-snapshotted to the new instance

    // The dead instance must no longer drive the store; the live one must.
    invA.setSnapshot({ wood: 999 });
    expect(s().inventory).toEqual({ stone: 9 });
    invB.setSnapshot({ stone: 9, wood: 2 });
    expect(s().inventory).toEqual({ stone: 9, wood: 2 });
  });

  it('persists store state across a simulated SHUTDOWN→START and re-syncs from re-emitted values', () => {
    init();
    // Live values before the "death".
    bus.emit('supply:changed', { wood: 8, rock: 8 });
    bus.emit('mode:changed', 'combat');
    expect(s().supply).toEqual({ wood: 8, rock: 8 });

    // SHUTDOWN: the bridge does nothing (no teardown) — game.events + registry outlive the scene, so
    // the store must simply persist. Nothing to call; just assert it survived.
    expect(s().mode).toBe('combat');

    // START: GameScene re-emits current values (~GameScene.ts 783-793). The still-wired bridge maps
    // them straight through — no re-init needed.
    bus.emit('mode:changed', 'command');
    bus.emit('combat:activeChanged', false);
    bus.emit('demolish:modeChanged', false);
    bus.emit('supply:changed', { wood: 0, rock: 0 });
    expect(s().mode).toBe('command');
    expect(s().combatActive).toBe(false);
    expect(s().supply).toEqual({ wood: 0, rock: 0 });
  });
});

describe('dispose', () => {
  it('unsubscribes bus + inventory listeners so nothing updates the store afterwards', () => {
    const inv = new MockInventory({ wood: 1 });
    registry.set('inventory', inv);
    const bridge = init();

    bridge.dispose();

    bus.emit('player:hpChanged', { hp: 1, maxHp: 10 });
    expect(s().hp).toBe(DEFAULTS.hp); // untouched
    inv.setSnapshot({ wood: 5 });
    expect(s().inventory).toEqual({ wood: 1 }); // still the pre-dispose snapshot, not the new one

    // A second dispose is a harmless no-op.
    expect(() => bridge.dispose()).not.toThrow();
  });
});
