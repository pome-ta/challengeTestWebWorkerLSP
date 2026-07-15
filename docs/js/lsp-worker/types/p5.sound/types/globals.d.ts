/**
 * p5.sound global augmentations for p5.js v2.
 *
 * This file augments the p5 instance with the functions
 * provided by the p5.sound addon.
 */

import p5 from 'p5';

declare module 'p5' {
  interface p5 {
    /**
     * Returns the underlying AudioContext.
     */
    getAudioContext(): AudioContext;

    /**
     * Replaces the AudioContext used by p5.sound.
     */
    setAudioContext(context: AudioContext): void;

    /**
     * Starts audio in browsers that require
     * a user gesture before playback.
     */
    userStartAudio(): Promise<void>;

    /**
     * Suspends the current AudioContext.
     */
    userStopAudio(): void;

    /**
     * Loads an audio file.
     */
    loadSound(
      path: string | string[],
      successCallback?: () => void
    ): Promise<p5.SoundFile> | p5.SoundFile;
  }
}
