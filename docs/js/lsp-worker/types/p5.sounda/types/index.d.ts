declare module 'p5.sounda' {
  export class AudioIn {
    start(): void;
    stop(): void;
  }

  export class FFT {
    analyze(): number[];
  }

  export const VERSION: string;
}
