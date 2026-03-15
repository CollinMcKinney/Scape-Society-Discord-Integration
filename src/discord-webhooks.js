

// reference the README.md for how this should be written
const fetch = require('node-fetch');

// Add a way for the bot to send messages via webhooks, 
// using a customized username & avatar.
async function sendWebhookMessage(webhookUrl, content, username, avatarUrl) {
    const payload = { 
        content: content,
        username: username,
        avatar_url: avatarUrl
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error('Failed to send webhook message:', response.statusText);
        }
    } catch (error) {
        console.error('Error sending webhook message:', error);
    }
}

module.exports = {
    sendWebhookMessage
};