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
        // Iterate through pixels to collect colors
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            // Filter out near-grays and non-vibrant colors
            if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && Math.abs(b - r) < 15) continue;
            // Convert to HSL and only keep vibrant colors
            const {
                h, s, l
            } = rgbToHsl(r, g, b);
            if (s > 0.5 && l > 0.3 && l < 0.7) { // Adjusting brightness for contrast
                const rgb = `rgb(${r},${g},${b})`;
                colorFrequency[rgb] = (colorFrequency[rgb] || 0) + 1;
            }
        }
        // Find the color with the highest frequency
        let bestColor = '';
        let maxFrequency = 0;
        for (let color in colorFrequency) {
            if (colorFrequency[color] > maxFrequency) {
                maxFrequency = colorFrequency[color];
                bestColor = color;
            }
        }
        // Fallback: if no vibrant color found, set to a default color
        if (!bestColor) {
            bestColor = "#E0E0E0"; //fallback to a light gray
            console.log('Falling back to ', bestColor);
        }
        // Set the color of the progress bar
        const progressBar = document.querySelector('#progress-bar');
        if (progressBar) {
            progressBar.style.backgroundColor = bestColor;
        }
        console.log('chosen color:', bestColor);
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