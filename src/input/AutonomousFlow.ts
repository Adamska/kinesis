import { MathUtils, Vector3 } from 'three'
import { REDUCED_MOTION } from '../config/motion'

const SIGMA = 10
const RHO = 28
const BETA = 8 / 3

const TIME_SCALE = 0.28
const MAX_TIME_STEP = 0.05

const CYCLE_SECONDS = 16
const INITIAL_CLOCK = 4
const GATHER_START = 0.62
const GATHER_FULL = 0.72
const RELEASE = 0.9

/**
 * Self-driving force source used whenever nobody is steering. The emitter rides a
 * Lorenz trajectory, offset by a slow Lissajous drift so successive laps never retrace
 * the same path, and runs a gather-then-burst cycle on a fixed period.
 */
export class AutonomousFlow {
  readonly position = new Vector3()
  pinch = 0

  private x = 0.9
  private y = 1.4
  private z = 21
  private clock = INITIAL_CLOCK
  private burstPending = false

  /** Advances the attractor. A calm flow keeps moving but never gathers or bursts. */
  advance(delta: number, calm = false): void {
    const dt = Math.min(delta, MAX_TIME_STEP)
    const previousPhase = (this.clock % CYCLE_SECONDS) / CYCLE_SECONDS
    this.clock += dt
    const phase = (this.clock % CYCLE_SECONDS) / CYCLE_SECONDS

    const quiet = calm || REDUCED_MOTION
    if (previousPhase < RELEASE && phase >= RELEASE && !quiet) this.burstPending = true
    this.pinch = phase < RELEASE && !calm ? MathUtils.smoothstep(phase, GATHER_START, GATHER_FULL) : 0

    // The trajectory slows while gathering so the gravity well can hold on to its disc.
    this.integrate(dt * TIME_SCALE * (1 - 0.85 * this.pinch))

    const t = this.clock
    this.position.set(
      (this.x / 20) * 1.15 + 0.25 * Math.sin(t * 0.13),
      ((this.z - 25) / 24) * 0.85 + 0.2 * Math.sin(t * 0.19 + 1.1),
      (this.y / 27) * 0.7,
    )
  }

  /** Starts a fresh gather-then-burst cycle, so a resumed attractor never bursts at once. */
  restartCycle(): void {
    this.clock = INITIAL_CLOCK + Math.floor(this.clock / CYCLE_SECONDS) * CYCLE_SECONDS
    this.burstPending = false
  }

  consumeBurst(): boolean {
    const pending = this.burstPending
    this.burstPending = false
    return pending
  }

  /** Classic fourth-order Runge-Kutta step of the Lorenz system. */
  private integrate(h: number): void {
    const { x, y, z } = this
    const k1x = SIGMA * (y - x)
    const k1y = x * (RHO - z) - y
    const k1z = x * y - BETA * z

    const ax = x + 0.5 * h * k1x
    const ay = y + 0.5 * h * k1y
    const az = z + 0.5 * h * k1z
    const k2x = SIGMA * (ay - ax)
    const k2y = ax * (RHO - az) - ay
    const k2z = ax * ay - BETA * az

    const bx = x + 0.5 * h * k2x
    const by = y + 0.5 * h * k2y
    const bz = z + 0.5 * h * k2z
    const k3x = SIGMA * (by - bx)
    const k3y = bx * (RHO - bz) - by
    const k3z = bx * by - BETA * bz

    const cx = x + h * k3x
    const cy = y + h * k3y
    const cz = z + h * k3z
    const k4x = SIGMA * (cy - cx)
    const k4y = cx * (RHO - cz) - cy
    const k4z = cx * cy - BETA * cz

    this.x = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
    this.y = y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y)
    this.z = z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z)
  }
}
