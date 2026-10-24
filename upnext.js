// Shows the next tracks in the player's play queue.
import {
    plexFetchXml, plexThumbUrl
}
from './plex.js';

const UP_NEXT_COUNT = 2; // How many upcoming tracks to show
const THUMB_SIZE = 96;

let loadToken = 0;
let lastRequest = '';

export async function loadUpNext({
    playQueueID, playQueueItemID, ratingKey
}) {
    const box = document.querySelector('#up-next');
    if (!box) return;
    if (!playQueueID) {
        hideUpNext();
        return;
    }
    // Only fetch again when the queue, queue position or track changes
    const requestKey = `${playQueueID}:${playQueueItemID || ''}:${ratingKey || ''}`;
    if (requestKey === lastRequest) return;
    lastRequest = requestKey;
    const token = ++loadToken;
    try {
        const params = {
            window: UP_NEXT_COUNT + 5
        };
        if (playQueueItemID) params.center = playQueueItemID;
        const xml = await plexFetchXml(`/playQueues/${playQueueID}`, params);
        if (token !== loadToken) return;
        const container = xml.querySelector('MediaContainer');
        const items = container ? Array.from(container.children).filter(item => item.hasAttribute('playQueueItemID')) : [];
        const selectedId = String(playQueueItemID || (container && container.getAttribute('playQueueSelectedItemID')) || '');
        let index = items.findIndex(item => item.getAttribute('playQueueItemID') === selectedId);
        // If the queue position is out of date, find the playing track by its ID instead
        if (ratingKey && (index === -1 || items[index].getAttribute('ratingKey') !== ratingKey)) {
            const byTrack = items.findIndex(item => item.getAttribute('ratingKey') === ratingKey);
            if (byTrack !== -1) index = byTrack;
        }
        const next = index === -1 ? [] : items.slice(index + 1, index + 1 + UP_NEXT_COUNT);
        render(next);
        // "3 of 12": work out the position from the queue's selected item and its offset
        const total = parseInt(container.getAttribute('playQueueTotalCount'), 10);
        const selectedOffset = parseInt(container.getAttribute('playQueueSelectedItemOffset'), 10);
        const selectedIndex = items.findIndex(item => item.getAttribute('playQueueItemID') === container.getAttribute('playQueueSelectedItemID'));
        if (index !== -1 && selectedIndex !== -1 && Number.isFinite(total) && Number.isFinite(selectedOffset)) {
            setQueuePosition(`${selectedOffset + (index - selectedIndex) + 1} of ${total}`);
        }
        else {
            setQueuePosition('');
        }
    }
    catch (error) {
        // A queue can disappear when another app starts its own; just hide the section
        console.error('Could not load the play queue:', error);
        if (token === loadToken) {
            render([]);
            setQueuePosition('');
        }
    }
}

export function hideUpNext() {
    loadToken++;
    lastRequest = '';
    render([]);
    setQueuePosition('');
}

function setQueuePosition(text) {
    const el = document.querySelector('#queue-position');
    if (el) el.textContent = text;
}

function render(items) {
    const box = document.querySelector('#up-next');
    const list = document.querySelector('#up-next-list');
    if (!box || !list) return;
    list.innerHTML = '';
    items.forEach(item => {
        const li = document.createElement('li');
        const thumbPath = item.getAttribute('parentThumb') || item.getAttribute('thumb') || item.getAttribute('grandparentThumb');
        const img = document.createElement('img');
        img.className = 'up-next-art';
        img.alt = '';
        img.src = thumbPath ? plexThumbUrl(thumbPath, THUMB_SIZE) : 'images/no_song.png';
        const text = document.createElement('div');
        text.className = 'up-next-text';
        const title = document.createElement('span');
        title.className = 'up-next-title';
        title.textContent = item.getAttribute('title') || 'Unknown Track';
        const artist = document.createElement('span');
        artist.className = 'up-next-artist';
        artist.textContent = item.getAttribute('originalTitle') || item.getAttribute('grandparentTitle') || '';
        text.append(title, artist);
        li.append(img, text);
        list.appendChild(li);
    });
    box.hidden = items.length === 0;
}
