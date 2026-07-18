import 'p5';

declare module 'p5' {
  interface p5 {
    __TEST_METHOD__(): void;
  }
}

export {};
