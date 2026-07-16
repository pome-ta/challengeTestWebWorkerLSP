/**
 * Core type declarations for p5.sound.
 *
 * Base classes shared by the p5.sound API.
 */

declare namespace p5 {
  /**
   * Base class for all p5.sound audio nodes.
   */
  class p5soundNode {
    /**
     * Underlying input node.
     */
    input: any;

    /**
     * Underlying output node.
     */
    output: any;

    /**
     * Connects this node to another node.
     */
    connect(unit: object): void;

    /**
     * Disconnects this node.
     */
    disconnect(): void;
  }

  /**
   * Base class for sound sources.
   */
  class p5soundSource extends p5soundNode {}

  /**
   * Base class for mix/effect processors.
   */
  class p5soundMixEffect extends p5soundNode {}
}
