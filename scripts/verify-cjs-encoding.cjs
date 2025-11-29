const path = require('node:path');
const { encodeJpeg } = require('../dist/cjs/index.cjs');

async function test() {
  const width = 1;
  const height = 1;
  const data = new Uint8Array(width * height * 4); // 4 bytes for RGBA

  console.log("Starting CJS encoding test...");
  try {
    await encodeJpeg(data, width, height);
    console.log("CJS encoding test passed successfully.");
  } catch (error) {
    console.error("CJS encoding test failed:", error);
    process.exit(1);
  }
}

test();
