// Listens to the Plex server's live notification channel. Plex sends a
// "playing" notification whenever a player starts, pauses, resumes, stops or
// moves on, and it includes the play queue ID that /status/sessions lacks.
import {
    plexWebSocketUrl
}
from './plex.js';

export function connectNotifications(onPlaying) {
    let retryMs = 2000;

    function connect() {
        let socket;
        try {
            socket = new WebSocket(plexWebSocketUrl('/:/websockets/notifications'));
        }
        catch (error) {
            console.error('Could not open the Plex notification channel:', error);
            return;
        }
        socket.onopen = () => {
            retryMs = 2000;
        };
        socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            }
            catch (e) {
                return;
            }
            const container = data && data.NotificationContainer;
            if (container && Array.isArray(container.PlaySessionStateNotification)) {
                container.PlaySessionStateNotification.forEach(onPlaying);
            }
        };
        // Reconnect with a growing delay (max 1 minute) if the connection drops
        socket.onclose = () => {
            setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 2, 60000);
        };
    }
    connect();
}
