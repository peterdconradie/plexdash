# plexdash: a Plex Now Playing Viewer

plexdash is a small web page that shows what is playing on your Plex Media Server: the album art, the track, artist and album, the progress, and more. It runs entirely in the browser and talks to Plex directly, so no back end is needed.

## Features

### Now playing
- Track title, artist, album, year and progress, with a progress bar coloured from the album art.
- Audio details such as sample rate, bit depth, bitrate and codec.
- Instant updates when you pause, resume or skip, through Plex's live notifications.
- A dropdown to choose the player when more than one Plex player is active. The choice is remembered in the browser.
- The browser tab shows the cover of the current album, or an equaliser icon when nothing plays.
- Quick search links to Album of the Year, Last.fm, Discogs and Genius.

### Lyrics
- Synced lyrics that scroll along with the track (needs Plex Pass). Plain, untimed lyrics scroll through at the pace of the track.
- The lyrics stay folded away as a small "Lyrics" button, which only appears when the track has lyrics. Click it to open them over the album details; click again or press Esc to close.

### About the artist and album
- An "About" button next to "Lyrics" opens background information on what is playing:
  - **Artist:** photo, origin, active years, genres and the introduction from Wikipedia.
  - **Album:** release date and the introduction from Wikipedia.
  - **More:** similar artists, and the artist's studio albums by year. The album that is playing is shown in bold, and albums in your Plex library are marked with a dot.
  - Links to MusicBrainz, Wikipedia, Discogs, AllMusic, Last.fm and Album of the Year.
- The information comes from MusicBrainz and Wikipedia. If Wikipedia has nothing, Plex's own artist bio and album review are shown instead.
- Click the button again or press Esc to close. Only one of About and Lyrics is open at a time.

### Up next
- The next two tracks in the play queue.

### Idle screen
- When nothing is playing: your recently played tracks and recently added albums.
- In the main and phone layouts, the album square shows your listening in the last 7 days: plays, artists and albums, plays per day, and your top artists.

## Layouts
- `index.html`: the standard landscape layout.
- `m.html`: a layout for phone screens.
- `v.html`: a vertical layout, made for Vivaldi's sidebar. It has no player dropdown and no About panel.

## Requirements
- A Plex Media Server with a music library.
- Your Plex token ([how to find it](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)).
- A simple local web server to serve the files (see below).

## Setup
1. **Get the files**

   ```bash
   git clone https://github.com/peterdconradie/plexdash.git
   ```

   You can move the `plexdash` folder anywhere you like, as long as you keep the folder structure.

2. **Add your Plex token and server URL**

   Rename `apikey_CHANGE_THIS.js` to `apikey.js` and fill in your own values:

   ```javascript
   const plexApiKey = "YOUR_PLEX_TOKEN";
   const plexServerUrl = "http://192.168.1.1:32400"; // Your Plex server URL
   export {
       plexApiKey, plexServerUrl
   };
   ```

   `apikey.js` is listed in `.gitignore`, so your token is not committed.

3. **Start a local web server**

   The page uses JavaScript modules, so it has to be served over HTTP rather than opened as a file. In the project folder, run:

   ```bash
   python3 -m http.server
   ```

   Then open `http://localhost:8000` in your browser. On another device in your network, use the computer's IP address instead of `localhost`.

## Settings
At the top of `get_info.js`:
- `POLL_INTERVAL_MS`: how often Plex is asked what is playing (default 2 seconds).
- `SHOW_LYRICS`, `SHOW_UP_NEXT`, `SHOW_IDLE_SCREEN`, `SHOW_ABOUT`: turn the lyrics, the up next list, the idle screen or the About panel off.
- `LIVE_UPDATES`: turn Plex's live notifications off. This also turns off up next, which depends on them.
- `DEBUG`: log poll results and notifications to the console.

Elsewhere:
- `UP_NEXT_COUNT` in `upnext.js`: the number of upcoming tracks.
- `RECENT_TRACKS` and `RECENT_ALBUMS` in `idle.js`: the number of recently played tracks and recently added albums.
- `WIKI_LANG` in `about.js`: the Wikipedia language for the About panel (default `en`).

## How it works
- **Lyrics** come from Plex itself: either `.lrc`/`.txt` files next to your music, or lyrics Plex downloads automatically (Plex Pass). While lyrics scroll you can scroll them yourself; auto-scroll resumes after 5 seconds.
- **Up next:** Plex doesn't include the play queue in the "now playing" data, so the page learns it from the live notifications Plex sends while a track plays. Up next can therefore take a few seconds to appear after you open the page. If another app on your account starts its own play queue, Plex may drop the old one; up next then stays hidden until the next track.
- **About panel:** the page uses the MusicBrainz IDs that Plex stores for your music when it has them, and otherwise searches MusicBrainz by artist and album name. On compilations it looks up the track's own artist instead of "Various Artists". MusicBrainz allows about one request per second, so the panel can take a few seconds to fill for a new artist. Results are kept per artist and album, so the rest of an album shows up straight away.

## Files
| File | What it does |
|---|---|
| `get_info.js` | Main script: polls Plex and draws the now playing screen |
| `plex.js` | Helpers for talking to the Plex server |
| `notifications.js` | Plex's live notifications (pause, resume, skip) |
| `lyrics.js` | Loads and scrolls the lyrics |
| `upnext.js` | The up next list |
| `about.js` | The About panel (MusicBrainz and Wikipedia) |
| `idle.js`, `stats.js` | The idle screen and the 7-day listening stats |
| `getColour.js` | Picks the progress bar colour from the album art |
| `style.css`, `m.css`, `style_vertical.css` | Styles for the main, phone and vertical layouts |

## Privacy and security
- The Plex token is sent to every browser that opens the page. Only run plexdash on your own network, and don't expose it to the internet (for example via ngrok) unless you are fine with others seeing the token.
- The About panel sends the artist and album names of what you play to MusicBrainz, Wikidata and Wikipedia. Set `SHOW_ABOUT` to `false` if you don't want that.

## What does it look like?
![Screenshot](screenshot.png "Screenshot")

## Known issues
- Plex only updates the playback position every few seconds, so after seeking the progress bar can take a moment to catch up.
- The About panel depends on MusicBrainz and Wikipedia. For lesser-known artists, or albums with unusual titles, it may find the wrong entry or nothing at all.

## Credits
- Inspired by [PlexampStatusPage](https://github.com/claesbert/PlexampStatusPage), check it out!
- The About panel is ported from my earlier Last.fm dashboard, [dash.fm](https://github.com/peterdconradie/dash.fm).

## License
This project is open source and licensed under the MIT License.
