/**
 * Sources
 *
 * Source nodes that generate or reproduce audio.
 * Depends on: core.d.ts
 */

import p5 from 'p5';

declare namespace p5 {
  // -------------------------------------------------------------------------
  // Audio Input
  // -------------------------------------------------------------------------

  class AudioIn extends p5soundSource {
    constructor();

    start(): void;
    stop(): void;
  }

  // -------------------------------------------------------------------------
  // Noise
  // -------------------------------------------------------------------------

  class Noise extends p5soundSource {
    constructor(type?: string);

    type(type: string): void;
  }

  // -------------------------------------------------------------------------
  // Oscillators
  // -------------------------------------------------------------------------

  class Oscillator extends p5soundSource {
    /**
     * For compatibility, the first parameter may be either
     * a frequency or an oscillator type.
     */
    constructor(
      frequency?: number | string,
      type?: string,
    );

    frequency: number | string;
    type: string;

    freq(
      value: number | string,
      rampTime?: number,
    ): void;

    phase(value: number): void;

    setType(type: string): void;
  }

  class SawOsc extends Oscillator {
    constructor(
      frequency?: number | string,
    );
  }

  class SqrOsc extends Oscillator {
    constructor(
      frequency?: number | string,
    );
  }

  class TriOsc extends Oscillator {
    constructor(
      frequency?: number | string,
    );
  }

  class SinOsc extends Oscillator {
    constructor(
      frequency?: number | string,
    );
  }

  // -------------------------------------------------------------------------
  // SoundFile
  // -------------------------------------------------------------------------

  class SoundFile extends p5soundSource {
    constructor(
      buffer?: any,
      successCallback?: () => void,
    );

    playing: boolean;
    paused: boolean;
    speed: number;

    start(): void;
    play(): void;
    stop(): void;
    pause(): void;

    loop(value?: boolean): void;

    loopPoints(
      startTime?: number,
      duration?: number,
    ): void;

    setPath(
      path: string,
      successCallback?: () => void,
    ): void;

    rate(value?: number): void;

    duration(): number;

    sampleRate(): number;

    jump(value: number): void;

    isPlaying(): boolean;

    isLooping(): boolean;

    onended(
      callback: () => void,
    ): void;

    frames(): number;

    channels(): number;
  }
}

declare namespace p5 {
  class Hoge {}
}

