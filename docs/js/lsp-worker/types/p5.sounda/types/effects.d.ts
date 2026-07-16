/**
 * Effects
 *
 * Audio effect and processing nodes.
 * Depends on: core.d.ts
 */

declare namespace p5 {
  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  class Biquad extends p5soundNode {
    constructor(
      cutoff?: number,
      type?: string,
    );

    cutoff: number;
    type: string;

    freq(value: number): void;

    res(value: number): void;

    gain(value: number): void;

    setType(type: string): void;
  }

  class LowPass extends Biquad {
    constructor(
      frequency?: number,
    );
  }

  class HighPass extends Biquad {
    constructor(
      frequency?: number,
    );
  }

  class BandPass extends Biquad {
    constructor(
      frequency?: number,
    );
  }

  // -------------------------------------------------------------------------
  // Delay
  // -------------------------------------------------------------------------

  class Delay extends p5soundMixEffect {
    constructor(
      delayTime?: number,
      feedback?: number,
    );

    d: number;
    f: number;

    /**
     * Sets the delay time in seconds.
     *
     * rampTime defaults to 0.1.
     * Passing 0 preserves legacy behavior.
     */
    delayTime(
      value: number,
      rampTime?: number,
    ): void;

    feedback(
      value: number,
    ): void;

    process(
      input: object,
      delayTime: number,
      feedback: number,
    ): void;
  }

  // -------------------------------------------------------------------------
  // Envelope
  // -------------------------------------------------------------------------

  class Envelope extends p5soundNode {
    constructor(
      attack?: number,
      decay?: number,
      sustain?: number,
      release?: number,
    );

    attack: number;
    attackLevel: number;
    decay: number;
    sustain: number;
    release: number;

    play(): void;

    triggerAttack(): void;

    triggerRelease(): void;

    setADSR(
      attack: number,
      decay: number,
      sustain: number,
      release: number,
    ): void;

    attackTime(
      value: number,
    ): void;

    releaseTime(
      value: number,
    ): void;
  }

  // -------------------------------------------------------------------------
  // Gain
  // -------------------------------------------------------------------------

  class Gain extends p5soundNode {
    constructor(
      value?: number,
    );
  }

  // -------------------------------------------------------------------------
  // Panner
  // -------------------------------------------------------------------------

  class Panner extends p5soundNode {
    constructor(
      amount?: number,
    );

    pan(
      amount: number | object,
    ): void;
  }

  class Panner3D extends p5soundNode {
    constructor();

    process(
      input: object,
    ): void;

    set(
      x: number,
      y: number,
      z: number,
    ): void;

    setFalloff(
      rolloffFactor: number,
      maxDistance: number,
    ): void;

    maxDist(
      distance: number,
    ): void;

    rolloff(
      value: number,
    ): void;

    positionX(
      value: number,
    ): void;

    positionY(
      value: number,
    ): void;

    positionZ(
      value: number,
    ): void;
  }

  // -------------------------------------------------------------------------
  // Pitch
  // -------------------------------------------------------------------------

  class PitchShifter extends p5soundNode {
    constructor(
      shiftValue?: number,
    );

    shift(
      value: number,
    ): void;
  }

  // -------------------------------------------------------------------------
  // Reverb
  // -------------------------------------------------------------------------

  class Reverb extends p5soundMixEffect {
    constructor(
      decayTime?: number,
    );

    decayTime: number;

    set(
      value: number,
    ): void;
  }
}
