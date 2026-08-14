import {
    plexApiKey, plexServerUrl
}
from './apikey.js';
let realOffset = 0; // Initialize realOffset globally
let lastViewOffset = 0;
let lastTrackData = null;
let trackStartTime = 0;
let trackStartOffset = 0;
let trackDurationInSeconds = 0;
let intervalId; // Store the interval ID to clear it later
async function fetchNowPlaying() {
    const url = `${plexServerUrl}/status/sessions?X-Plex-Token=${plexApiKey}`;
    console.log(`Session URL: ${url}`);
    try {
        const response = await fetch(url);
        const text = await response.text();
        console.log(text);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "application/xml");
        const allTracks = Array.from(xmlDoc.querySelectorAll('Track'));
        // Build the list of active sessions (one per player)
        const sessions = allTracks.map(t => {
            const player = t.querySelector('Player');
            return {
                track: t
                , player: player
                , machineIdentifier: player ? player.getAttribute('machineIdentifier') : null
                , title: player ? player.getAttribute('title') : 'Unknown Player'
            };
        }).filter(s => s.machineIdentifier);
        updatePlayerDropdown(sessions);
        const selectedId = localStorage.getItem('selectedPlayerId');
        let chosen = sessions.find(s => s.machineIdentifier === selectedId);
        // Fall back to the first available session if the saved player isn't active right now
        if (!chosen && sessions.length > 0) {
            chosen = sessions[0];
        }
        if (chosen) {
            const track = chosen.track;
            const player = chosen.player;
            const viewOffset = track.getAttribute('viewOffset');
            const newViewOffset = parseInt(viewOffset, 10) || 0;
            if (newViewOffset !== lastViewOffset) {
                realOffset = newViewOffset / 1000;
                lastViewOffset = newViewOffset;
                console.log('Updated viewOffset:', realOffset);
                if (intervalId) {
                    clearInterval(intervalId);
                }
                intervalId = setInterval(() => {
                    realOffset += 1;
                    console.log('realOffset incremented to:', realOffset);
                }, 1000);
            }
            const trackDuration = track.getAttribute('duration');
            if (trackDuration) {
                trackDurationInSeconds = Math.floor(trackDuration / 1000);
                console.log('Track duration updated:', trackDurationInSeconds);
            }
            const artist = track.getAttribute('originalTitle');
            const albumArtist = track.getAttribute('grandparentTitle');
            console.log('album artist: ', albumArtist)
            const album = track.getAttribute('parentTitle');
            const trackTitle = track.getAttribute('title');
            const albumArt = `${plexServerUrl}/library/metadata/${track.getAttribute('parentRatingKey')}/thumb/${track.getAttribute('thumb').split('/').pop()}?X-Plex-Token=${plexApiKey}`;
            const albumYear = track.getAttribute('parentYear');
            const trackUrl = `${plexServerUrl}${track.getAttribute('key')}?X-Plex-Token=${plexApiKey}`;
            const audioInfo = track.querySelector('Media > Part > Stream');
            const audioBitDepth = audioInfo ? audioInfo.getAttribute('bitDepth') : 'Unknown';
            const audioBitrate = audioInfo ? audioInfo.getAttribute('bitrate') : 'Unknown';
            const samplingRate = audioInfo ? audioInfo.getAttribute('samplingRate') : 'Unknown';
            const audioCodec = audioInfo ? audioInfo.getAttribute('codec') : 'Unknown';
            const playerTitle = player ? player.getAttribute('title') : 'Unknown Player';
            // External service search URLs
            const AOTYartistSearchLink = `https://www.albumoftheyear.org/search/albums/?q=${encodeURIComponent(album)}`;
            const lastFMartistSearchLink = `https://www.last.fm/search/albums?q=${encodeURIComponent(album)}`;
            const discogsArtistLink = `https://www.discogs.com/search/?q=${encodeURIComponent(album)}&type=release`;
            const geniusSearchLink = `https://genius.com/search?q=${encodeURIComponent(trackTitle + ' ' + (albumArtist || ''))}`;
            console.log(AOTYartistSearchLink);
            console.log(lastFMartistSearchLink);
            console.log(discogsArtistLink);
            console.log(geniusSearchLink);
            // Update the music connections paragraph with the links and icons
            const musicConnectionsParagraph = document.querySelector('#music-connections');
            musicConnectionsParagraph.innerHTML = `
  <a href="${AOTYartistSearchLink}" target="_blank"><img src="images/aoty.png" alt="AOTY" class="music-icon"/></a><a href="${lastFMartistSearchLink}" target="_blank"><img src="images/last.fm.png" alt="Last.fm" class="music-icon"/></a><a href="${discogsArtistLink}" target="_blank"><img src="images/discogs.png" alt="Discogs" class="music-icon"/></a><a href="${geniusSearchLink}" target="_blank"><img src="images/genius.png" alt="Genius" class="music-icon"/></a>
`;
            const currentTrackData = {
                albumArtist, artist, album, trackTitle, albumArt, albumYear, trackDuration, trackUrl, audioBitDepth, audioBitrate, audioCodec, playerTitle
            };
            if (hasTrackChanged(currentTrackData)) {
                trackStartTime = 0;
                trackStartOffset = 0;
                document.querySelector('#track-title').textContent = trackTitle.slice(0, 40);
                document.querySelector('#track-artist').textContent = albumArtist;
                document.querySelector('#album-title').textContent = album;
                document.querySelector('#album-year').textContent = albumYear;
                const albumArtElement = document.querySelector('#album-art');
                albumArtElement.classList.remove('loaded');
                albumArtElement.src = albumArt;
                albumArtElement.onload = () => {
                    albumArtElement.classList.add('loaded');
                };
                getDominantColor(albumArt);
                const formattedSamplingRate = samplingRate !== 'Unknown' ? Math.floor(samplingRate / 1000) : 'Unknown';
                const formattedAudioInfo = `${formattedSamplingRate}/${audioBitDepth}, ${audioBitrate}kbps ${audioCodec}`;
                document.querySelector('#audio-info').textContent = formattedAudioInfo;
                document.title = `${trackTitle} - ${albumArtist}`;
                lastTrackData = currentTrackData;
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: trackTitle
                        , artist: albumArtist
                        , album: album
                        , artwork: [
                            {
                                src: albumArt
                                , sizes: '512x512'
                                , type: 'image/jpeg'
                            }
                        ]
                    });
                    navigator.mediaSession.setActionHandler('play', () => {});
                    navigator.mediaSession.setActionHandler('pause', () => {});
                }
            }
        }
        else {
            resetNowPlaying();
        }
    }
    catch (error) {
        console.error('Error fetching now playing data:', error);
        resetNowPlaying();
    }
}

function updatePlayerDropdown(sessions) {
    const select = document.querySelector('#player-select');
    if (!select) return;
    const currentValue = select.value || localStorage.getItem('selectedPlayerId') || '';
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
        localStorage.setItem('selectedPlayerId', e.target.value);
        // Force an immediate refresh with the new selection, instead of waiting for the next poll
        lastTrackData = null;
        fetchNowPlaying();
    }
});
const savedTrackStartTime = localStorage.getItem('trackStartTime');
if (savedTrackStartTime) {
    trackStartTime = parseInt(savedTrackStartTime);
    console.log('Track start time retrieved from localStorage:', trackStartTime);
}
else {
    trackStartTime = Date.now();
    localStorage.setItem('trackStartTime', trackStartTime);
    console.log('Track start time set to current time:', trackStartTime);
}

function progressTimer() {
    console.log('realOffset is:', realOffset);
    console.log('Track duration is:', trackDurationInSeconds);
    if (trackDurationInSeconds > 0) {
        const elapsedTime = Math.floor(realOffset);
        const elapsedMinutes = Math.floor(elapsedTime / 60);
        const elapsedSeconds = elapsedTime % 60;
        const formattedElapsedTime = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
        const totalMinutes = Math.floor(trackDurationInSeconds / 60);
        const totalSeconds = trackDurationInSeconds % 60;
        const formattedTotalDuration = `${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
        const trackRemainingElement = document.querySelector('#track-remaining');
        trackRemainingElement.textContent = `${formattedElapsedTime} / ${formattedTotalDuration}`;
        const progressPercentage = (elapsedTime / trackDurationInSeconds) * 100;
        const progressBar = document.querySelector('#progress-bar');
        progressBar.style.width = `${progressPercentage}%`;
    }
    else {
        console.log('Track duration is not available');
    }
}

function hasTrackChanged(currentTrackData) {
    if (!lastTrackData) {
        return true;
    }
    return Object.keys(currentTrackData).some(key => currentTrackData[key] !== lastTrackData[key]);
}
window.toggleFullscreen = function () {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
    else {
        document.documentElement.requestFullscreen();
    }
};

function resetNowPlaying() {
    document.querySelector('#track-title').textContent = 'No track playing';
    document.querySelector('#track-artist').textContent = 'Unknown Artist';
    document.querySelector('#album-title').textContent = 'Unknown Album';
    document.querySelector('#album-year').textContent = '----';
    document.querySelector('#track-remaining').textContent = '0:00/0:00';
    document.querySelector('#album-art').src = 'images/no_song.png';
    document.querySelector('#audio-info').textContent = 'No audio information available';
    document.title = 'Plex Now Playing';
}
setInterval(progressTimer, 1000);
setInterval(fetchNowPlaying, 900);
import {
    getDominantColor
}
from './getColour.js';
fetchNowPlaying();