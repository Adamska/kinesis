# Kinesis

A real-time fluid of up to a million particles simulated entirely on the GPU and steered by both hands from a webcam. Everything runs client-side in the browser: the physics in fragment shaders, hand tracking and person segmentation in WebAssembly.

**Live demo: [kinesis-chi.vercel.app](https://kinesis-chi.vercel.app)**

https://github.com/user-attachments/assets/3f41e1b1-8396-4dca-bb25-a712b9d310d2

The page opens with the particles spelling the title, then releases them into the flow. No permission is needed: an autonomous attractor drives the field until you take over with the pointer, a touch screen or webcam tracking.

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

Requires Node 20.19+ (or 22.12+) and a browser with WebGL2. The webcam and microphone need a secure context (`https` or `localhost`).

## Controls

| Input | Stir | Singularity | Shockwave | Second vortex |
| --- | --- | --- | --- | --- |
| Pointer or touch | Move | Press and hold | Release | Second finger |
| Webcam | Move a hand | Pinch thumb to index | Snap a closed hand open | Second hand |

With the webcam, tilting the palm turns the spin axis of its vortex, and moving the hand toward or away from the camera pushes the force point through the depth of the cloud. A reticle marks every steered point; it tightens as a pinch closes and sends out a ring with each shockwave.

The dock holds the palette, turbulence and webcam toggle on its bottom row, and studio controls above it: forms, light trails, particle count, sound, microphone and clip recording. On narrow screens the studio row folds behind a toggle. The hand preview can show the camera feed and turn on the body silhouette.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `1` - `3` | Palette | `T` | Light trails |
| `S` | Next form | `A` | Sound |
| `Space` | Shockwave | `M` | Microphone |
| `[` `]` | Turbulence | `R` | Record a clip |
| `W` | Webcam tracking | `B` | Body silhouette |
| `H` | Hide the interface | `F` | Fullscreen |
| `?` | Shortcut sheet | | |

Palette, turbulence, form and particle count are mirrored in the query string (`?palette=corona&turbulence=1.40&shape=knot&particles=1m`), so any configuration can be shared as a link.

## Architecture

```
 webcam ─> HandTracker ⇄ landmark worker ──┐   hands, palm normals, person mask
 pointer > PointerField (two contacts) ────┼─> ForceDirector ──> simulationBridge
 Lorenz ─> AutonomousFlow ─────────────────┘   two force points        │
                                                                       │ read every frame
            ┌──────────────────────────────────────────────────────────┘
            v
   SimulationEngine.step()     velocity pass ─> position pass   (N x N, RGBA16F)
            │                  + shape targets, body obstacle
            v
   ParticleField               vertex texture fetch, bokeh, additive HDR
            │
            v
   PostProcessing              trails ─> lensing ─> bloom ─> vignette ─> ACES
            │
            v
   ForceReticles               drawn last, untouched by post-processing
```

Every input source resolves into two force points, each with a position, a velocity, a spin axis, a pinch strength and a shockwave impulse. `ForceDirector` picks the highest-priority live source each frame (tracked hands, then pointer contacts, then the autonomous attractor), smooths the hand-off and writes the result to `simulationBridge`.

`simulationBridge` is a plain mutable object, not React state. The vision worker, the render loop and the audio timer read and write it in place; the HUD polls it on a timer and writes text nodes directly. No `setState` runs inside `useFrame` or the vision loop. Zustand holds only what the user changes by clicking.

### Source layout

```
src/
  gpgpu/        SimulationEngine, force points, shape targets and morph, body obstacle, seed state
  shaders/      curl noise, velocity and position passes, particles, reticle, trail, lensing
  post/         TrailPass (feedback), SpacetimePass (lensing and shockwave refraction)
  input/        ForceDirector, PointerField, AutonomousFlow, DeviceTilt, keyboard shortcuts
  vision/       HandTracker, LandmarkWorker and its worker, gesture extraction, hand slots,
                silhouette segmentation, One Euro filter, session lifecycle
  audio/        SoundEngine (generative synth), MicListener (envelope and onsets)
  capture/      Clip recorder
  scene/        Stage, ParticleField, CameraRig, ForceReticles, post-processing stack
  store/        Zustand store, simulation bridge, URL settings, intro
  components/   HUD: telemetry, dock, hand preview, status panels, shortcut sheet
  config/       Palettes, particle budgets, motion preferences, ranges
```

## GPGPU pipeline

### State layout

Each particle owns one texel in two N x N half-float render targets, with N from 256 to 1024.

| Target | `rgb` | `a` |
| --- | --- | --- |
| Position | World position | Kinetic energy |
| Velocity | Velocity in units per second | Turbulence phase in `[0, 1)` |

Both are `RGBA16F`. Half floats are color-renderable on every WebGL2 device, while `RGBA32F` targets are still missing on many mobile GPUs. Each quantity has a read/write pair because a pass cannot sample the target it renders into; the pair is swapped after every pass.

### Per-frame passes

1. **Velocity** (`velocity.frag`) reads both targets and writes the new velocity.
2. **Position** (`position.frag`) integrates `position += velocity * dt` using the velocity just computed (semi-implicit Euler), and updates the energy scalar.

Two full-screen triangles per frame, one fragment per particle. The time step is clamped to 1/30 s so a stalled tab cannot destabilize the orbits.

### Velocity model

- **Curl noise.** The carrier flow is the curl of a vector potential built from three decorrelated simplex fields. Gradients are analytic, so each octave costs three noise evaluations instead of the eighteen a finite-difference curl needs. Because `div(curl(psi)) = 0`, the flow has no sources or sinks.
- **Inertial drag.** Particles relax toward the carrier flow with a per-particle response time between 0.25 s and 0.7 s. Like inertial tracers in real turbulence, they are flung out of vortex cores and gather into filaments.
- **Confinement.** A harmonic spring acts only beyond a rest radius, so the interior flow stays incompressible while escapees are pulled back.
- **Pinch.** A Plummer-softened gravity well per force point, `a = -GM r / (r^2 + e^2)^(3/2)`. Velocities are steered toward the circular orbital speed around that point's spin axis, plus a slow inward drift, so matter spirals into a dense spinning disc. The second point spins the other way by default; with the webcam each axis follows its palm normal.
- **Shockwave.** The impulse decays from 1 to 0 on the CPU. In the shader, `1 - impulse` is the blast's normalized age: a Gaussian shell rides the expanding front and kicks whatever it sweeps outward.
- **Translation.** Fluid near a force point is accelerated along its velocity.
- **Shapes.** A target texture in the state layout holds a point for every particle: the title, a sphere, a trefoil knot or a spiral galaxy. A critically damped spring pulls each particle to its target. A steered point carves through the shape, a pinch tears matter away and a shockwave releases the whole form, which then pulls itself back together.
- **Body obstacle.** With segmentation on, each particle is projected to the screen and looked up in the mirrored person mask. The mask is blurred, so its gradient points out of the body; particles inside are pushed along it, and the fluid flows around the user's silhouette.

### Rendering

`ParticleField` draws one `THREE.Points` object. The `position` attribute does not hold positions: `xy` is the particle's texel address and `z` a random seed. The vertex shader fetches the live state from the simulation textures.

- Point sprites are stretched into ellipses along screen-space velocity, with opacity scaled down by the same factor so a streak emits the same total light as a dot.
- Depth of field follows a thin-lens model: the circle of confusion grows with distance from the focal plane, and defocused particles become wider, dimmer bokeh discs. Focus rests on the center of the cloud and racks to the point a user steers.
- Color comes from an Inigo Quilez cosine palette indexed by speed and stored energy. Switching palettes interpolates the coefficients.
- Blending is additive into a half-float buffer, so overlapping particles accumulate past 1.0. Denser budgets draw each particle dimmer and smaller to keep the overall exposure constant.

### Post-processing

- **Trails.** A feedback pass keeps the brighter of the new frame and a decayed copy of the previous output, so moving matter leaves light streaks. The decay is derived from frame time.
- **Lensing.** Around each pinch well, a thin point-mass lens bends the image: an Einstein ring forms around a dark horizon. Along each shockwave front, the image is refracted with a slight color split. The pass switches itself off when nothing is pinched or blasting.
- **Bloom.** Thresholded at luminance 1.0, which makes it selective: only dense or energetic regions glow. Lensing runs before it, so the glow follows the bent light.

## Hand tracking

MediaPipe `HandLandmarker` (GPU delegate, CPU fallback) runs in a dedicated Web Worker and tracks up to two hands. `HandTracker` takes each camera frame from an offscreen `<video>` as it is decoded (`requestVideoFrameCallback`, with a timer fallback), turns it into an `ImageBitmap` and transfers it to the worker. A frame is only sent once the previous result has come back, so inference runs exactly once per camera frame and never piles up.

- **Preloading.** The runtime and model start downloading and compiling when the pointer reaches the webcam toggle, or during idle time on fast connections. The worker outlives the camera, so turning tracking off and on again is instant.
- **Hand slots.** MediaPipe returns hands in no stable order; each detection is matched to the slot whose last palm position is nearest, so a hand keeps its force point.
- **Position.** The palm center is mirrored and passed through a One Euro filter, an exponential smoother whose cutoff rises with speed. The force point is extrapolated along the filtered velocity by the capture and inference delay, which hides most of the vision latency during a sweep.
- **Orientation.** The palm normal is the cross product of the wrist-to-index and wrist-to-pinky knuckle vectors, with the landmark depth made isotropic by the frame aspect ratio.
- **Gestures.** Metrics are divided by palm length, which makes them independent of distance from the camera. Pinch is the thumb-to-index distance through a smoothstep; a shockwave fires when a closed or pinched hand opens wide within 380 ms. The last pose is held for 280 ms through motion-blur dropouts.
- **Silhouette.** On request, the worker also runs the selfie segmenter on every other frame. The confidence mask is box-filtered to 64 x 48, blurred and sent with the hand results.

A hand covers far less world distance than a pointer flick, so `ForceDirector` amplifies tracked velocity before it reaches the drag term.

Camera frames are processed locally and never leave the device. The WASM runtime and models (about 22 MB in total) are fetched from the jsDelivr and Google Storage CDNs the first time tracking is enabled.

## Sound

The synth starts on request and runs on its own 30 Hz timer, reading the bridge like the HUD does. A detuned drone opens up with the flow, filtered noise follows the stirring speed and pans with it, a sub tone deepens as a pinch closes, and every shockwave fires a sweeping blast with a sub thump.

With the microphone on, an envelope follower blends low-band and broadband energy: loud passages raise the turbulence, and sharp onsets such as claps or kicks fire shockwaves. Echo cancellation keeps the synth from triggering itself.

## Performance notes

- The particle budget is picked from the reported GPU: 65,536 on mobile and software renderers, 102,400 on integrated GPUs, 262,144 on discrete GPUs and Apple silicon. A million particles is available on request.
- Simulation cost is fixed by the budget, regardless of screen size. Fill rate is the variable cost, so `AdaptiveResolution` lowers the device pixel ratio when the frame rate drops.
- The simulation and input code allocate nothing per frame; vectors are reused scratch objects.
- A service worker serves the pinned MediaPipe runtime, the versioned models and the hashed build assets from cache, so later visits load tracking without the network.
- Inference and audio pause while the tab is hidden.
- Render targets, geometries, materials, textures, the camera and microphone streams, the audio graph and the MediaPipe tasks are all disposed on unmount.

## Accessibility

With `prefers-reduced-motion`, the field starts calmer, the camera stops swaying, the intro is skipped, trails are off and the autonomous flow fires no shockwaves. Every control is reachable from the keyboard, and the canvas carries a text description.

## License

[MIT](LICENSE)
