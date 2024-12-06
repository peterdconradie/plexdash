// getColour.js
// Main function
export function getDominantColor(imageUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Enable cross-origin requests
    img.src = imageUrl;
    img.onload = function () {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        const colorFrequency = {};
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && Math.abs(b - r) < 15) continue;
            const {
                h, s, l
            } = rgbToHsl(r, g, b);
            if (s > 0.5) {
                const rgb = `rgb(${r},${g},${b})`;
                colorFrequency[rgb] = (colorFrequency[rgb] || 0) + 1;
            }
        }
        let dominantColor = '';
        let maxFrequency = 0;
        for (let color in colorFrequency) {
            if (colorFrequency[color] > maxFrequency) {
                maxFrequency = colorFrequency[color];
                dominantColor = color;
            }
        }
        if (dominantColor) {
            const rgbValues = dominantColor.match(/\d+/g).map(Number);
            const hex = rgbToHex(rgbValues[0], rgbValues[1], rgbValues[2]);
            const progressBar = document.querySelector('#progress-bar');
            if (progressBar) progressBar.style.backgroundColor = hex;
            console.log('Dominant Vibrant Color:', hex);
        }
        else {
            console.log('No vibrant color found.');
            //if (progressBar) progressBar.style.backgroundColor = #101010;
        }
    };
    img.onerror = function () {
        console.error('Error loading image for color extraction.');
    };
}
// Helper function to convert RGB to HSL
export function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
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
// Helper function to convert RGB to HEX
export function rgbToHex(r, g, b) {
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}