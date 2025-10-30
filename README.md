# image-stitch

image-stitch combines PNG images into a single output without relying on Canvas APIs. It works in Node.js and modern browsers, including streaming scenarios for large images.

## Install

```bash
npm install image-stitch
```

## Basic usage

```ts
import { concatPngs } from 'image-stitch';
import { readFileSync, writeFileSync } from 'fs';

const result = await concatPngs({
  inputs: [
    readFileSync('one.png'),
    readFileSync('two.png')
  ],
  layout: { columns: 2 }
});

writeFileSync('stitched.png', result);
```

👉 Read the full guides, API docs, and interactive demos at [image-stitch GitHub Pages](https://jburnhams.github.io/Png-concat/).
