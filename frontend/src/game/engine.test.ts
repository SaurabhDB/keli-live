// Run with: npm test (Node's built-in runner; no extra dependency).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Input, makeCourse, newGame, safeSpeed, score, step, type Surface } from "./engine.ts";

const NONE: Input = { steer: 0, throttle: false, brake: false };
const GAS: Input = { steer: 0, throttle: true, brake: false };
const never = () => 0.99; // no slips, no traffic

function course(surface: Surface, n = 3) {
  return makeCourse(Array.from({ length: n }, () => ({ surface, place: "Test", roadTempC: -2, turnDeg: 0 })));
}

function drive(surface: Surface, input: Input, seconds: number, start = newGame()) {
  const c = course(surface);
  for (let t = 0; t < seconds; t += 1 / 60) step(start, c, input, 1 / 60, never);
  return start;
}

test("the first step announces the first stretch", () => {
  const events = step(newGame(), course("dry"), NONE, 1 / 60, never);
  assert.equal(events[0].kind, "stretch");
});

test("on ice, studded tyres still pull away, but stopping takes far longer", () => {
  const dry = drive("dry", GAS, 3);
  const ice = drive("ice_risk", GAS, 3);
  assert.ok(ice.v < dry.v * 0.75 && ice.v > dry.v * 0.3, `ice ${ice.v} vs dry ${dry.v}`);
  const stop = (surface: Surface) => {
    const s = newGame();
    s.v = 20;
    const c = course(surface, 5);
    while (s.v > 0.1) step(s, c, { steer: 0, throttle: false, brake: true }, 1 / 60, never);
    return s.y;
  };
  assert.ok(stop("ice_risk") > stop("dry") * 3);
});

test("a bus reaches 50 km/h within 15 s on an icy road", () => {
  const bus = drive("ice_risk", GAS, 15, newGame("bus"));
  assert.ok(bus.v * 3.6 > 50, `bus ${bus.v * 3.6} km/h`);
});

test("on ice the car keeps sliding sideways after the steering is released", () => {
  const steerThenLetGo = (surface: Surface) => {
    const s = newGame();
    s.v = 20;
    const c = course(surface);
    for (let i = 0; i < 20; i++) step(s, c, { steer: 1, throttle: false, brake: false }, 1 / 60, never);
    for (let i = 0; i < 20; i++) step(s, c, NONE, 1 / 60, never);
    return Math.abs(s.vx);
  };
  assert.ok(steerThenLetGo("ice_risk") > steerThenLetGo("dry"));
});

test("driving far above the safe speed on ice makes the car slip", () => {
  const s = newGame();
  s.v = safeSpeed("ice_risk") * 2;
  const c = course("ice_risk");
  let slips = 0;
  for (let i = 0; i < 120; i++) slips += step(s, c, GAS, 1 / 60, () => 0).filter((e) => e.kind === "slip").length;
  assert.ok(slips > 0);
});

test("hitting the road edge fast costs a life", () => {
  const s = newGame();
  s.v = 25;
  s.x = 0.4;
  s.vx = -3;
  const c = course("dry");
  const events = [];
  for (let i = 0; i < 30; i++) events.push(...step(s, c, { steer: -1, throttle: true, brake: false }, 1 / 60, never));
  assert.equal(events.filter((e) => e.kind === "offroad").length, 1); // then briefly invulnerable
  assert.equal(s.lives, 2);
});

test("a black-ice patch drops grip so the car slides much further", () => {
  const c = makeCourse([{ surface: "ice_risk", place: "Test", roadTempC: -3, turnDeg: 0 }], 650, 1);
  const patch = c.patches[0];
  const onPatch = newGame();
  onPatch.y = patch.y0 + 1;
  onPatch.x = (patch.x0 + patch.x1) / 2;
  onPatch.v = 15;
  const events = step(onPatch, c, { steer: 1, throttle: false, brake: false }, 1 / 60, never);
  assert.ok(events.some((e) => e.kind === "blackIce"));
  assert.ok(onPatch.onIce);
});

test("a loaded truck needs a longer stopping distance than a car", () => {
  const stop = (vehicle: "car" | "truck") => {
    const s = newGame(vehicle);
    s.v = 20;
    const c = course("wet", 5);
    const start = s.y;
    while (s.v > 0.1) step(s, c, { steer: 0, throttle: false, brake: true }, 1 / 60, never);
    return s.y - start;
  };
  assert.ok(stop("truck") > stop("car"));
});

test("a bend taken fast pushes the car outward, far more on ice than on a dry road", () => {
  const drift = (surface: Surface) => {
    const c = makeCourse([{ surface, place: "Bend", roadTempC: -2, turnDeg: 40 }], 650, 3);
    const s = newGame();
    s.y = 1; // bend to the right begins
    s.v = 25;
    for (let i = 0; i < 120; i++) step(s, c, { steer: 0, throttle: true, brake: false }, 1 / 60, never);
    return 1.5 - s.x; // lanes pushed left (outward)
  };
  assert.ok(drift("dry") > 0);
  assert.ok(drift("ice_risk") > drift("dry") * 2, `ice ${drift("ice_risk")} dry ${drift("dry")}`);
});

test("real turns shape the road: a right turn bends the road centre to the right", () => {
  const c = makeCourse([{ surface: "dry", place: "A", roadTempC: 0, turnDeg: 30 }], 650, 1);
  assert.ok(c.center[400] > 20);
  const straight = makeCourse([{ surface: "dry", place: "A", roadTempC: 0, turnDeg: 0 }], 650, 1);
  assert.equal(straight.center[400], 0);
});

test("a race car on slicks has far less grip on ice than an ordinary car", () => {
  const stop = (vehicle: "car" | "race") => {
    const s = newGame(vehicle);
    s.v = 20;
    const c = course("ice_risk", 5);
    while (s.v > 0.1) step(s, c, { steer: 0, throttle: false, brake: true }, 1 / 60, never);
    return s.y;
  };
  assert.ok(stop("race") > stop("car") * 1.3);
});

test("reaching the end finishes the game with a positive score", () => {
  const c = course("dry", 1);
  const s = newGame();
  for (let i = 0; i < 60 * 120 && s.status === "running"; i++) step(s, c, GAS, 1 / 60, never);
  assert.equal(s.status, "finished");
  assert.ok(score(s, c) > 0);
});
