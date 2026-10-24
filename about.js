// "About" panel: artist and album background from MusicBrainz and Wikipedia,
// with Plex's own descriptions as a fallback. Ported from dash.fm.
// Minimised it is a small "About" button; expanded, it covers the album title
// and everything below it, like the lyrics panel.
import {
    plexFetchXml, plexThumbUrl
}
from './plex.js';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_MIN_GAP_MS = 1100; // MusicBrainz allows about one request per second
const WIKI_LANG = 'en';
const ARTIST_THUMB_SIZE = 160;

let loadToken = 0;
const artistCache = new Map(); // By Plex artist ratingKey or name
const albumCache = new Map(); // By Plex album ratingKey or artist + title

// --- Small helpers --------------------------------------------------------
const $ = (selector) => document.querySelector(selector);

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;'
        , '<': '&lt;'
        , '>': '&gt;'
        , '"': '&quot;'
        , "'": '&#39;'
    })[c]);
}

// Compare titles loosely: case, accents, punctuation and "(Remastered)" etc. are ignored
function normalise(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function luceneQuote(str) {
    return '"' + String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Queue MusicBrainz calls so they stay under the rate limit
let mbQueue = Promise.resolve();

function mbFetch(path, params = {}) {
    const query = new URLSearchParams({
        ...params
        , fmt: 'json'
    });
    const url = `${MB_BASE}${path}?${query}`;
    const result = mbQueue.then(() => fetch(url));
    mbQueue = result.catch(() => {}).then(() => new Promise(r => setTimeout(r, MB_MIN_GAP_MS)));
    return result.then(response => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`MusicBrainz returned HTTP ${response.status}`);
        return response.json();
    });
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
}

// Reads a Plex artist or album: description, tags and MusicBrainz ID (if Plex has one)
async function plexItem(ratingKey) {
    if (!ratingKey) return null;
    try {
        const xml = await plexFetchXml(`/library/metadata/${ratingKey}`, {
            includeGuids: 1
        });
        const item = xml.querySelector('MediaContainer > Directory');
        if (!item) return null;
        const tags = (name) => Array.from(item.querySelectorAll(`:scope > ${name}`)).map(t => t.getAttribute('tag')).filter(Boolean);
        const mbGuid = Array.from(item.querySelectorAll(':scope > Guid')).map(g => g.getAttribute('id') || '').find(id => id.startsWith('mbid://'));
        return {
            title: item.getAttribute('title')
            , summary: item.getAttribute('summary') || ''
            , thumb: item.getAttribute('thumb')
            , date: item.getAttribute('originallyAvailableAt') || item.getAttribute('year') || ''
            , genres: tags('Genre')
            , styles: tags('Style')
            , countries: tags('Country')
            , similar: tags('Similar')
            , mbid: mbGuid ? mbGuid.slice('mbid://'.length) : null
        };
    }
    catch (error) {
        console.error('Could not read Plex metadata:', error);
        return null;
    }
}

// Album titles in the Plex library for this artist, to mark the ones you own
async function plexAlbumTitles(artistRatingKey) {
    if (!artistRatingKey) return new Set();
    try {
        const xml = await plexFetchXml(`/library/metadata/${artistRatingKey}/children`);
        return new Set(Array.from(xml.querySelectorAll('MediaContainer > Directory')).map(d => normalise(d.getAttribute('title'))));
    }
    catch (error) {
        return new Set();
    }
}

// Wikipedia introduction via a Wikidata URL (as linked from MusicBrainz)
async function wikipediaFromWikidata(wikidataUrl) {
    const id = wikidataUrl.split('/').pop();
    const wd = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${encodeURIComponent(id)}&sitefilter=${WIKI_LANG}wiki&origin=*`);
    const entity = wd.entities && wd.entities[id];
    const link = entity && entity.sitelinks && entity.sitelinks[`${WIKI_LANG}wiki`];
    if (!link) return null;
    const wp = await fetchJson(`https://${WIKI_LANG}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&format=json&titles=${encodeURIComponent(link.title)}&origin=*`);
    const pages = wp.query && wp.query.pages;
    const page = pages && pages[Object.keys(pages)[0]];
    if (!page || !page.extract) return null;
    return {
        url: `https://${WIKI_LANG}.wikipedia.org/wiki/${encodeURIComponent(link.title.replace(/ /g, '_'))}`
        , html: cleanExtract(page.extract)
    };
}

// Keeps only simple text markup from the Wikipedia extract
function cleanExtract(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const allowed = new Set(['P', 'B', 'I', 'EM', 'STRONG', 'BR', 'SPAN', 'SUP', 'SUB', 'DIV']);
    doc.body.querySelectorAll('script, style, link, iframe, object, embed, noscript, template').forEach(el => el.remove());
    doc.body.querySelectorAll('*').forEach(el => {
        if (!allowed.has(el.tagName)) {
            el.replaceWith(...el.childNodes);
            return;
        }
        Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
    });
    // Drop empty paragraphs Wikipedia sometimes adds
    doc.body.querySelectorAll('p').forEach(p => {
        if (!p.textContent.trim()) p.remove();
    });
    return doc.body.firstElementChild.innerHTML;
}

// Turns a plain-text Plex summary into paragraphs
function textToHtml(text) {
    return text.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean).map(s => `<p>${escapeHtml(s)}</p>`).join('');
}

function pickRelations(relations) {
    const wanted = {
        'discogs': ['discogs.png', 'Discogs']
        , 'allmusic': ['allmusic.png', 'AllMusic']
        , 'last.fm': ['last.fm.png', 'Last.fm']
    };
    const seen = new Set();
    return (relations || []).filter(rel => wanted[rel.type] && rel.url && !seen.has(rel.type) && seen.add(rel.type))
        .map(rel => ({
            icon: wanted[rel.type][0]
            , name: wanted[rel.type][1]
            , url: rel.url.resource
        }));
}

// --- Loading --------------------------------------------------------------
async function loadArtist(name, ratingKey) {
    const cacheKey = ratingKey || `name:${name}`;
    if (artistCache.has(cacheKey)) return artistCache.get(cacheKey);
    const promise = (async () => {
        const plex = await plexItem(ratingKey);
        let mb = null;
        let mbid = plex && plex.mbid;
        if (!mbid) {
            const search = await mbFetch('/artist/', {
                query: `artist:${luceneQuote(name)}`
                , limit: 5
            });
            const hits = (search && search.artists) || [];
            const hit = hits.find(a => normalise(a.name) === normalise(name)) || hits[0];
            mbid = hit && hit.id;
        }
        if (mbid) {
            mb = await mbFetch(`/artist/${mbid}`, {
                inc: 'url-rels'
            });
        }
        let discography = [];
        if (mb) {
            const browse = await mbFetch('/release-group', {
                artist: mb.id
                , type: 'album'
                , limit: 100
            });
            discography = ((browse && browse['release-groups']) || [])
                .filter(rg => !rg['secondary-types'] || rg['secondary-types'].length === 0)
                .sort((a, b) => (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999'));
        }
        let wiki = null;
        const wikidata = mb && (mb.relations || []).find(rel => rel.type === 'wikidata');
        if (wikidata) {
            wiki = await wikipediaFromWikidata(wikidata.url.resource).catch(() => null);
        }
        const owned = await plexAlbumTitles(ratingKey);
        return {
            name: (mb && mb.name) || name
            , plex
            , mb
            , wiki
            , discography
            , owned
        };
    })();
    artistCache.set(cacheKey, promise);
    // Don't keep failures, so the next track tries again
    promise.catch(() => artistCache.delete(cacheKey));
    return promise;
}

async function loadAlbum(artistName, title, ratingKey, artistMbid) {
    const cacheKey = ratingKey || `name:${artistName}|${title}`;
    if (albumCache.has(cacheKey)) return albumCache.get(cacheKey);
    const promise = (async () => {
        const plex = await plexItem(ratingKey);
        let rg = null;
        // Plex's album MusicBrainz ID can be a release group or a release
        if (plex && plex.mbid) {
            rg = await mbFetch(`/release-group/${plex.mbid}`, {
                inc: 'url-rels'
            });
            if (!rg) {
                const release = await mbFetch(`/release/${plex.mbid}`, {
                    inc: 'release-groups'
                });
                const rgId = release && release['release-group'] && release['release-group'].id;
                if (rgId) rg = await mbFetch(`/release-group/${rgId}`, {
                    inc: 'url-rels'
                });
            }
        }
        if (!rg) {
            const artistPart = artistMbid ? `arid:${artistMbid}` : `artist:${luceneQuote(artistName)}`;
            const search = await mbFetch('/release-group/', {
                query: `${artistPart} AND releasegroup:${luceneQuote(title.replace(/\s*[\(\[].*?[\)\]]/g, '') || title)}`
                , limit: 5
            });
            const hits = (search && search['release-groups']) || [];
            const hit = hits.find(h => normalise(h.title) === normalise(title)) || hits[0];
            if (hit) rg = await mbFetch(`/release-group/${hit.id}`, {
                inc: 'url-rels'
            });
        }
        let wiki = null;
        const wikidata = rg && (rg.relations || []).find(rel => rel.type === 'wikidata');
        if (wikidata) {
            wiki = await wikipediaFromWikidata(wikidata.url.resource).catch(() => null);
        }
        return {
            title: (rg && rg.title) || title
            , plex
            , rg
            , wiki
        };
    })();
    albumCache.set(cacheKey, promise);
    promise.catch(() => albumCache.delete(cacheKey));
    return promise;
}

export async function loadAbout(track) {
    const panel = $('#about-panel');
    if (!panel) return;
    const token = ++loadToken;

    const albumArtist = track.getAttribute('grandparentTitle') || '';
    const trackArtist = track.getAttribute('originalTitle') || '';
    // On compilations, look up the track's own artist instead of "Various Artists"
    const isCompilation = /^various( artists)?$/i.test(albumArtist);
    const artistName = isCompilation && trackArtist ? trackArtist : albumArtist;
    const artistKey = isCompilation ? null : track.getAttribute('grandparentRatingKey');
    const albumTitle = track.getAttribute('parentTitle') || '';
    const albumKey = track.getAttribute('parentRatingKey');
    const thumb = track.getAttribute('grandparentThumb');

    panel.hidden = !artistName;
    if (!artistName) return;
    renderLoading(artistName, albumTitle, thumb);

    try {
        const artist = await loadArtist(artistName, artistKey);
        if (token !== loadToken) return;
        renderArtist(artist, thumb, albumTitle);
        if (albumTitle) {
            const album = await loadAlbum(artistName, albumTitle, albumKey, artist.mb && artist.mb.id);
            if (token !== loadToken) return;
            renderAlbum(album, artistName);
        }
    }
    catch (error) {
        console.error('Could not load artist and album info:', error);
        if (token === loadToken) $('#about-status').textContent = 'Could not load more information right now.';
    }
}

export function resetAbout() {
    loadToken++;
    setExpanded(false);
    const panel = $('#about-panel');
    if (panel) panel.hidden = true;
}

// --- Rendering ------------------------------------------------------------
function renderLoading(artistName, albumTitle, thumb) {
    $('#about-content').innerHTML = `
        <section class="about-section about-artist">
            <div class="about-head">
                ${thumb ? `<img class="about-artist-img" src="${escapeHtml(plexThumbUrl(thumb, ARTIST_THUMB_SIZE))}" alt="">` : ''}
                <div class="about-head-text">
                    <div class="about-label">Artist</div>
                    <div class="about-name">${escapeHtml(artistName)}</div>
                    <div class="about-meta" id="about-status">Looking up information…</div>
                </div>
            </div>
        </section>
        ${albumTitle ? `<section class="about-section about-album"><div class="about-label">Album</div><div class="about-name">${escapeHtml(albumTitle)}</div></section>` : ''}
        <section class="about-section about-more"></section>`;
    $('#about-content').scrollTop = 0;
}

function linkIcons(links) {
    return links.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" title="${escapeHtml(l.name)}"><img src="images/${l.icon}" alt="${escapeHtml(l.name)}" class="music-icon"></a>`).join('');
}

function renderArtist(artist, thumb, currentAlbum) {
    const {
        mb, plex, wiki
    } = artist;
    const lifeSpan = (mb && mb['life-span']) || {};
    const since = lifeSpan.begin ? (lifeSpan.ended && lifeSpan.end ? `${lifeSpan.begin.slice(0, 4)}–${lifeSpan.end.slice(0, 4)}` : `since ${lifeSpan.begin.slice(0, 4)}`) : '';
    const place = (mb && (mb['begin-area'] || mb.area)) ? (mb['begin-area'] || mb.area).name : '';
    const country = mb && mb.area && mb['begin-area'] && mb.area.name !== mb['begin-area'].name ? mb.area.name : '';
    const meta = [[place, country].filter(Boolean).join(', ') || (plex && plex.countries.join(', ')), since, mb && mb.type].filter(Boolean);

    const genres = plex ? [...plex.genres, ...plex.styles].filter((g, i, all) => all.indexOf(g) === i).slice(0, 8) : [];
    const bio = wiki ? wiki.html : (plex && plex.summary ? textToHtml(plex.summary) : '');
    const source = wiki ? 'Wikipedia' : (bio ? 'Plex' : '');

    const links = [];
    if (mb) links.push({
        icon: 'mb.png'
        , name: 'MusicBrainz'
        , url: `https://musicbrainz.org/artist/${mb.id}`
    });
    if (wiki) links.push({
        icon: 'wikipedia.png'
        , name: 'Wikipedia'
        , url: wiki.url
    });
    links.push(...pickRelations(mb && mb.relations));
    links.push({
        icon: 'aoty.png'
        , name: 'Album of the Year'
        , url: `https://www.albumoftheyear.org/search/artists/?q=${encodeURIComponent(artist.name)}`
    });

    const current = normalise(currentAlbum);
    const discography = artist.discography.map(rg => {
        const isCurrent = normalise(rg.title) === current;
        const isOwned = artist.owned.has(normalise(rg.title));
        const year = (rg['first-release-date'] || '').slice(0, 4) || '—';
        return `<li class="${isCurrent ? 'current' : ''} ${isOwned ? 'owned' : ''}"><span class="disc-year">${escapeHtml(year)}</span><a href="https://musicbrainz.org/release-group/${rg.id}" target="_blank" rel="noopener">${escapeHtml(rg.title)}</a></li>`;
    }).join('');

    const similar = plex ? plex.similar.slice(0, 10) : [];

    const section = $('#about-content .about-artist');
    section.innerHTML = `
        <div class="about-head">
            ${thumb ? `<img class="about-artist-img" src="${escapeHtml(plexThumbUrl(thumb, ARTIST_THUMB_SIZE))}" alt="">` : ''}
            <div class="about-head-text">
                <div class="about-label">Artist</div>
                <div class="about-name">${escapeHtml(artist.name)}</div>
                ${meta.length ? `<div class="about-meta">${meta.map(escapeHtml).join(' · ')}</div>` : ''}
                <div class="about-links">${linkIcons(links)}</div>
            </div>
        </div>
        ${genres.length ? `<div class="about-tags">${genres.map(g => `<span>${escapeHtml(g)}</span>`).join('')}</div>` : ''}
        ${bio ? `<div class="about-text">${bio}</div><div class="about-source">Source: ${source}</div>` : '<div class="about-meta">No biography found.</div>'}`;

    $('#about-content .about-more').innerHTML = `
        ${similar.length ? `<div class="about-label">Similar artists</div><div class="about-similar">${similar.map(escapeHtml).join(', ')}</div>` : ''}
        ${discography ? `<div class="about-label">Studio albums${artist.owned.size ? ' <span class="owned-key">● in your library</span>' : ''}</div><ol class="about-discography">${discography}</ol>` : ''}`;
}

function renderAlbum(album, artistName) {
    const {
        rg, plex, wiki
    } = album;
    const date = (rg && rg['first-release-date']) || (plex && plex.date) || '';
    const text = wiki ? wiki.html : (plex && plex.summary ? textToHtml(plex.summary) : '');
    const source = wiki ? 'Wikipedia' : (text ? 'Plex' : '');

    const links = [];
    if (rg) links.push({
        icon: 'mb.png'
        , name: 'MusicBrainz'
        , url: `https://musicbrainz.org/release-group/${rg.id}`
    });
    if (wiki) links.push({
        icon: 'wikipedia.png'
        , name: 'Wikipedia'
        , url: wiki.url
    });
    links.push(...pickRelations(rg && rg.relations));
    links.push({
        icon: 'aoty.png'
        , name: 'Album of the Year'
        , url: `https://www.albumoftheyear.org/search/albums/?q=${encodeURIComponent(`${artistName} ${album.title}`)}`
    });

    const section = $('#about-content .about-album');
    if (!section) return;
    section.innerHTML = `
        <div class="about-label">Album</div>
        <div class="about-name">${escapeHtml(album.title)}</div>
        ${date ? `<div class="about-meta">Released ${escapeHtml(date)}</div>` : ''}
        <div class="about-links">${linkIcons(links)}</div>
        ${text ? `<div class="about-text">${text}</div><div class="about-source">Source: ${source}</div>` : '<div class="about-meta">No description found.</div>'}`;
}

// --- Expanding the panel --------------------------------------------------
function setExpanded(expanded) {
    const panel = $('#about-panel');
    if (!panel) return;
    const sheet = panel.querySelector('.about-sheet');
    const toggle = $('#about-toggle');
    if (expanded && !panel.classList.contains('expanded')) {
        // Keep the space the button took, so nothing else moves when it opens
        panel.style.minHeight = `${panel.offsetHeight}px`;
        document.dispatchEvent(new CustomEvent('sheet-open', {
            detail: 'about'
        }));
    }
    else if (!expanded) {
        panel.style.minHeight = '';
    }
    panel.classList.toggle('expanded', expanded);
    if (sheet) {
        if (expanded) {
            // Positioned inside the info column, from the album title down
            const column = panel.closest('.album-info, .info') || panel.parentElement;
            const albumTitle = $('#album-title');
            const anchor = albumTitle ? (albumTitle.closest('h3, .album-line') || albumTitle) : null;
            const top = anchor ? anchor.getBoundingClientRect().top - column.getBoundingClientRect().top - column.clientTop : 0;
            sheet.style.top = `${Math.max(0, top)}px`;
        }
        else {
            sheet.style.top = '';
        }
    }
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Hide artist and album info' : 'Show artist and album info');
        toggle.title = expanded ? 'Hide info' : 'Show info';
    }
}

const isExpanded = () => {
    const panel = $('#about-panel');
    return !!panel && panel.classList.contains('expanded');
};

(function setUpPanel() {
    const panel = $('#about-panel');
    if (!panel) return;
    $('#about-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        setExpanded(!isExpanded());
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isExpanded()) setExpanded(false);
    });
    // Close when the lyrics open, so only one sheet shows at a time
    document.addEventListener('sheet-open', (e) => {
        if (e.detail !== 'about' && isExpanded()) setExpanded(false);
    });
    const realign = () => {
        if (isExpanded()) setExpanded(true);
    };
    window.addEventListener('resize', realign);
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(realign);
        if (panel.parentElement) observer.observe(panel.parentElement);
    }
})();
