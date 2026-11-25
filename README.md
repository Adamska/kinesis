# Kinesis

A real-time fluid of up to a million particles simulated entirely on the GPU and steered by both hands from a webcam. Everything runs client-side in the browser: the physics in fragment shaders, the hand tracking in WebAssembly.

**Live demo: [kinesis-chi.vercel.app](https://kinesis-chi.vercel.app)**

![Kinesis controlling 250k particule points with hand-tracking](https://github.com/user-attachments/assets/1dd3d6c4-ef08-41ec-afac-8d51c5d7cad5)

The simulation starts at full fidelity on page load with no permissions required. An autonomous attractor drives the field until you take over with the pointer, a touch screen or webcam tracking.

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
| Webcam | Move a hand | Pinch thumb to index | Open the pinch | Second hand |

With the webcam, a sweeping hand carries the fluid along with it, and tilting the palm turns the spin axis of its vortex. Holding a fully open hand still for half a second draws part of the fluid onto the hand itself: particles spiral in and settle on the skin of a realistic 3D hand posed like yours, which then moves, turns and bends with your hand wherever you take it, palm, edge or back toward the camera. Closing it into a fist overloads it: the fist squeezes, trembles, heats up and throbs faster and faster while the fluid around it is drawn into a vortex, and after two seconds it explodes. Opening the hand before then cancels the charge and keeps the hand; taking it out of view lets the particles go quietly. A reticle marks every steered point; it tightens as a pinch closes and sends out a ring with each shockwave.

The dock holds the palette, turbulence and webcam toggle on its bottom row, and studio controls above it: light trails, particle count, sound, microphone and clip recording. On narrow screens the studio row folds behind a toggle. The hand preview can show the camera feed beneath the skeleton.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `1` - `3` | Palette | `T` | Light trails |
| `Space` | Shockwave | `A` | Sound |
| `[` `]` | Turbulence | `M` | Microphone |
| `W` | Webcam tracking | `R` | Record a clip |
| `H` | Hide the interface | `F` | Fullscreen |
| `?` | Shortcut sheet | | |

Palette, turbulence and particle count are mirrored in the query string (`?palette=corona&turbulence=1.40&particles=1m`), so any configuration can be shared as a link.

## Architecture

```
 webcam ─> HandTracker ⇄ landmark worker ──┐   hands, palm normals
 pointer > PointerField (two contacts) ────┼─> ForceDirector ──> simulationBridge
 Lorenz ─> AutonomousFlow ─────────────────┘   two force points        │
                                                                       │ read every frame
            ┌──────────────────────────────────────────────────────────┘
            v
   SimulationEngine.step()     velocity pass ─> position pass   (N x N, RGBA16F)
            │
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
  gpgpu/        SimulationEngine, force points, uniforms, seed state
  shaders/      curl noise, velocity and position passes, particles, reticle, trail, lensing
  post/         TrailPass (feedback), SpacetimePass (lensing and shockwave refraction)
  input/        ForceDirector, PointerField, AutonomousFlow, DeviceTilt, keyboard shortcuts
  vision/       HandTracker, LandmarkWorker and its worker, gesture extraction, hand path,
                hand slots, One Euro filter, session lifecycle
  audio/        SoundEngine (generative synth), MicListener (envelope and onsets)
  capture/      Clip recorder
  scene/        Stage, ParticleField, CameraRig, ForceReticles, post-processing stack
  store/        Zustand store, simulation bridge, URL settings
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
- **Sculpt.** Once an open hand has been held still, 60% of the particles each get a fixed spot on the skin of a rigged hand model: a triangle drawn from an area-weighted table, then a point inside it. They travel at the velocity of that spot (each skinned vertex's velocity is tracked and smoothed on the CPU, then interpolated across the triangle), plus a correction proportional to the gap and a swirl around the palm normal, and the pull overrides the other forces as they settle. Riding along with the skin, the hand keeps its shape while it moves instead of smearing behind it, and the speed of settled particles barely adds to their glow. Particles join one after another as a ramp rises over 1.8 s and let go in reverse order.
- **Overload.** A fist held while sculpting raises a charge from 0 to 1 over 2 s; on the CPU it also drives a heartbeat that quickens from 1.5 to 8 Hz and a gravity well at 30% of pinch strength. Settled particles squeeze toward the palm center, tighter on each beat, take a random kick 40 times a second that grows with the square of the charge, and heat up with the beat; they are dimmed further than on an open hand, since the fist packs them tighter, so the heat shows in their color. At full charge the sculpt drops to 0 at once, so every particle is free, and a shockwave fires with 1.5 times the gain and 1.25 times the reach and width of a pinch release. While it runs, speed is capped at 2 units per second instead of 9: most of the cloud sits in the fist and takes the full kick at once, and uncapped it would fly out past the camera. See [Hand model](#hand-model) for how the mesh is posed.
- **Translation.** The pointer and the attractor push nearby fluid with an acceleration along their velocity. A tracked hand carries it instead: particles within its wake are brought up to the hand's speed along its direction of travel and their sideways drift is damped, so the fluid travels with the hand. The wake widens with speed, so a large sweep drags a large mass, and a hand at rest leaves the flow alone.

### Rendering

`ParticleField` draws one `THREE.Points` object. The `position` attribute does not hold positions: `xy` is the particle's texel address and `z` a random seed. The vertex shader fetches the live state from the simulation textures.

- Point sprites are stretched into ellipses along screen-space velocity, with opacity scaled down by the same factor so a streak emits the same total light as a dot.
- Depth of field follows a thin-lens model: the circle of confusion grows with distance from the focal plane, and defocused particles become wider, dimmer bokeh discs. Focus rests on the center of the cloud and racks to the point a user steers.
- Color comes from an Inigo Quilez cosine palette indexed by speed and stored energy. Switching palettes interpolates the coefficients.
- Particles settled on a sculpted hand are drawn dimmer, since the hand packs a large share of the cloud into a small volume, and less so as a fist charges. They are also shaded by depth relative to the palm center: the skin facing the camera is drawn at full strength and the far skin fades, so the palm, the edge and the back of the hand read apart. The vertex shader repeats the simulation's choice of recruits from an integer hash of the particle's texel, so both agree exactly.
- Blending is additive into a half-float buffer, so overlapping particles accumulate past 1.0. Denser budgets draw each particle dimmer and smaller to keep the overall exposure constant.
- Behind the cloud, a faint radial glow takes the mid tone of the current palette and follows palette changes. The final pass is dithered, so the very dark gradient does not band at 8 bits.

### Post-processing

- **Trails.** A feedback pass keeps the brighter of the new frame and a decayed copy of the previous output, so moving matter leaves light streaks. The decay is derived from frame time.
- **Lensing.** Around each pinch well, a thin point-mass lens bends the image: an Einstein ring forms around a dark horizon. Along each shockwave front, the image is refracted with a slight color split. The pass switches itself off when nothing is pinched or blasting.
- **Bloom.** Thresholded at luminance 1.0, which makes it selective: only dense or energetic regions glow. Lensing runs before it, so the glow follows the bent light.

## Hand tracking

MediaPipe `HandLandmarker` (GPU delegate, CPU fallback) runs in a dedicated Web Worker and tracks up to two hands. `HandTracker` takes each camera frame from an offscreen `<video>` as it is decoded (`requestVideoFrameCallback`, with a timer fallback), turns it into an `ImageBitmap` and transfers it to the worker. A frame is only sent once the previous result has come back, so inference runs exactly once per camera frame and never piles up.

- **Preloading.** The runtime and model start downloading and compiling when the pointer reaches the webcam toggle, or during idle time on fast connections. The worker outlives the camera, so turning tracking off and on again is instant.
- **Hand slots.** MediaPipe returns hands in no stable order; each detection is matched to the slot whose last palm position is nearest, so a hand keeps its force point.
- **Position.** The palm center is mirrored and passed through a One Euro filter, an exponential smoother whose cutoff rises with speed. Camera frames arrive at 30 to 60 Hz while the screen refreshes faster, so the filtered positions are played back on a Catmull-Rom spline one frame interval behind the newest one. The path is continuous, passes through every measured position and never overshoots when the hand stops.
- **Tracking gaps.** When every hand leaves the frame, the force points stay where they were for 2.5 s before the attractor takes over, and the attractor never gathers or bursts while tracking is on. A point that changes source starts at its new input rather than sweeping across the cloud.
- **Orientation.** The palm normal is the cross product of the wrist-to-index and wrist-to-pinky knuckle vectors, with the landmark depth made isotropic by the frame aspect ratio.
- **Gestures.** Metrics are divided by palm length, which makes them independent of distance from the camera. Pinch is the thumb-to-index distance through a smoothstep, counted only while the other three fingers stay extended, so a fist is not a pinch; a dead zone keeps relaxed, half-closed fingers from opening a well. A shockwave fires only when a pinch held for 150 ms is opened, never on a single noisy frame or during a fast sweep. Sculpting engages when all four fingers are extended and the thumb is spread, with no pinch, while the palm barely moves for 450 ms; once engaged it survives any movement and a relaxed pose. A fist (mean fingertip reach under 1.3 palm lengths) starts the overload; a reopening past 1.45 that lasts 150 ms cancels it, so one frame folded by motion blur neither starts nor cancels it. Losing the hand ends the sculpt without an explosion. The last pose is held for 280 ms through motion-blur dropouts.

### Hand model

The sculpted hand is the `generic-hand` model from [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) (MIT, 94 KB, in `src/assets/hand/`). Its 25 joints follow the WebXR hand joint names, which line up with MediaPipe's 21 landmarks. It is loaded when a webcam session starts.

- **Pose.** Directions come from MediaPipe's world landmarks, which keep the hand's true depth; the image landmarks flatten it, so a hand turned edge-on or to its back would collapse onto the screen plane. The palm moves as one rigid block, as the metacarpals of a real hand do: only its orientation comes from the landmarks, while the wrist, the base of the thumb and the knuckles keep the model's layout. The fingers and thumb are rebuilt by forward kinematics: each phalanx takes its direction from the landmarks but keeps the model's length, so the hand bends like the user's while staying anatomically proportioned and connected through detection noise. MediaPipe tends to report the thumb splayed far out, so its metacarpal swings only 60% of the way toward the measured direction, at most 35°, and the rest of the thumb turns with it; the base of the thumb stays attached to the palm. The model's thumb metacarpal is short, so it is lengthened by 30% along its own axis, vertices included. The palm is set to a fixed world size, slightly larger when the hand is closer.
- **Skinning.** Each bone's frame has y along the segment and x across the knuckles (along the palm normal for the thumb). The 1,360 vertices follow their bones by linear blend skinning on the CPU, and the result is uploaded as a float texture the velocity pass reads with `texelFetch`.
- **Handedness.** MediaPipe labels hands assuming a mirrored image. The frames it receives are not mirrored, but the view is, so its label names the hand as it appears on screen; a left label selects the mirrored model. The label must hold for six frames before the model switches sides, and it is locked while the hand is sculpted: it is most reliable on the open palm a sculpt starts from, and a label flipping as the hand turns would show the palm where the back should be.

Camera frames are processed locally and never leave the device. The WASM runtime and model (about 22 MB in total) are fetched from the jsDelivr and Google Storage CDNs the first time tracking is enabled.

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

With `prefers-reduced-motion`, the field starts calmer, the camera stops swaying, trails are off and the autonomous flow fires no shockwaves. Every control is reachable from the keyboard, and the canvas carries a text description.

## License

[MIT](LICENSE)
