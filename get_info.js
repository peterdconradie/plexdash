import {
    plexUrl, plexFetchXml, plexThumbUrl
}
from './plex.js';
import {
    getDominantColor
}
from './getColour.js';
import {
    loadLyrics, resetLyrics, syncLyrics
}
from './lyrics.js';
import {
    loadUpNext, hideUpNext
}
from './upnext.js';
import {
    connectNotifications
}
from './notifications.js';
import {
    showIdle, hideIdle
}
from './idle.js';

// --- Settings -------------------------------------------------------------
const POLL_INTERVAL_MS = 2000; // How often Plex is asked what is playing
const TICK_INTERVAL_MS = 250; // How often the time, progress bar and lyrics are updated
const MAX_FAILED_POLLS = 3; // Failed polls in a row before the screen is cleared
const MAX_TITLE_LENGTH = 40;
const SHOW_LYRICS = true; // Synced lyrics (needs Plex Pass)
const SHOW_UP_NEXT = true; // The next tracks in the play queue
const SHOW_IDLE_SCREEN = true; // Recently played and recently added when nothing is playing
const LIVE_UPDATES = true; // Use Plex's live notifications for instant pause/track changes
const DEBUG = false; // Set to true to log poll results to the console
const log = (...args) => {
    if (DEBUG) console.log(...args);
};

// --- State ----------------------------------------------------------------
// Playback position is worked out from the last offset Plex reported plus the
// time that has passed since then (only while the player is actually playing).
const playback = {
    active: false
    , isPlaying: false
    , offsetMs: 0 // Last offset reported by Plex
    , reportedAt: 0 // When that offset was first seen
    , durationMs: 0
};
let currentTrackKey = null; // Identifies the track currently on screen
let current = {
    machineId: null
    , ratingKey: null
    , sessionKey: null
    , queueID: null
    , queueItemID: null
};
// Play queue details from live notifications, by player ID and by session key
const queueByPlayer = new Map();
const queueBySession = new Map();
let currentArtUrl = '';
let failedPolls = 0;
let pollInProgress = false;

// localStorage can throw (private mode, blocked storage), so wrap it
function loadSetting(key) {
    try {
        return localStorage.getItem(key);
    }
    catch (e) {
        return null;
    }
}

function saveSetting(key, value) {
    try {
        localStorage.setItem(key, value);
    }
    catch (e) {
        /* ignore */
    }
}

// --- Polling --------------------------------------------------------------
async function fetchNowPlaying() {
    if (pollInProgress) return;
    pollInProgress = true;
    try {
        const xmlDoc = await plexFetchXml('/status/sessions');
        log(new XMLSerializer().serializeToString(xmlDoc));
        failedPolls = 0;
        const sessions = Array.from(xmlDoc.querySelectorAll('Track')).map(track => {
            const player = track.querySelector('Player');
            return {
                track
                , player
                , machineIdentifier: player ? player.getAttribute('machineIdentifier') : null
                , title: player ? (player.getAttribute('title') || 'Unknown Player') : 'Unknown Player'
            };
        }).filter(s => s.machineIdentifier);
        updatePlayerDropdown(sessions);
        const selectedId = loadSetting('selectedPlayerId');
        // Fall back to the first active session if the saved player isn't playing right now
        const chosen = sessions.find(s => s.machineIdentifier === selectedId) || sessions[0];
        if (chosen) {
            showSession(chosen);
        }
        else {
            resetNowPlaying();
        }
    }
    catch (error) {
        failedPolls += 1;
        console.error(`Error fetching now playing data (attempt ${failedPolls}):`, error);
        // Don't clear the screen on a single network hiccup
        if (failedPolls >= MAX_FAILED_POLLS) {
            resetNowPlaying();
        }
    }
    finally {
        pollInProgress = false;
    }
}

function showSession({
    track, player, machineIdentifier
}) {
    const ratingKey = track.getAttribute('ratingKey') || track.getAttribute('key');
    const trackKey = `${machineIdentifier}:${ratingKey}`;
    const trackChanged = trackKey !== currentTrackKey;
    current.machineId = machineIdentifier;
    current.ratingKey = ratingKey;
    current.sessionKey = track.getAttribute('sessionKey');
    // Some servers include the play queue in the session data; otherwise it comes from live notifications
    if (track.getAttribute('playQueueID')) {
        current.queueID = track.getAttribute('playQueueID');
        current.queueItemID = track.getAttribute('playQueueItemID');
    }

    hideIdle();
    playback.durationMs = parseInt(track.getAttribute('duration'), 10) || 0;
    applyPlaybackReport(parseInt(track.getAttribute('viewOffset'), 10) || 0, (player.getAttribute('state') || 'playing') === 'playing', trackChanged);
    playback.active = true;

    if (trackChanged) {
        currentTrackKey = trackKey;
        drawTrack(track, player);
        if (SHOW_LYRICS) loadLyrics(track);
    }
    updateUpNext();
    updateProgress();
}

// Restart the clock only when Plex reports something new, so the local
// count is not thrown away on polls where Plex hasn't updated the offset yet
function applyPlaybackReport(offsetMs, isPlaying, force = false) {
    if (force || offsetMs !== playback.offsetMs || isPlaying !== playback.isPlaying) {
        playback.offsetMs = offsetMs;
        playback.reportedAt = Date.now();
    }
    playback.isPlaying = isPlaying;
}

function updateUpNext() {
    if (!SHOW_UP_NEXT) return;
    const fromNotifications = queueByPlayer.get(current.machineId) || queueBySession.get(current.sessionKey);
    // Only trust notification data that belongs to the track on screen
    if (fromNotifications && fromNotifications.ratingKey === current.ratingKey) {
        current.queueID = fromNotifications.playQueueID;
        current.queueItemID = fromNotifications.playQueueItemID;
    }
    loadUpNext({
        playQueueID: current.queueID
        , playQueueItemID: current.queueItemID
        , ratingKey: current.ratingKey
    });
}

// Handles a live "playing" notification from Plex
function handlePlayNotification(notification) {
    const info = {
        playQueueID: notification.playQueueID ? String(notification.playQueueID) : null
        , playQueueItemID: notification.playQueueItemID ? String(notification.playQueueItemID) : null
        , ratingKey: notification.ratingKey ? String(notification.ratingKey) : null
    };
    if (notification.clientIdentifier) queueByPlayer.set(notification.clientIdentifier, info);
    if (notification.sessionKey) queueBySession.set(String(notification.sessionKey), info);
    log('Plex notification:', notification);
    const isCurrentPlayer = notification.clientIdentifier ? notification.clientIdentifier === current.machineId : String(notification.sessionKey) === current.sessionKey;
    if (!playback.active) {
        fetchNowPlaying(); // Something started playing
        return;
    }
    if (!isCurrentPlayer) return; // Other players are picked up by the regular poll
    if (info.ratingKey === current.ratingKey && notification.state !== 'stopped' && Number.isFinite(notification.viewOffset)) {
        // Same track: apply pause/resume and the new position straight away
        applyPlaybackReport(notification.viewOffset, notification.state === 'playing');
        updateUpNext();
        updateProgress();
    }
    else {
        // New track or stopped: refresh now instead of waiting for the next poll
        fetchNowPlaying();
    }
}

function drawTrack(track, player) {
    const albumArtist = track.getAttribute('grandparentTitle') || 'Unknown Artist';
    const album = track.getAttribute('parentTitle') || 'Unknown Album';
    const trackTitle = track.getAttribute('title') || 'Unknown Track';
    const albumYear = track.getAttribute('parentYear') || '----';
    const thumbPath = track.getAttribute('parentThumb') || track.getAttribute('thumb') || track.getAttribute('grandparentThumb');
    const albumArt = thumbPath ? plexUrl(thumbPath) : 'images/no_song.png';
    // The browser tab shows the cover of what's playing (a small version from Plex)
    setFavicon(thumbPath ? plexThumbUrl(thumbPath, 64) : null);

    // Prefer the audio stream (streamType 2); fall back to the first stream
    const audioInfo = track.querySelector('Media > Part > Stream[streamType="2"]') || track.querySelector('Media > Part > Stream');
    const media = track.querySelector('Media');
    const samplingRate = audioInfo && audioInfo.getAttribute('samplingRate');
    const bitDepth = audioInfo && audioInfo.getAttribute('bitDepth');
    const bitrate = (audioInfo && audioInfo.getAttribute('bitrate')) || (media && media.getAttribute('bitrate'));
    const codec = (audioInfo && audioInfo.getAttribute('codec')) || (media && media.getAttribute('audioCodec'));

    document.querySelector('#track-title').textContent = trackTitle.length > MAX_TITLE_LENGTH ? `${trackTitle.slice(0, MAX_TITLE_LENGTH - 1)}…` : trackTitle;
    document.querySelector('#track-title').title = trackTitle;
    document.querySelector('#track-artist').textContent = albumArtist;
    document.querySelector('#album-title').textContent = album;
    document.querySelector('#album-year').textContent = albumYear;

    const albumArtElement = document.querySelector('#album-art');
    albumArtElement.classList.remove('loaded');
    albumArtElement.onload = () => {
        albumArtElement.classList.add('loaded');
    };
    albumArtElement.src = albumArt;

    // Only apply the colour if this album is still on screen when it is ready
    currentArtUrl = albumArt;
    getDominantColor(albumArt).then(color => {
        if (albumArt === currentArtUrl) {
            setProgressColor(color);
        }
    });

    const quality = [samplingRate ? Math.floor(samplingRate / 1000) : null, bitDepth].filter(Boolean).join('/');
    const parts = [quality, bitrate ? `${bitrate}kbps` : null, codec].filter(Boolean);
    document.querySelector('#audio-info').textContent = parts.length ? parts.join(', ').replace(/, (\S+)$/, ' $1') : 'No audio information available';

    // External search links (rebuilt only when the track changes)
    const links = [
        ['aoty.png', 'AOTY', `https://www.albumoftheyear.org/search/albums/?q=${encodeURIComponent(album)}`]
        , ['last.fm.png', 'Last.fm', `https://www.last.fm/search/albums?q=${encodeURIComponent(album)}`]
        , ['discogs.png', 'Discogs', `https://www.discogs.com/search/?q=${encodeURIComponent(album)}&type=release`]
        , ['genius.png', 'Genius', `https://genius.com/search?q=${encodeURIComponent(`${trackTitle} ${albumArtist}`)}`]
    ];
    const connections = document.querySelector('#music-connections');
    if (connections) {
        connections.innerHTML = links.map(([icon, name, href]) => `<a href="${href}" target="_blank" rel="noopener"><img src="images/${icon}" alt="${name}" class="music-icon"/></a>`).join('');
    }

    document.title = `${trackTitle} - ${albumArtist}`;
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle
            , artist: albumArtist
            , album: album
            , artwork: [{
                src: albumArt
                , sizes: '512x512'
                , type: 'image/jpeg'
            }]
        });
        navigator.mediaSession.setActionHandler('play', () => {});
        navigator.mediaSession.setActionHandler('pause', () => {});
    }
}

// --- Progress -------------------------------------------------------------
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

function updateProgress() {
    if (!playback.active || playback.durationMs <= 0) return;
    let elapsedMs = playback.offsetMs;
    if (playback.isPlaying) {
        elapsedMs += Date.now() - playback.reportedAt;
    }
    elapsedMs = Math.min(Math.max(elapsedMs, 0), playback.durationMs);
    setTimes(formatTime(elapsedMs), formatTime(playback.durationMs), `-${formatTime(playback.durationMs - elapsedMs)}`);
    setPlayState(playback.isPlaying ? 'playing' : 'paused');
    document.querySelector('#progress-bar').style.width = `${(elapsedMs / playback.durationMs) * 100}%`;
    if (SHOW_LYRICS) syncLyrics(elapsedMs, playback.durationMs);
}

// Fills in whichever time fields the page has (elapsed / remaining, or "elapsed / total")
function setTimes(elapsed, total, remaining) {
    const set = (selector, text) => {
        const el = document.querySelector(selector);
        if (el) el.textContent = text;
    };
    set('#time-elapsed', elapsed);
    set('#time-remaining', remaining);
    set('#track-remaining', `${elapsed} / ${total}`);
}

// Sets the browser tab icon: an album cover, or the equaliser icon when given null
const FALLBACK_ICON = 'images/favicon.svg';

function setFavicon(url) {
    const link = document.querySelector('#favicon');
    if (!link) return;
    const href = url || FALLBACK_ICON;
    if (link.getAttribute('href') === href) return;
    link.type = url ? 'image/jpeg' : 'image/svg+xml';
    link.href = href;
}

// The play/pause symbol in the title bar
function setPlayState(state) {
    const el = document.querySelector('#play-state');
    if (el) el.className = `play-state ${state}`;
}

function setProgressColor(color) {
    const progressBar = document.querySelector('#progress-bar');
    if (progressBar) {
        progressBar.style.backgroundColor = color;
    }
}

// --- Player selection -----------------------------------------------------
function updatePlayerDropdown(sessions) {
    const select = document.querySelector('#player-select');
    if (!select) return;
    const currentValue = select.value || loadSetting('selectedPlayerId') || '';
    // Only rebuild the option list if the set of active players changed, to avoid flicker
    const newIds = sessions.map(s => s.machineIdentifier).join(',');
    if (select.dataset.ids === newIds) return;
    select.dataset.ids = newIds;
    select.innerHTML = '';
    if (sessions.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No players active';
        select.appendChild(option);
        return;
    }
    sessions.forEach(s => {
        const option = document.createElement('option');
        option.value = s.machineIdentifier;
        option.textContent = s.title;
        select.appendChild(option);
    });
    if (sessions.some(s => s.machineIdentifier === currentValue)) {
        select.value = currentValue;
    }
}
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'player-select') {
        saveSetting('selectedPlayerId', e.target.value);
        // Force a redraw with the new selection instead of waiting for the next poll
        currentTrackKey = null;
        fetchNowPlaying();
    }
});

// --- Misc -----------------------------------------------------------------
window.toggleFullscreen = function () {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
    else {
        document.documentElement.requestFullscreen();
    }
};

function resetNowPlaying() {
    // Forget the current track so it is redrawn as soon as it comes back
    currentTrackKey = null;
    currentArtUrl = '';
    current = {
        machineId: null
        , ratingKey: null
        , sessionKey: null
        , queueID: null
        , queueItemID: null
    };
    resetLyrics();
    hideUpNext();
    playback.active = false;
    playback.isPlaying = false;
    playback.offsetMs = 0;
    playback.durationMs = 0;
    document.querySelector('#track-title').textContent = 'Nothing playing';
    document.querySelector('#track-title').title = '';
    document.querySelector('#track-artist').textContent = 'Unknown Artist';
    document.querySelector('#album-title').textContent = 'Unknown Album';
    document.querySelector('#album-year').textContent = '----';
    setTimes('0:00', '0:00', '-0:00');
    setPlayState('stopped');
    document.querySelector('#progress-bar').style.width = '0%';
    const albumArtElement = document.querySelector('#album-art');
    if (!albumArtElement.src.endsWith('images/no_song.png')) {
        albumArtElement.src = 'images/no_song.png';
    }
    // The art fades in once loaded; make sure the placeholder is visible too
    albumArtElement.classList.add('loaded');
    document.querySelector('#audio-info').textContent = 'No audio information available';
    const connections = document.querySelector('#music-connections');
    if (connections) connections.innerHTML = '';
    document.title = 'Plex Now Playing';
    setFavicon(null);
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
    }
    if (SHOW_IDLE_SCREEN) showIdle();
}

// --- Start ----------------------------------------------------------------
setInterval(updateProgress, TICK_INTERVAL_MS);
setInterval(fetchNowPlaying, POLL_INTERVAL_MS);
fetchNowPlaying();
if (LIVE_UPDATES) connectNotifications(handlePlayNotification);
