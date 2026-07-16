/**
 * Analysis
 *
 * Audio analysis nodes.
 * Depends on: core.d.ts
 */

declare namespace p5 {
  // -------------------------------------------------------------------------
  // Amplitude
  // -------------------------------------------------------------------------

  class Amplitude extends p5soundNode {
    constructor();

    /**
     * Returns the current amplitude level.
     */
    getLevel(): number;
  }

  // -------------------------------------------------------------------------
  // FFT
  // -------------------------------------------------------------------------

  class FFT extends p5soundNode {
    constructor(
      bins?: number,
    );

    /**
     * Performs an FFT analysis and returns the spectrum.
     */
    analyze(): number[];
  }
}
