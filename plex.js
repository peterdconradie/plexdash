// Small helpers for talking to the Plex server
import {
    plexApiKey, plexServerUrl
}
from './apikey.js';

const baseUrl = plexServerUrl.replace(/\/+$/, '');

// Builds a full Plex URL with the token and any extra query parameters
export function plexUrl(path, params = {}) {
    const query = new URLSearchParams({
        ...params
        , 'X-Plex-Token': plexApiKey
    });
    return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}${query}`;
}

export async function plexFetchText(path, params) {
    const response = await fetch(plexUrl(path, params));
    if (!response.ok) {
        throw new Error(`Plex returned HTTP ${response.status} for ${path}`);
    }
    return response.text();
}

export async function plexFetchXml(path, params) {
    const text = await plexFetchText(path, params);
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) {
        throw new Error(`Could not parse the Plex response for ${path}`);
    }
    return xml;
}

// Small square thumbnail, resized by the Plex server
export function plexThumbUrl(thumbPath, size) {
    return plexUrl('/photo/:/transcode', {
        width: size
        , height: size
        , minSize: 1
        , upscale: 1
        , url: thumbPath
    });
}

export function plexWebSocketUrl(path) {
    return plexUrl(path).replace(/^http/, 'ws');
}
