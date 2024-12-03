# Plex Now Playing Viewer

This provides a simple client-side application to display "Now Playing" information from your Plex Media Server. It uses the Plex API to fetch the current playing track details and updates the UI dynamically.

## Features

- Fetches and displays the currently playing track information.
- Shows track metadata such as artist, album, title, and duration.
- Displays album art with a dominant color-based progress bar.
- Provides external links to artist information on Album of the Year, Last.fm, and Discogs.
- Real-time progress tracking for the currently playing track.


## Prerequisites

- A Plex Media Server.
- An API key for your Plex server.
- Basic knowledge of setting up a local development environment.

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. Add your Plex API key and server URL:
   Create a file named `apikey.js` in the project directory with the following content:
   ```javascript
   export const plexApiKey = 'YOUR_PLEX_API_KEY';
   export const plexServerUrl = 'YOUR_PLEX_SERVER_URL';
   ```

3. Open the project in a browser:
   Use a local web server (i.e.: navigate to the folder in mac in the terminal and run
   ```bash
   python3 -m http.server
   ```
   This will start a local web server on the default port 8000.

## What does it look like?
![image](screenshot.png "Screenshot")


## Troubleshooting

- Ensure the API key and server URL in `apikey.js` are correct.
- Use browser developer tools to debug any issues (check console logs for errors).
- If cross-origin issues occur, ensure the Plex server allows connections from your browser.

## Issues
- The progress bar can be janky, plex doesn't reliably provide the information and it won't worked when paused. Refreshing should bring you to more or less the right place. 


## License

This project is open-source and licensed under the [MIT License](LICENSE).

## License
This project was inspired by [PlexampStatusPage](https://github.com/claesbert/PlexampStatusPage)


