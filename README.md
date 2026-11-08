# Rocket Flight Lab

A browser-based 3-D model-rocket flight simulator. Load **any STL file** of a model
rocket, put real **A–F motors** in it (every delay variant, from certified thrust
curves), set it up on a detailed launch pad, then walk through the real
**ignition sequence on the launch controller** and watch it fly.

![launch sequence](docs/screenshot.png)

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (usually http://localhost:5173). `npm run build` makes a static
site in `dist/` that you can host anywhere.

## What's in it

### Bring your own rocket (STL)
* Binary or ASCII STL, any orientation, mm / cm / m / inch (auto-guessed, editable).
* The analyzer slices the mesh to find the long axis, which end is the nose, the
  body-radius profile, nose length, **fin sets** (count, root/tip chord, span, sweep)
  and **motor-mount tubes** (13/18/24/29 mm, centred or clustered, including
  minimum-diameter rockets where the body tube *is* the motor tube).
* Motors are **placed for you** at the aft end of each stage, sized to the mount it
  finds. You can change motor, cluster count, how far the motor sticks out, and
  the stage joint positions.
* **Separated stages are assembled automatically.** If your STL has the stages
  side by side as separate pieces (the usual 3-D-printing layout), the app finds
  each piece, works out which is the sustainer (nose + fins) and which are boosters
  (fins + coupler stub), orders them bottom → top (largest fins at the bottom; you
  can re-order), seats each coupler stub into the stage above, and when you load the
  pad it **animates the stages being stacked onto the launch rod**. Stage joints
  and booster/sustainer motor placement come from the parts.
* Airframe mass is estimated from the model (override it if you weighed yours),
  plus optional nose weight. Drag Cd is computed (override available).
* Live CG/CP diagram and stability margin; an X-ray view shows motors, CG and CP
  inside the 3-D model.

### Motors — every A–F motor, every delay
`src/data/motors.generated.js` holds **91 motor variants built from 38 certified
thrust curves** (NAR/CAR/TRA certification data published on thrustcurve.org,
mirrored at [openrocket/motor-database](https://github.com/openrocket/motor-database);
the raw `.eng` files are in `data/eng/`). Each delay version is its own motor with
its own timing, mass and Estes label colour:

| Class | Motors |
|------|--------|
| 1/4A–1/2A | 1/4A3-3T, 1/2A3-2T/-4T, 1/2A6-2 |
| A | A3-4T, A10-0T/-3T/-PT, A8-3/-5 |
| B | B4-2/-4, B6-0/-2/-4/-6 |
| C | C5-3, C6-0/-3/-5/-7, C11-0/-3/-5/-7 |
| D | D11-P, D12-0/-3/-5/-7, AeroTech D13W, D15T, D21T, D24T |
| E | E9-0/-4/-6/-8, E12-0/-4/-6/-8, E16-0/-4/-6/-8, E30-4/-7, AeroTech E15W, E18W, E23T, E28T |
| F | F15-0/-4/-6/-8, F26FJ, F50, AeroTech F20W, F23FJ, F24W, F39T, F42T, F44W, F52T, F67W |

The **Motor catalog** tab lists them all with total impulse, % of class, average
and peak thrust, burn time, delay and mass, and overlays thrust curves for
comparison. You can import any other RASP `.eng` file too.

Burn behaviour is modelled the way real motors work: thrust follows the certified
curve, propellant mass drops in proportion to delivered impulse, the delay starts
at burnout (black-powder motors leave a tracking-smoke trail during it), and the
ejection charge fires at burnout + delay. `-0` booster motors fire straight
through into the next stage (direct staging); a booster with a delay, or a
composite motor, **won't** light the upper stage — just like real life.

### The launch pad and controller
* Tripod pad in the style of the Estes Porta-Pad: three plastic legs with ribs and
  feet, centre hub, tilt bracket with wing nut, sooty steel blast deflector, 1/8"
  two-piece launch rod with joint sleeve (or 3/16" / 1/4" rods), orange rod cap.
* Hand-held controller in the style of the Estes Electron Beam: safety key,
  continuity lamp, big red launch button, label panel, battery door, a 15 ft lead
  with red/black micro-clips that clip onto the igniter wires in the nozzle.
* **Launch sequence** (click the 3-D parts or use the checklist): load the rocket →
  remove rod cap → attach micro-clips → walk back 15 ft → insert safety key
  (continuity light comes on) → "range is clear" → 5-4-3-2-1 → **press and hold
  LAUNCH** until the igniter heats and the motor lights (let go too early and it
  cools off) → flight → remove the safety key → recover the rocket.

### Physics
* 3-D rigid body, RK4 integration (1 ms steps under power): thrust, gravity
  (varies with altitude), drag, normal force at the Barrowman centre of pressure,
  aerodynamic + jet pitch damping → realistic weathercocking.
* Centre of pressure: slender-body theory for the nose/transitions plus Barrowman
  fin equations with body interference, from the shapes found in your STL.
* Drag: component build-up (skin friction with Reynolds number and surface
  roughness, base drag that shrinks while the motor fires, fin trailing-edge drag,
  launch-lug/misc.) with compressibility correction.
* ISA atmosphere at your site elevation and temperature; wind with a 1/7-power
  height profile and gusts.
* Launch-rod guidance until the lug clears the rod; rod-exit speed reported.
* Staging, separated boosters tumbling back, ejection, parachute/streamer
  inflation and descent with wind drift.
* Optional real-world scatter: impulse ±3.5 %, delay ±10 %, igniter timing,
  cluster light-up stagger.

### Flight report
Apogee, max speed/Mach, max g, rod-exit speed, ejection speed/altitude, descent
rate, drift, events timeline, charts (altitude, velocity, acceleration,
thrust & mass, angle of attack & Mach, ground track) and plain-language warnings
(unstable, too-slow rod exit, early/late ejection with the ideal delay, hard landing,
staging problems).

## Example rockets
`public/examples/` (generated by `npm run build:examples`):
1. **Sparrow C** – simple single-stage 18 mm sport rocket (C6-5, 12" chute).
2. **Stratos E** – minimum-diameter 24 mm high-altitude rocket (E12-8, streamer).
3. **Twin Falcon** – two-stage C rocket (C6-0 booster → C6-7 sustainer).
4. **Triple Threat** (bonus) – a three-stage rocket exported as *separate parts*,
   to show the automatic stage assembly.

## Project layout
```
src/physics/   eng.js (RASP parser), motors.js, geometry.js (STL analysis + Barrowman),
               assembly.js (separated-parts stacking), atmosphere.js, simulator.js
src/scene/     world.js, launchPad.js, controller.js, rocketModel.js, effects.js
src/ui/        panel.js, charts.js, diagram.js
tools/         build-motors.mjs, motor-catalog.mjs, gen-examples.mjs
data/eng/      certified thrust curves
test/          node --test physics tests (npm test)
```

## Limitations
* Fin and body shapes are read from the mesh by slicing; very unusual geometry
  (ring fins, canted fins, pods, gliders) is approximated by an equivalent
  trapezoidal fin set. Roll is not simulated.
* Masses of delay variants made from one certified curve are adjusted by a small
  per-second delay-grain allowance.
* Model-rocket subsonic regime; the transonic drag rise is approximate.
