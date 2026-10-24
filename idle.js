// Idle screen: when nothing is playing, show recently played tracks and
// recently added albums from the music libraries on the Plex server.
import {
    plexFetchXml, plexThumbUrl
}
from './plex.js';
import {
    loadStats, renderStats
}
from './stats.js';

const RECENT_TRACKS = 5; // How many recently played tracks to show
const RECENT_ALBUMS = 12; // How many recently added albums to fetch (each layout shows as many as fit)
const REFRESH_MS = 5 * 60 * 1000; // Refresh the lists every 5 minutes while idle

let active = false;
let loading = false;
let lastLoad = 0;
let musicSections = null;

export function showIdle() {
    const box = document.querySelector('#idle');
    if (!box) return;
    document.body.classList.add('idle');
    box.hidden = false;
    active = true;
    if (!loading && Date.now() - lastLoad > REFRESH_MS) load();
}

export function hideIdle() {
    if (!active) return;
    active = false;
    document.body.classList.remove('idle');
    const box = document.querySelector('#idle');
    if (box) box.hidden = true;
    lastLoad = 0; // Load fresh lists next time playback stops, so the last track shows up
}

async function load() {
    loading = true;
    lastLoad = Date.now();
    try {
        if (!musicSections) {
            const sections = await plexFetchXml('/library/sections');
            musicSections = Array.from(sections.querySelectorAll('Directory[type="artist"]')).map(d => d.getAttribute('key'));
        }
        const [tracks, albums, stats] = await Promise.allSettled([loadRecentTracks(), loadRecentAlbums(), loadStats()]);
        renderTracks(tracks.status === 'fulfilled' ? tracks.value : []);
        renderAlbums(albums.status === 'fulfilled' ? albums.value : []);
        renderStats(stats.status === 'fulfilled' ? stats.value : null);
        if (stats.status === 'rejected') console.error('Could not load listening stats:', stats.reason);
        if (tracks.status === 'rejected') console.error('Could not load recently played tracks:', tracks.reason);
        if (albums.status === 'rejected') console.error('Could not load recently added albums:', albums.reason);
    }
    catch (error) {
        musicSections = null;
        console.error('Could not load the idle screen:', error);
    }
    finally {
        loading = false;
    }
}

const items = xml => (xml.documentElement ? Array.from(xml.documentElement.children) : []);
const num = value => parseInt(value, 10) || 0;
const page = size => ({
    'X-Plex-Container-Start': 0
    , 'X-Plex-Container-Size': size
});

async function loadRecentTracks() {
    let tracks = [];
    // Play history is the most accurate source
    try {
        const history = await plexFetchXml('/status/sessions/history/all', {
            sort: 'viewedAt:desc'
            , ...page(50)
        });
        tracks = items(history).filter(item => item.getAttribute('type') === 'track').map(item => ({
            item
            , playedAt: num(item.getAttribute('viewedAt'))
        }));
    }
    catch (error) {
        console.error('Could not read the play history, trying another way:', error);
    }
    // Fallback: music tracks sorted by when they were last played
    if (!tracks.length) {
        for (const key of musicSections) {
            const xml = await plexFetchXml(`/library/sections/${key}/all`, {
                type: 10
                , sort: 'lastViewedAt:desc'
                , ...page(20)
            });
            items(xml).forEach(item => {
                const playedAt = num(item.getAttribute('lastViewedAt'));
                if (playedAt) tracks.push({
                    item
                    , playedAt
                });
            });
        }
        tracks.sort((a, b) => b.playedAt - a.playedAt);
    }
    // The same track played twice only shows once
    const seen = new Set();
    return tracks.filter(({
        item
    }) => {
        const key = item.getAttribute('ratingKey');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, RECENT_TRACKS);
}

async function loadRecentAlbums() {
    const albums = [];
    for (const key of musicSections) {
        const xml = await plexFetchXml(`/library/sections/${key}/all`, {
            type: 9
            , sort: 'addedAt:desc'
            , ...page(RECENT_ALBUMS)
        });
        albums.push(...items(xml));
    }
    return albums.sort((a, b) => num(b.getAttribute('addedAt')) - num(a.getAttribute('addedAt'))).slice(0, RECENT_ALBUMS);
}

// --- Rendering ------------------------------------------------------------
function makeImage(className, thumbPath, size) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.loading = 'lazy';
    img.src = thumbPath ? plexThumbUrl(thumbPath, size) : 'images/no_song.png';
    return img;
}

function makeText(title, meta) {
    const text = document.createElement('div');
    text.className = 'recent-text';
    const titleEl = document.createElement('span');
    titleEl.className = 'recent-title';
    titleEl.textContent = title;
    const metaEl = document.createElement('span');
    metaEl.className = 'recent-meta';
    metaEl.textContent = meta;
    text.append(titleEl, metaEl);
    return text;
}

function renderTracks(tracks) {
    const section = document.querySelector('#recent-tracks-section');
    const list = document.querySelector('#recent-tracks');
    if (!section || !list) return;
    list.innerHTML = '';
    tracks.forEach(({
        item, playedAt
    }) => {
        const li = document.createElement('li');
        const thumb = item.getAttribute('parentThumb') || item.getAttribute('thumb') || item.getAttribute('grandparentThumb');
        const artist = item.getAttribute('originalTitle') || item.getAttribute('grandparentTitle') || '';
        const when = timeAgo(playedAt);
        li.append(makeImage('recent-art', thumb, 96), makeText(item.getAttribute('title') || 'Unknown Track', [artist, when].filter(Boolean).join(' · ')));
        list.appendChild(li);
    });
    section.hidden = tracks.length === 0;
}

function renderAlbums(albums) {
    const section = document.querySelector('#recent-albums-section');
    const list = document.querySelector('#recent-albums');
    if (!section || !list) return;
    list.innerHTML = '';
    albums.forEach(album => {
        const li = document.createElement('li');
        li.title = `${album.getAttribute('title') || ''} - ${album.getAttribute('parentTitle') || ''}`;
        li.append(makeImage('album-cover', album.getAttribute('thumb'), 300), makeText(album.getAttribute('title') || 'Unknown Album', album.getAttribute('parentTitle') || ''));
        list.appendChild(li);
    });
    section.hidden = albums.length === 0;
}

// "5 minutes ago", "yesterday", or a date for anything older than a week
const relative = new Intl.RelativeTimeFormat('en', {
    numeric: 'auto'
});

function timeAgo(seconds) {
    if (!seconds) return '';
    const diff = seconds - Date.now() / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'just now';
    if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
    if (abs < 7 * 86400) return relative.format(Math.round(diff / 86400), 'day');
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
        day: 'numeric'
        , month: 'short'
    });
}
