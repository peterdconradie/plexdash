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
    try {
        const response = await fetch(url);
        const text = await response.text();
        console.log(text); // Log raw XML data for debugging
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "application/xml");
        const track = xmlDoc.querySelector('Track');
        const player = xmlDoc.querySelector('Player'); // Get the Player element
        if (track) {
            const viewOffset = track.getAttribute('viewOffset');
            const newViewOffset = parseInt(viewOffset, 10) || 0;
            // Only reset realOffset if a new viewOffset is received
            if (newViewOffset !== lastViewOffset) {
                realOffset = newViewOffset / 1000; // Convert to seconds
                lastViewOffset = newViewOffset;
                console.log('Updated viewOffset:', realOffset);
                // Clear the previous interval if it exists
                if (intervalId) {
                    clearInterval(intervalId);
                }
                // Start a new interval to increment realOffset by 1 second every second
                intervalId = setInterval(() => {
                    realOffset += 1;
                    console.log('realOffset incremented to:', realOffset);
                }, 1000);
            }
            // Ensure that track duration is updated here
            const trackDuration = track.getAttribute('duration'); // Duration in ms
            if (trackDuration) {
                trackDurationInSeconds = Math.floor(trackDuration / 1000); // Convert to seconds
                console.log('Track duration updated:', trackDurationInSeconds);
            }
            // Handle the track and player data
            const artist = track.getAttribute('grandparentTitle');
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
            const AOTYartistSearchLink = `https://www.albumoftheyear.org/search/artists/?q=${encodeURIComponent(artist)}`;
            const lastFMartistSearchLink = `https://www.last.fm/music/${encodeURIComponent(artist)}`;
            const discogsArtistLink = `https://www.discogs.com/search/?q=${encodeURIComponent(artist)}&type=artist`;
            console.log(AOTYartistSearchLink);
            console.log(lastFMartistSearchLink);
            console.log(discogsArtistLink);
            // Find the music-connections paragraph
            const musicConnectionsParagraph = document.querySelector('#music-connections');
            // Update the content of the paragraph with the search links and images
            musicConnectionsParagraph.innerHTML = `
  <a href="${AOTYartistSearchLink}" target="_blank"><img src="images/aoty.png" alt="AOTY" class="music-icon"/></a><a href="${lastFMartistSearchLink}" target="_blank"><img src="images/last.fm.png" alt="Last.fm" class="music-icon"/></a><a href="${discogsArtistLink}" target="_blank"><img src="images/discogs.png" alt="Discogs" class="music-icon"/></a>
`;
            const currentTrackData = {
                artist, album, trackTitle, albumArt, albumYear, trackDuration, trackUrl, audioBitDepth, audioBitrate, audioCodec, playerTitle
            };
            if (hasTrackChanged(currentTrackData)) {
                trackStartTime = 0; // Reset on track change
                trackStartOffset = 0;
                document.querySelector('#track-title').textContent = trackTitle.slice(0, 40);
                document.querySelector('#track-artist').textContent = artist;
                document.querySelector('#album-title').textContent = album;
                document.querySelector('#album-year').textContent = albumYear;
                document.querySelector('#album-art').src = albumArt;
                // this runs the function to get the album art dominant color
                getDominantColor(albumArt);
                const formattedSamplingRate = samplingRate !== 'Unknown' ? Math.floor(samplingRate / 1000) : 'Unknown';
                const formattedAudioInfo = `${formattedSamplingRate}/${audioBitDepth}, ${audioBitrate}kbps ${audioCodec}`;
                document.querySelector('#audio-info').textContent = `${formattedAudioInfo} playing on ${playerTitle}`;
                document.title = `${trackTitle} - ${artist}`;
                lastTrackData = currentTrackData;
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
// Function to log the remaining time and update the HTML
// Retrieve the saved track start time from localStorage
const savedTrackStartTime = localStorage.getItem('trackStartTime');
// Log the retrieved value (if it exists)
if (savedTrackStartTime) {
    trackStartTime = parseInt(savedTrackStartTime); // Use saved value if it exists
    console.log('Track start time retrieved from localStorage:', trackStartTime);
}
else {
    trackStartTime = Date.now(); // If no saved value, use current time
    localStorage.setItem('trackStartTime', trackStartTime); // Save it for later
    console.log('Track start time set to current time:', trackStartTime);
}
// Function to log the remaining time and update the HTML
function progressTimer() {
    console.log('realOffset is:', realOffset); // Log the current realOffset
    console.log('Track duration is:', trackDurationInSeconds);
    // If the track duration is valid and realOffset is available, update the display
    if (trackDurationInSeconds > 0) {
        // Calculate the elapsed time based on realOffset (in seconds)
        const elapsedTime = Math.floor(realOffset); // Round to nearest second
        // Convert elapsed time to MM:SS format
        const elapsedMinutes = Math.floor(elapsedTime / 60);
        const elapsedSeconds = elapsedTime % 60;
        const formattedElapsedTime = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
        // Convert total track duration to MM:SS format
        const totalMinutes = Math.floor(trackDurationInSeconds / 60);
        const totalSeconds = trackDurationInSeconds % 60;
        const formattedTotalDuration = `${totalMinutes}:${totalSeconds.toString().padStart(2, '0')}`;
        // Update the track-remaining span with the elapsed time and total track duration
        const trackRemainingElement = document.querySelector('#track-remaining');
        trackRemainingElement.textContent = `${formattedElapsedTime} / ${formattedTotalDuration}`;
        // Calculate the progress as a percentage
        const progressPercentage = (elapsedTime / trackDurationInSeconds) * 100;
        // Update the progress bar width
        const progressBar = document.querySelector('#progress-bar');
        progressBar.style.width = `${progressPercentage}%`; // Update the width based on the progress percentage
    }
    else {
        console.log('Track duration is not available');
    }
}
// Helper function to format seconds into "minutes:seconds"
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
// Helper function to format seconds into "minutes:seconds"
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
    document.querySelector('#track-remaining').textContent = '0:00/0:00'; // Default time
    document.querySelector('#album-art').src = 'images/no_song.png'; // Path to a default image
    document.querySelector('#audio-info').textContent = 'No audio information available';
    document.title = 'Plex Now Playing';
}
setInterval(progressTimer, 1000); // Call progressTimer every second
setInterval(fetchNowPlaying, 900);
import {
    getDominantColor
}
from './getColour.js';
fetchNowPlaying();