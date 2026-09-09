/* Scroll navigation — the input driver for moving between shapes.
 *
 * The page does not scroll. `.hero` is fixed and `body` has `overflow: hidden`,
 * so there is no scrollport to hang a scroll listener on and no scroll position
 * to map. Instead every gesture that *means* scroll — wheel, trackpad, touch
 * drag, PageUp/PageDown — is normalised into one signed accumulator, and
 * crossing a threshold fires a discrete step.
 *
 * Two things make it feel like scrolling rather than like a button:
 *
 *   tug        below the threshold the accumulator is reported continuously, so
 *              the driver can loosen the field in proportion to how far you
 *              have pushed. The shape reacts before it commits, and springs
 *              back if you stop.
 *   momentum   a trackpad flick or an iOS swipe keeps delivering events for
 *              about a second after the finger leaves. Without a guard that
 *              single gesture would step three times and cycle the whole ring.
 *              After a step the driver is disarmed until *both* the transition
 *              reports its commit point and the input has gone quiet.
 *
 * Positive is "down" — deltaY > 0, or a finger moving up the screen — and
 * advances the ring.
 */
(function (global) {
  'use strict';

  const TUNING = {
    THRESHOLD: 140,      // accumulated px-equivalent that commits a step
    DECAY: 6,            // per second, toward 0, while idle
    QUIET_MAGNITUDE: 4,  // px-equivalent below which input counts as "stopped"
    QUIET_SECONDS: 0.12, // how long it must stay there before re-arming
    AXIS_LOCK_PX: 8,     // movement needed before a touch picks an axis
    TOUCH_GAIN: 1.6,     // a finger travels less than a wheel spins
  };

  class GalaxyScroll {
    /**
     * @param {object} opts
     * @param {EventTarget} opts.target  element that receives wheel/touch
     * @param {(dir: number) => void} opts.onStep   dir is +1 (down) or -1 (up)
     * @param {(tug: number) => void} opts.onTug    signed accum / THRESHOLD
     */
    constructor({ target, onStep, onTug }) {
      this.target = target;
      this.onStep = onStep;
      this.onTug = onTug ?? (() => {});
      this.tuning = { ...TUNING };

      this.accum = 0;
      this.armed = true;
      this.committed = true; // the driver's transition has reached its commit
      this.quietFor = TUNING.QUIET_SECONDS;
      this.lastTickMs = performance.now();

      // Touch gesture state. `axis` is null until the gesture picks one, then
      // 'y' (navigate) or 'x' (leave it to the canvas drag rotation).
      this.touchId = null;
      this.touchAxis = null;
      this.touchStart = { x: 0, y: 0 };
      this.touchLast = { x: 0, y: 0 };

      this._bind();
    }

    _bind() {
      // `passive: false` so preventDefault sticks: it is what stops the macOS
      // two-finger back-swipe and Chrome's overscroll glow.
      this.target.addEventListener('wheel', (e) => {
        e.preventDefault();
        this._push(this._normalizeWheel(e));
      }, { passive: false });

      this.target.addEventListener('touchstart', (e) => {
        if (this.touchId !== null) return;
        const t = e.changedTouches[0];
        this.touchId = t.identifier;
        this.touchAxis = null;
        this.touchStart.x = t.clientX;
        this.touchStart.y = t.clientY;
        this.touchLast.x = t.clientX;
        this.touchLast.y = t.clientY;
      }, { passive: true });

      this.target.addEventListener('touchmove', (e) => {
        const t = this._findTouch(e.changedTouches);
        if (!t) return;

        if (this.touchAxis === null) {
          const dx = Math.abs(t.clientX - this.touchStart.x);
          const dy = Math.abs(t.clientY - this.touchStart.y);
          if (Math.max(dx, dy) < this.tuning.AXIS_LOCK_PX) return;
          // Predominantly vertical navigates; horizontal is left to the
          // canvas drag, which is where the shape's yaw rotation lives.
          this.touchAxis = dy > dx ? 'y' : 'x';
        }

        if (this.touchAxis !== 'y') return;
        // Only a navigating gesture blocks the default, so a horizontal drag
        // keeps behaving exactly as it did before.
        e.preventDefault();
        // Finger moving *up* the screen is a scroll *down*.
        this._push((this.touchLast.y - t.clientY) * this.tuning.TOUCH_GAIN);
        this.touchLast.x = t.clientX;
        this.touchLast.y = t.clientY;
      }, { passive: false });

      const endTouch = (e) => {
        if (!this._findTouch(e.changedTouches)) return;
        this.touchId = null;
        this.touchAxis = null;
      };
      this.target.addEventListener('touchend', endTouch, { passive: true });
      this.target.addEventListener('touchcancel', endTouch, { passive: true });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'PageDown') { e.preventDefault(); this._fire(1); }
        else if (e.key === 'PageUp') { e.preventDefault(); this._fire(-1); }
      });
    }

    _findTouch(list) {
      if (this.touchId === null) return null;
      for (const t of list) if (t.identifier === this.touchId) return t;
      return null;
    }

    /** Wheel deltas arrive in three units; normalise all of them to pixels. */
    _normalizeWheel(e) {
      const d = e.deltaY;
      if (e.deltaMode === 1) return d * 16;               // lines
      if (e.deltaMode === 2) return d * window.innerHeight; // pages
      return d;
    }

    _push(delta) {
      if (!Number.isFinite(delta) || delta === 0) return;
      if (Math.abs(delta) >= this.tuning.QUIET_MAGNITUDE) this.quietFor = 0;

      // While disarmed the input is watched but not banked. Banking it would
      // let a flick's momentum tail refill the accumulator and fire a second
      // step the instant the guard lifts.
      if (!this.armed) return;

      this.accum += delta;
      if (Math.abs(this.accum) >= this.tuning.THRESHOLD) {
        this._fire(Math.sign(this.accum));
      } else {
        this.onTug(this.accum / this.tuning.THRESHOLD);
      }
    }

    _fire(dir) {
      this.accum = 0;
      this.armed = false;
      this.committed = false;
      this.quietFor = 0;
      this.onTug(0);
      this.onStep(dir);
    }

    /** The driver calls this when its transition passes the commit point. */
    commit() {
      this.committed = true;
    }

    /**
     * Called once per frame from the render loop, but timed off the wall clock
     * rather than the frame's dt: a throttled or backgrounded tab must not
     * stretch the re-arm guard into a lockout that outlives the gesture.
     */
    tick() {
      const now = performance.now();
      const dt = Math.min((now - this.lastTickMs) / 1000, 0.25);
      this.lastTickMs = now;
      this.quietFor += dt;

      if (!this.armed) {
        if (this.committed && this.quietFor >= this.tuning.QUIET_SECONDS) {
          this.armed = true;
          this.accum = 0;
        }
        return;
      }

      if (this.accum !== 0) {
        // Spring the unspent push back so a slow drift never banks a step.
        const k = Math.exp(-this.tuning.DECAY * dt);
        this.accum *= k;
        if (Math.abs(this.accum) < 0.5) this.accum = 0;
        this.onTug(this.accum / this.tuning.THRESHOLD);
      }
    }

    /** True while a touch gesture has claimed the vertical axis for navigation. */
    suppressDrag() {
      return this.touchAxis === 'y';
    }
  }

  global.GalaxyScroll = GalaxyScroll;
  global.GalaxyScroll.TUNING = TUNING;
})(window);
