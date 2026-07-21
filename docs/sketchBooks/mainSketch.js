/**
 * @param {p5} p
 */
const sketch = (p) => {
  const v = 360;

  p.setup = () => {
    // put setup code here
    p.createCanvas(v, v);
    p.colorMode(p.HSL, v, 1, 1);
  };

  p.draw = () => {
    // put drawing code here
    p.background(p.frameCount % v, 1, 0.5);
  };
};

new p5(sketch);


/*
const v = 360;

function setup() {
  createCanvas(v, v);
  colorMode(HSL, v, 1, 1);
}

function draw() {
  background(frameCount % v, 1, 0.5);
}
*/

