# Kinesis

A real-time fluid of 102,400 particles simulated entirely on the GPU and steered by hand gestures from a webcam. Everything runs client-side in the browser: the physics in fragment shaders, the hand tracking in WebAssembly.

The simulation starts at full fidelity on page load with no permissions required. An autonomous attractor drives the flow until you take over with the pointer or enable webcam tracking.

## Quick start

```bash
npm install
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check, then build for production |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint |

Requires Node 20.19+ (or 22.12+) and a browser with WebGL2. Webcam tracking needs a secure context (`https` or `localhost`).

## Controls

| Input | Stir | Singularity | Shockwave |
| --- | --- | --- | --- |
| Pointer or touch | Move | Press and hold | Release |
| Webcam | Move your hand | Pinch thumb to index | Snap a closed hand wide open |

The dock at the bottom switches between three palettes (Bioluminescent Abyss, Solar Corona, Liquid Mercury), scales curl turbulence, and toggles webcam tracking. When no hand or pointer is active, control returns to the autonomous flow.

## Architecture

```
 webcam ──> HandTracker ⇄ Web Worker ───┐
 pointer ─> PointerField ───────────────┼─> ForceDirector ──> simulationBridge
 Lorenz ──> AutonomousFlow ─────────────┘                          │
                                                                   │ read every frame
            ┌──────────────────────────────────────────────────────┘
            v
   SimulationEngine.step()          velocity pass ─> position pass   (320 x 320, RGBA16F)
            │
            v
   ParticleField                    102,400 points, vertex texture fetch, additive HDR
            │
            v
   PostProcessingStack              bloom (threshold 1.0) ─> vignette ─> ACES tone map
```

Three input sources produce the same four quantities: a force position, its velocity, a pinch strength and a shockwave impulse. `ForceDirector` picks the highest-priority live source each frame (tracked hand, then pointer, then the autonomous attractor), smooths the hand-off, and writes the result to `simulationBridge`.

`simulationBridge` is a plain mutable object, not React state. The vision loop and the render loop write to it in place; the HUD polls it on a timer and writes text nodes directly. No `setState` runs inside `useFrame` or the vision loop. Zustand holds only what the user changes by clicking: palette, turbulence and tracking status.

### Source layout

```
src/
  gpgpu/        SimulationEngine (ping-pong targets, passes, disposal), seed state
  shaders/      curlNoise.glsl, velocity.frag, position.frag, particle.vert, particle.frag
  input/        ForceDirector, AutonomousFlow (Lorenz + Lissajous), PointerField
  vision/       HandTracker (camera, frame pump), landmark worker (MediaPipe),
                GestureExtractor (gesture math), OneEuroFilter, session lifecycle
  scene/        Stage, ParticleField, PostProcessingStack, CameraRig, AdaptiveResolution
  store/        Zustand store and the simulation bridge
  components/   HUD: telemetry overlay, control dock, gesture indicator, hand skeleton
  config/       Cosine palette coefficients
```

## GPGPU pipeline

### State layout

Each particle owns one texel in two 320 x 320 half-float render targets.

| Target | `rgb` | `a` |
| --- | --- | --- |
| Position | World position | Kinetic energy |
| Velocity | Velocity in units per second | Turbulence phase in `[0, 1)` |

Both are `RGBA16F`. Half floats are color-renderable on every WebGL2 device, while `RGBA32F` targets are still missing on many mobile GPUs. Each quantity has a read/write pair because a pass cannot sample the target it renders into; the pair is swapped after every pass.

### Per-frame passes

1. **Velocity** (`velocity.frag`) reads both targets and writes the new velocity.
2. **Position** (`position.frag`) integrates `position += velocity * dt` using the velocity just computed (semi-implicit Euler), and updates the energy scalar.

Two full-screen triangles per frame, 102,400 fragments each. The time step is clamped to 1/30 s so a stalled tab cannot destabilize the orbits.

### Velocity model

- **Curl noise.** The carrier flow is the curl of a vector potential built from three decorrelated simplex fields. Gradients are analytic, so each octave costs three noise evaluations instead of the eighteen a finite-difference curl needs. Because `div(curl(psi)) = 0`, the flow has no sources or sinks.
- **Inertial drag.** Particles relax toward the carrier flow with a per-particle response time between 0.25 s and 0.7 s. Like inertial tracers in real turbulence, they are flung out of vortex cores and gather into filaments, which gives the cloud its structure.
- **Confinement.** A harmonic spring acts only beyond a rest radius, so the interior flow stays incompressible while escapees are pulled back.
- **Pinch.** A Plummer-softened gravity well, `a = -GM r / (r^2 + e^2)^(3/2)`. Velocities are steered toward the matching circular orbital speed around a fixed axis, plus a slow inward drift, so matter spirals into a dense spinning disc rather than collapsing to a point.
- **Shockwave.** The impulse decays from 1 to 0 on the CPU. In the shader, `1 - impulse` is the blast's normalized age: a Gaussian shell rides the expanding front and kicks whatever it sweeps outward.
- **Translation.** Fluid near the hand is accelerated along the hand's velocity vector.

### Rendering

`ParticleField` draws one `THREE.Points` object. The `position` attribute does not hold positions: `xy` is the particle's texel address and `z` a random seed. The vertex shader fetches the live state from the simulation textures.

- Point sprites are stretched into ellipses along screen-space velocity, with opacity scaled down by the same factor so a streak emits the same total light as a dot.
- Color comes from an Inigo Quilez cosine palette indexed by speed and stored energy. Switching palettes interpolates the coefficients.
- Blending is additive into a half-float buffer, so overlapping particles accumulate past 1.0. Bloom is thresholded at luminance 1.0, which makes it selective: only dense or energetic regions glow.

## Hand tracking

MediaPipe `HandLandmarker` (GPU delegate, CPU fallback) runs in a dedicated Web Worker. `HandTracker` samples an offscreen `<video>` element on a 30 Hz timer, turns each new camera frame into an `ImageBitmap` and transfers it to the worker; a frame is only sent once the previous result has come back. Downloading, compiling and running the model all happen off the main thread, so neither startup nor inference can drop a rendered frame.

The worker streams the runtime and model downloads itself, which lets the HUD show real startup progress, then hands the bytes to MediaPipe so nothing is fetched twice. The vision code is imported on demand and never weighs on the initial load.

Gesture metrics are divided by palm length (wrist to middle knuckle), which makes them independent of distance from the camera:

- **Position**: palm center, mirrored and passed through a One Euro filter, an exponential smoother whose cutoff rises with speed: a resting hand stays steady and a moving hand is followed with little lag. Apparent palm size maps to depth.
- **Dropouts**: motion blur can lose the hand for a frame or two mid-gesture. The last pose is held for 280 ms so the force field does not jump to another input source.
- **Pinch**: thumb-tip to index-tip distance, mapped through a smoothstep to a strength in `[0, 1]`.
- **Shockwave**: fires when a closed or pinched hand becomes wide open within 380 ms.

A hand covers far less world distance than a pointer flick, so `ForceDirector` amplifies tracked velocity before it reaches the drag term.

Camera frames are processed locally and never leave the device. The WASM runtime and model (about 22 MB in total) are fetched from the jsDelivr and Google Storage CDNs the first time tracking is enabled.

## Performance notes

- Simulation cost is fixed at two 320 x 320 passes regardless of screen size. Fill rate is the variable cost, so `AdaptiveResolution` lowers the device pixel ratio when the frame rate drops and never reduces the particle count.
- The simulation and input code allocate nothing per frame; vectors are reused scratch objects.
- Render targets, geometries, materials, the camera stream and the `HandLandmarker` are all disposed on unmount.

## License

[MIT](LICENSE)
