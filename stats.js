// Listening stats for the idle screen: plays, artists and albums in the last
// 7 days, plays per day, and the top artists. Worked out from the Plex play history.
import {
    plexFetchXml
}
from './plex.js';

const DAYS = 7;
const TOP_ARTISTS = 5;
const PAGE_SIZE = 200;
const MAX_ITEMS = 2000; // Safety limit when reading the history

// Reads the music plays of the last 7 days (today included, local time)
export async function loadStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (DAYS - 1));
    const cutoff = Math.floor(start.getTime() / 1000);

    const plays = [];
    for (let offset = 0; offset < MAX_ITEMS; offset += PAGE_SIZE) {
        const xml = await plexFetchXml('/status/sessions/history/all', {
            sort: 'viewedAt:desc'
            , 'X-Plex-Container-Start': offset
            , 'X-Plex-Container-Size': PAGE_SIZE
        });
        const items = xml.documentElement ? Array.from(xml.documentElement.children) : [];
        let reachedCutoff = false;
        for (const item of items) {
            const viewedAt = parseInt(item.getAttribute('viewedAt'), 10) || 0;
            if (viewedAt < cutoff) {
                reachedCutoff = true;
                break;
            }
            if (item.getAttribute('type') === 'track') plays.push({
                item
                , viewedAt
            });
        }
        if (reachedCutoff || items.length < PAGE_SIZE) break;
    }

    // Plays per day, oldest first
    const days = [];
    for (let i = 0; i < DAYS; i++) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        days.push({
            date: day
            , count: 0
        });
    }
    const artists = new Map();
    const albums = new Set();
    for (const {
            item, viewedAt
        }
        of plays) {
        const when = new Date(viewedAt * 1000);
        when.setHours(0, 0, 0, 0);
        const index = Math.round((when - start) / 86400000);
        if (days[index]) days[index].count++;
        const artist = item.getAttribute('originalTitle') || item.getAttribute('grandparentTitle') || 'Unknown Artist';
        artists.set(artist, (artists.get(artist) || 0) + 1);
        albums.add(item.getAttribute('parentRatingKey') || `${artist}/${item.getAttribute('parentTitle')}`);
    }
    const topArtists = Array.from(artists.entries()).sort((a, b) => b[1] - a[1]).slice(0, TOP_ARTISTS).map(([name, count]) => ({
        name
        , count
    }));
    return {
        plays: plays.length
        , artists: artists.size
        , albums: albums.size
        , days
        , topArtists
    };
}

// Fills the stats panel; with null (no data) the normal placeholder art shows instead
export function renderStats(stats) {
    const panel = document.querySelector('#idle-stats');
    document.body.classList.toggle('has-stats', !!(panel && stats));
    if (!panel || !stats) return;

    setText('#stat-plays', stats.plays);
    setText('#stat-artists', stats.artists);
    setText('#stat-albums', stats.albums);

    // 7-day bar chart; today is highlighted
    const chart = panel.querySelector('#stats-chart');
    chart.innerHTML = '';
    const max = Math.max(1, ...stats.days.map(d => d.count));
    const dayName = new Intl.DateTimeFormat('en', {
        weekday: 'short'
    });
    stats.days.forEach((day, i) => {
        const col = document.createElement('div');
        col.className = 'bar-col' + (i === stats.days.length - 1 ? ' today' : '');
        col.title = `${day.count} plays on ${day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`;
        const count = document.createElement('span');
        count.className = 'bar-count';
        count.textContent = day.count || '';
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.height = `${(day.count / max) * 100}%`;
        const label = document.createElement('span');
        label.className = 'bar-day';
        label.textContent = dayName.format(day.date).slice(0, 2);
        const track = document.createElement('div');
        track.className = 'bar-track';
        track.append(count, bar);
        col.append(track, label);
        chart.appendChild(col);
    });

    // Top artists, with a thin bar showing their share
    const list = panel.querySelector('#stats-top');
    list.innerHTML = '';
    if (!stats.topArtists.length) {
        const li = document.createElement('li');
        li.className = 'stats-empty';
        li.textContent = 'Nothing played in the last 7 days';
        list.appendChild(li);
    }
    const topCount = stats.topArtists.length ? stats.topArtists[0].count : 1;
    stats.topArtists.forEach(({
        name, count
    }) => {
        const li = document.createElement('li');
        const nameEl = document.createElement('span');
        nameEl.className = 'top-name';
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.className = 'top-count';
        countEl.textContent = count;
        const track = document.createElement('div');
        track.className = 'top-track';
        const fill = document.createElement('div');
        fill.className = 'top-fill';
        fill.style.width = `${(count / topCount) * 100}%`;
        track.appendChild(fill);
        li.append(nameEl, countEl, track);
        list.appendChild(li);
    });
}

function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
}
