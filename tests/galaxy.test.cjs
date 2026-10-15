const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "..", "main.js"), "utf8");

async function renderGalaxy({ idleMs = 0, light = false, reducedMotion = false, beforeCalm, frameBeforeClick = false } = {}) {
  let now = 0;
  let seed = 1;
  let frames = [];
  let painted = [];
  const timers = [];
  const listeners = new Map();
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, {
    get(target, key) {
      if (key === "createRadialGradient") return () => gradient;
      if (key === "fillRect") return (...args) => painted.push(args);
      return target[key] ?? (() => {});
    },
  });
  const element = (id) => ({
    classList: { add() {}, remove() {} },
    style: { setProperty() {} },
    getBoundingClientRect: () => ({ width: 1280, height: 800 }),
    getContext: () => context,
    addEventListener: (type, fn) => listeners.set(`${id}:${type}`, fn),
    remove() {},
  });
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const math = Object.create(Math);
  math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  runInNewContext(source, {
    Math: math,
    performance: { now: () => now },
    history: {},
    window: {
      devicePixelRatio: 1,
      matchMedia: (query) => ({
        matches: query.includes("reduced-motion") ? reducedMotion : light,
        addEventListener: (type, fn) => listeners.set(`window:${type}`, fn),
      }),
      addEventListener: (type, fn) => listeners.set(`window:${type}`, fn),
      scrollTo() {},
    },
    document: {
      readyState: "complete",
      getElementById: getElement,
      querySelectorAll: () => [],
      addEventListener: (type, fn) => listeners.set(`document:${type}`, fn),
    },
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: (fn, ms) => timers.push({ fn, due: now + ms }),
  });
  async function tick(ms) {
    now = ms;
    const due = timers.filter((timer) => timer.due <= now);
    for (const timer of due) {
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
    // Let the boot sequence resume after its awaited timers and promises.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    painted = [];
    const pending = frames;
    frames = [];
    pending.forEach((fn) => fn(now));
  }
  await tick(3000);
  if (beforeCalm) {
    await beforeCalm({
      tick,
      snapshot: () => painted.slice(),
      emit: (type, event) => {
        assert.ok(listeners.has(type), `missing event listener: ${type}`);
        listeners.get(type)(event);
      },
    });
  }
  if (idleMs) {
    listeners.get("window:pointermove")?.({ clientX: 640, clientY: 400 });
    for (let ms = 3050; ms <= 3000 + idleMs; ms += 50) await tick(ms);
  }
  const clickTime = now + 5;
  now = clickTime;
  listeners.get("enter:click")();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  // RAF timestamps mark the start of a frame and can precede the click handler.
  if (frameBeforeClick) await tick(clickTime - 1);
  for (let i = 1; i <= 60; i++) await tick(clickTime + i * 50);
  await tick(360000);
  const firstStar = 4 + Math.round(1280 * 800 / 2500);
  const before = painted.slice(firstStar);
  await tick(361000);
  const after = painted.slice(firstStar);
  const tilt = (ms) => 0.55 + Math.sin(ms * 0.00005) * 0.12;
  let checked = 0;
  assert.ok(before.length > 1000, "calm galaxy must contain visible spiral stars");
  assert.ok(before.every((star) => star.every(Number.isFinite)), "spiral coordinates must stay finite");
  for (const [x, y, size] of before.slice(0, 20)) {
    const next = after.find((star) => star[2] === size);
    if (!next) continue;
    const dx = x - 640;
    const dy = (y - 400) / tilt(360000);
    const angle = Math.atan2(dy, dx);
    const nextAngle = Math.atan2((next[1] - 400) / tilt(361000), next[0] - 640);
    const rotation = Math.atan2(Math.sin(nextAngle - angle), Math.cos(nextAngle - angle));
    assert.ok(rotation >= 0.02 - 1e-8 && rotation < 0.03,
      "calm spiral must keep rotating at its slow background speed");
    checked++;
  }
  assert.ok(checked > 0, "must verify moving spiral stars");
  return painted;
}

for (const light of [false, true]) {
  test(`calm spiral survives immediate and delayed clicks (${light ? "light" : "dark"})`, async () => {
    await renderGalaxy({ light });
    await renderGalaxy({ light, idleMs: 60000 });
  });
  test(`calm spiral survives a frame timestamp preceding the click (${light ? "light" : "dark"})`, async () => {
    await renderGalaxy({ light, frameBeforeClick: true });
  });
}

test("reduced motion retains the calm spiral", async () => {
  await renderGalaxy({ reducedMotion: true, frameBeforeClick: true });
});

async function outerArmSpeed({ pointer, leave, reducedMotion = false } = {}) {
  let speed;
  await renderGalaxy({
    reducedMotion,
    beforeCalm: async ({ tick, snapshot, emit }) => {
      if (pointer) emit("window:pointermove", pointer);
      for (let ms = 3050; ms <= 5000; ms += 50) await tick(ms);
      if (leave) {
        emit(leave);
        for (let ms = 5050; ms <= 7000; ms += 50) await tick(ms);
      }
      const ms = leave ? 7000 : 5000;
      const outerStars = (painted, time) => {
        const tilt = 0.55 + Math.sin(time * 0.00005) * 0.12;
        return new Map(painted
          .filter(([, , w, h]) => w === h && w >= 0.3 && w < 1.8)
          .map(([x, y, size]) => [size, {
            r: Math.hypot(x - 640, (y - 400) / tilt),
            angle: Math.atan2((y - 400) / tilt, x - 640),
          }])
          .filter(([, star]) => star.r > 450));
      };
      const before = outerStars(snapshot(), ms);
      await tick(ms + 50);
      const after = outerStars(snapshot(), ms + 50);
      const speeds = [];
      for (const [size, star] of before) {
        const next = after.get(size);
        if (!next) continue;
        const delta = next.angle - star.angle;
        speeds.push(Math.atan2(Math.sin(delta), Math.cos(delta)) / 0.05);
      }
      assert.ok(speeds.length > 100, "must measure a visible sample of outer-arm stars");
      speeds.sort((a, b) => a - b);
      speed = speeds[Math.floor(speeds.length / 2)];
    },
  });
  return speed;
}

test("outer arms accelerate progressively as the pointer approaches the center", async () => {
  const idle = await outerArmSpeed();
  const halfway = await outerArmSpeed({ pointer: { clientX: 320, clientY: 200 } });
  const center = await outerArmSpeed({ pointer: { clientX: 640, clientY: 400 } });
  assert.ok(halfway > idle + 0.1, "outer arms must visibly accelerate halfway toward the center");
  assert.ok(center > halfway + 0.35, "outer arms must accelerate further near the center");
  assert.ok(center > idle * 8, "center proximity must strongly boost outer-arm rotation");
});

test("outer-arm acceleration eases away on pointer leave and window blur", async () => {
  const idle = await outerArmSpeed();
  for (const leave of ["document:pointerleave", "window:blur"]) {
    const speed = await outerArmSpeed({ pointer: { clientX: 640, clientY: 400 }, leave });
    assert.ok(Math.abs(speed - idle) < 0.01, `${leave} must restore idle arm speed`);
  }
});

test("pointer proximity does not animate arms with reduced motion", async () => {
  const idle = await outerArmSpeed({ reducedMotion: true });
  const center = await outerArmSpeed({ reducedMotion: true, pointer: { clientX: 640, clientY: 400 } });
  assert.ok(Math.abs(center - idle) < 1e-8, "reduced motion must disable proximity acceleration");
});
