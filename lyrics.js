// Fetches lyrics from Plex (Plex Pass) and scrolls them along with the track.
// Handles timed lyrics (LRC files, or Plex's XML with start offsets) and plain text.
import {
    plexFetchText, plexFetchXml
}
from './plex.js';

const LEAD_MS = 250; // Highlight a line slightly early so it doesn't feel late
const USER_SCROLL_PAUSE_MS = 5000; // Pause auto-scroll after the user scrolls

let lines = []; // [{ startMs, text, el }]
let timed = false;
let activeIndex = -1;
let loadToken = 0;
let pauseScrollUntil = 0;
let listenersAdded = false;

const getBox = () => document.querySelector('#lyrics');
// The panel around the lyrics (with the expand button); falls back to the lyrics box itself
const getPanel = () => document.querySelector('#lyrics-panel') || getBox();

export async function loadLyrics(track) {
    const token = ++loadToken;
    clear();
    if (!getBox()) return;
    try {
        // The session data sometimes includes the lyrics stream; if not, ask for the full track details
        let stream = pickLyricStream(track);
        if (!stream) {
            const ratingKey = track.getAttribute('ratingKey');
            if (!ratingKey) {
                hidePanel();
                return;
            }
            const metadata = await plexFetchXml(`/library/metadata/${ratingKey}`, {
                includeExternalMedia: 1
            });
            if (token !== loadToken) return;
            stream = pickLyricStream(metadata);
        }
        if (!stream) {
            hidePanel();
            return;
        }
        const key = stream.getAttribute('key') || `/library/streams/${stream.getAttribute('id')}`;
        const text = await plexFetchText(key);
        if (token !== loadToken) return; // The track changed while loading
        const parsed = parseLyrics(text);
        if (parsed.lines.some(line => line.text)) {
            render(parsed);
        }
        else {
            hidePanel();
        }
    }
    catch (error) {
        console.error('Could not load lyrics:', error);
        if (token === loadToken) hidePanel();
    }
}

export function resetLyrics() {
    loadToken++;
    clear();
    hidePanel();
}

// Called on every progress tick with the current position
export function syncLyrics(elapsedMs, durationMs) {
    const box = getBox();
    if (!box || !lines.length || Date.now() < pauseScrollUntil) return;
    if (!timed) {
        // Plain lyrics: scroll through them in step with the track
        const maxScroll = box.scrollHeight - box.clientHeight;
        if (maxScroll > 0 && durationMs > 0) {
            box.scrollTop = maxScroll * (elapsedMs / durationMs);
        }
        return;
    }
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startMs <= elapsedMs + LEAD_MS) index = i;
        else break;
    }
    if (index === activeIndex) return;
    if (activeIndex >= 0 && lines[activeIndex]) lines[activeIndex].el.classList.remove('active');
    activeIndex = index;
    if (index >= 0) lines[index].el.classList.add('active');
    scrollToActive();
}

// Keeps the active line in the middle of the lyrics box
function scrollToActive(behavior = 'smooth') {
    const box = getBox();
    if (!box || !timed) return;
    const el = activeIndex >= 0 && lines[activeIndex] ? lines[activeIndex].el : null;
    box.scrollTo({
        top: el ? el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2 : 0
        , behavior
    });
}

// --- Expanding the panel --------------------------------------------------
// Minimised, the panel is only a "Lyrics" button. Expanded, the lyrics cover the
// album title and everything below it; the track title and artist stay visible.
function setExpanded(expanded, recentre = true) {
    const panel = document.querySelector('#lyrics-panel');
    if (!panel) return;
    const sheet = panel.querySelector('.lyrics-sheet');
    const toggle = document.querySelector('#lyrics-toggle');
    // Keep the space the minimised button took, so nothing else moves when it opens
    if (expanded && !panel.classList.contains('expanded')) {
        panel.style.minHeight = `${panel.offsetHeight}px`;
    }
    else if (!expanded) {
        panel.style.minHeight = '';
    }
    panel.classList.toggle('expanded', expanded);
    if (sheet) {
        if (expanded) {
            // The sheet is positioned inside the info column, from the album title down
            const column = panel.closest('.album-info, .info') || panel.parentElement;
            const albumTitle = document.querySelector('#album-title');
            const anchor = albumTitle ? (albumTitle.closest('h3') || albumTitle) : null;
            const top = anchor ? anchor.getBoundingClientRect().top - column.getBoundingClientRect().top - column.clientTop : 0;
            sheet.style.top = `${Math.max(0, top)}px`;
        }
        else {
            sheet.style.top = '';
        }
    }
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Hide lyrics' : 'Show lyrics');
        toggle.title = expanded ? 'Hide lyrics' : 'Show lyrics';
    }
    // Jump to the current line as soon as the lyrics are visible
    if (expanded && recentre) requestAnimationFrame(() => scrollToActive('auto'));
}

function isExpanded() {
    const panel = document.querySelector('#lyrics-panel');
    return !!panel && panel.classList.contains('expanded');
}

(function setUpPanel() {
    const panel = document.querySelector('#lyrics-panel');
    if (!panel) return;
    // Click anywhere on the lyrics (or the button) to expand or collapse
    panel.addEventListener('click', () => {
        const selection = window.getSelection && window.getSelection().toString();
        if (selection) return; // Don't toggle when the user is selecting text
        setExpanded(!isExpanded());
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isExpanded()) setExpanded(false);
    });
    // Keep the expanded panel lined up with the album title when the layout changes
    // (window resized, up next appearing or disappearing, a longer title, ...)
    const realign = () => {
        if (isExpanded()) setExpanded(true, false);
    };
    window.addEventListener('resize', realign);
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(realign);
        observer.observe(panel);
        if (panel.parentElement) observer.observe(panel.parentElement);
    }
})();

function pickLyricStream(node) {
    const streams = Array.from(node.querySelectorAll('Stream[streamType="4"]'));
    return streams.find(s => s.getAttribute('timed') === '1') || streams.find(s => /lrc/i.test(`${s.getAttribute('format')} ${s.getAttribute('codec')}`)) || streams[0] || null;
}

function clear() {
    lines = [];
    timed = false;
    activeIndex = -1;
    const box = getBox();
    if (box) {
        box.innerHTML = '';
        box.scrollTop = 0;
    }
}

// Hides the panel (and collapses it) when there are no lyrics to show
function hidePanel() {
    setExpanded(false);
    const panel = getPanel();
    if (panel) panel.hidden = true;
}

function render(parsed) {
    const box = getBox();
    timed = parsed.timed;
    box.classList.toggle('timed', timed);
    box.innerHTML = '';
    lines = parsed.lines.map(line => {
        const el = document.createElement('div');
        el.className = 'lyric-line';
        // Empty timed lines are instrumental breaks; empty plain lines are verse gaps
        el.textContent = line.text || (timed ? '♪' : ' ');
        box.appendChild(el);
        return {
            ...line
            , el
        };
    });
    activeIndex = -1;
    getPanel().hidden = false;
    box.scrollTop = 0;
    if (!listenersAdded) {
        const pause = () => {
            pauseScrollUntil = Date.now() + USER_SCROLL_PAUSE_MS;
        };
        box.addEventListener('wheel', pause, {
            passive: true
        });
        box.addEventListener('touchstart', pause, {
            passive: true
        });
        listenersAdded = true;
    }
}

// --- Parsing --------------------------------------------------------------
export function parseLyrics(text) {
    const trimmed = (text || '').trim();
    if (trimmed.startsWith('<')) {
        const fromXml = parseXmlLyrics(trimmed);
        if (fromXml.lines.length) return fromXml;
    }
    const fromLrc = parseLrc(trimmed);
    if (fromLrc.lines.length) return fromLrc;
    return {
        timed: false
        , lines: trimmed.split(/\r?\n/).map(line => ({
            startMs: null
            , text: line.trim()
        }))
    };
}

function parseXmlLyrics(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return {
        timed: false
        , lines: []
    };
    const lines = Array.from(doc.querySelectorAll('Line')).map(line => {
        const spans = Array.from(line.querySelectorAll('Span'));
        const text = spans.length ? spans.map(s => s.getAttribute('text') || s.textContent).join(' ') : (line.getAttribute('text') || line.textContent);
        const start = line.getAttribute('startOffset');
        return {
            startMs: start !== null ? parseInt(start, 10) : null
            , text: (text || '').replace(/\s+/g, ' ').trim()
        };
    });
    const isTimed = lines.length > 0 && lines.every(line => Number.isFinite(line.startMs));
    if (isTimed) lines.sort((a, b) => a.startMs - b.startMs);
    return {
        timed: isTimed
        , lines
    };
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g; // Enhanced LRC word timings

function parseLrc(text) {
    let offsetMs = 0;
    const lines = [];
    for (const raw of text.split(/\r?\n/)) {
        const offsetTag = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
        if (offsetTag) {
            offsetMs = parseInt(offsetTag[1], 10);
            continue;
        }
        const tags = [...raw.matchAll(TIME_TAG)];
        if (!tags.length) continue;
        const lyric = raw.replace(TIME_TAG, '').replace(WORD_TAG, '').trim();
        // A line can carry several timestamps when it repeats (e.g. a chorus)
        for (const tag of tags) {
            const fraction = tag[3] ? parseInt(tag[3].padEnd(3, '0'), 10) : 0;
            lines.push({
                startMs: (parseInt(tag[1], 10) * 60 + parseInt(tag[2], 10)) * 1000 + fraction
                , text: lyric
            });
        }
    }
    // A positive LRC offset means the lyrics should appear sooner
    lines.forEach(line => {
        line.startMs = Math.max(0, line.startMs - offsetMs);
    });
    lines.sort((a, b) => a.startMs - b.startMs);
    return {
        timed: lines.length > 0
        , lines
    };
}
