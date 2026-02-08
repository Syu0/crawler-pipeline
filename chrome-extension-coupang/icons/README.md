# Chrome Extension Icons

Place the following icon files in this directory:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

You can create simple icons using any image editor or use the following placeholder approach:

## Quick Icon Generation (Node.js)

If you have canvas installed, you can generate simple colored icons:

```javascript
// Run: npm install canvas
// Then: node generate-icons.js

const { createCanvas } = require('canvas');
const fs = require('fs');

[16, 48, 128].forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Red circle background
  ctx.fillStyle = '#f04f5f';
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
  ctx.fill();
  
  // White "C" letter
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size * 0.6}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', size/2, size/2);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`icon${size}.png`, buffer);
});
```

## Alternative: Use any 16x16, 48x48, 128x128 PNG images

The extension will work without icons but Chrome will show a puzzle piece icon.
