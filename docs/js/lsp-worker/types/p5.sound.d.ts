/**
 * This declaration file is maintained manually.
 * It is intentionally focused on the APIs supported
 * by this project and may not represent the complete
 * p5.sound API.
 */
// Type definitions for p5.sound (v2 / Tone.js based architecture)
// Project: https://github.com/processing/p5.sound.js

import p5 from 'p5';

declare module 'p5' {
  interface p5 {
    /**
     * Returns the underlying AudioContext.
     */
    getAudioContext(): AudioContext;

    /**
     * Sets the underlying AudioContext.
     */
    setAudioContext(ctx: AudioContext): void;

    /**
     * Enables audio in browsers that have a strict autoplay policy.
     */
    userStartAudio(): Promise<void>;

    /**
     * Stops the audio context.
     */
    userStopAudio(): void;

    /**
     * loadSound() returns a new SoundFile from a specified path.
     */
    loadSound(
      path: string | string[],
      successCallback?: () => void
    ): Promise<p5.SoundFile> | p5.SoundFile;
  }
}

declare namespace p5 {
  // -------------------------------------------------------------------------
  // Base Classes
  // -------------------------------------------------------------------------
  class p5soundNode {
    input: any;
    output: any;
    connect(unit: object): void;
    disconnect(): void;
  }

  class p5soundSource extends p5soundNode {}

  class p5soundMixEffect extends p5soundNode {}

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------
  class AudioIn extends p5soundSource {
    constructor();
    start(): void;
    stop(): void;
  }

  class Noise extends p5soundSource {
    constructor(type?: string);
    type(t: string): void;
  }

  class Oscillator extends p5soundSource {
    /**
     * v1 compatibility: the first argument can be either frequency (number) or type (string).
     */
    constructor(frequency?: number | string, type?: string);
    frequency: number | string;
    type: string;
    freq(f: number | string, rampTime?: number): void;
    phase(p: number): void;
    setType(t: string): void;
  }

  class SawOsc extends Oscillator {
    constructor(frequency?: number | string);
  }

  class SqrOsc extends Oscillator {
    constructor(frequency?: number | string);
  }

  class TriOsc extends Oscillator {
    constructor(frequency?: number | string);
  }

  class SinOsc extends Oscillator {
    constructor(frequency?: number | string);
  }

  class SoundFile extends p5soundSource {
    constructor(buffer?: any, successCallback?: () => void);
    playing: boolean;
    paused: boolean;
    speed: number;
    start(): void;
    play(): void;
    stop(): void;
    pause(): void;
    loop(value?: boolean): void;
    loopPoints(startTime?: number, duration?: number): void;
    setPath(path: string, successCallback?: () => void): void;
    rate(value?: number): void;
    duration(): number;
    sampleRate(): number;
    jump(value: number): void;
    isPlaying(): boolean;
    isLooping(): boolean;
    onended(callback: () => void): void;
    frames(): number;
    channels(): number;
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------
  class Biquad extends p5soundNode {
    constructor(cutoff?: number, type?: string);
    cutoff: number;
    type: string;
    res(r: number): void;
    gain(g: number): void;
    setType(t: string): void;
    freq(f: number): void;
  }

  class LowPass extends Biquad {
    constructor(frequency?: number);
  }

  class HighPass extends Biquad {
    constructor(frequency?: number);
  }

  class BandPass extends Biquad {
    constructor(frequency?: number);
  }

  class Delay extends p5soundMixEffect {
    constructor(delayTime?: number, feedback?: number);
    d: number;
    f: number;
    /**
     * Set the delay time in seconds.
     * rampTime defaults to 0.1. Setting to 0 triggers legacy behavior.
     */
    delayTime(value: number, rampTime?: number): void;
    feedback(value: number): void;
    process(input: object, delayTime: number, feedback: number): void;
  }

  class Envelope extends p5soundNode {
    constructor(attack?: number, decay?: number, sustain?: number, release?: number);
    attack: number;
    attackLevel: number;
    decay: number;
    sustain: number;
    release: number;
    play(): void;
    triggerAttack(): void;
    triggerRelease(): void;
    setADSR(a: number, d: number, s: number, r: number): void;
    releaseTime(value: number): void;
    attackTime(value: number): void;
  }

  class Gain extends p5soundNode {
    constructor(value?: number);
  }

  class Panner extends p5soundNode {
    constructor(amount?: number);
    pan(amount: number | object): void;
  }

  class Panner3D extends p5soundNode {
    constructor();
    process(input: object): void;
    set(x: number, y: number, z: number): void;
    setFalloff(rolloffFactor: number, maxDistance: number): void;
    maxDist(d: number): void;
    rolloff(r: number): void;
    positionX(p: number): void;
    positionY(p: number): void;
    positionZ(p: number): void;
  }

  class PitchShifter extends p5soundNode {
    constructor(shiftValue?: number);
    shift(value: number): void;
  }

  class Reverb extends p5soundMixEffect {
    constructor(decayTime?: number);
    decayTime: number;
    set(t: number): void;
  }

  // -------------------------------------------------------------------------
  // Analysis (Types inferred from app.js exports)
  // -------------------------------------------------------------------------
  class Amplitude extends p5soundNode {
    constructor();
    getLevel(): number;
  }

  class FFT extends p5soundNode {
    constructor(bins?: number);
    analyze(): number[];
  }

  // -------------------------------------------------------------------------
  // Deprecated Classes
  // (These classes only trigger a console.warn directing to Tone.js)
  // -------------------------------------------------------------------------
  class MonoSynth { constructor(anyArgs?: any); }
  class EQ { constructor(anyArgs?: any); }
  class Convolver { constructor(anyArgs?: any); }
  class Distortion { constructor(anyArgs?: any); }
  class OnsetDetect { constructor(anyArgs?: any); }
  class Filter { constructor(anyArgs?: any); }
  class Effect { constructor(anyArgs?: any); }
  class Compressor { constructor(anyArgs?: any); }
  class AudioVoice { constructor(anyArgs?: any); }
  class Part { constructor(anyArgs?: any); }
  class Phrase { constructor(anyArgs?: any); }
  class PolySynth { constructor(anyArgs?: any); }
  class Pulse { constructor(anyArgs?: any); }
  class Score { constructor(anyArgs?: any); }
  class SoundLoop { constructor(anyArgs?: any); }
}
