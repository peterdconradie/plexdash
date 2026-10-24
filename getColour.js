// Works out a vibrant colour from the album art for the progress bar.
// Returns a promise that resolves to a CSS colour string.
const FALLBACK_COLOR = '#E0E0E0';
const SAMPLE_SIZE = 100; // The image is scaled down to this size before sampling

export function getDominantColor(imageUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            try {
                const scale = Math.min(1, SAMPLE_SIZE / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const colorFrequency = {};
                for (let i = 0; i < pixels.length; i += 4) {
                    const r = pixels[i];
                    const g = pixels[i + 1];
                    const b = pixels[i + 2];
                    // Skip near-greys
                    if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && Math.abs(b - r) < 15) continue;
                    const {
                        s, l
                    } = rgbToHsl(r, g, b);
                    // Only keep vibrant colours with a brightness that contrasts well
                    if (s > 0.5 && l > 0.3 && l < 0.7) {
                        const rgb = `rgb(${r},${g},${b})`;
                        colorFrequency[rgb] = (colorFrequency[rgb] || 0) + 1;
                    }
                }
                let bestColor = '';
                let maxFrequency = 0;
                for (const color in colorFrequency) {
                    if (colorFrequency[color] > maxFrequency) {
                        maxFrequency = colorFrequency[color];
                        bestColor = color;
                    }
                }
                resolve(bestColor || FALLBACK_COLOR);
            }
            catch (error) {
                // Happens if the server doesn't allow cross-origin image reads
                console.error('Could not read album art for colour extraction:', error);
                resolve(FALLBACK_COLOR);
            }
        };
        img.onerror = function () {
            console.error('Error loading image for colour extraction.');
            resolve(FALLBACK_COLOR);
        };
        img.src = imageUrl;
    });
}

// Converts RGB (0-255) to HSL (0-1)
export function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
        case g:
            h = (b - r) / d + 2;
            break;
        case b:
            h = (r - g) / d + 4;
            break;
        }
        h /= 6;
    }
    return {
        h, s, l
    };
}
