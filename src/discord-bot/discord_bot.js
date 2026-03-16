require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const { addMessage, getMessages, messageEvents } = require('../chat-server/messages');
const { initStorage } = require('../chat-server/datastore');
const Users = require('../chat-server/users');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const webhook = new WebhookClient({
  id: process.env.WEBHOOK_ID,
  token: process.env.WEBHOOK_TOKEN,
});

// Polling fallback
let lastTimestamp = 0;

async function pollServerMessages() {
  try {
    const messages = await getMessages(
      process.env.ROOT_USER_ID,
      process.env.ROOT_SESSION_TOKEN,
      50
    );

    for (const msg of messages) {
      if (msg.timestamp > lastTimestamp && !msg.deleted && msg.actorId) {
        console.log(`Polling: New message from User:${msg.actorId}: ${msg.content}`);
        const user = await Users.getUser(process.env.ROOT_USER_ID, process.env.ROOT_SESSION_TOKEN, msg.actorId);
        console.log(`Polling: Fetched user for message: `, user, user.id, user.osrs_name, user.disc_name, user.forum_name);

        const displayName = // Impersonate their OSRS/Discord/Forum name if possible, otherwise show "User:ID
          user.osrs_name ||
          user.disc_name ||
          user.forum_name || //otherwise show shortened form of user ID (12 characters max)
          msg.actorId.slice(0, 12);

        await webhook.send({
          content: msg.content,
          username: displayName,
        });

        lastTimestamp = Math.max(lastTimestamp, msg.timestamp);
      }
    }
  } catch (err) {
    console.error('Polling failed:', err);
  }
}

// ---------------- Discord → Chat Server ----------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    await addMessage(process.env.ROOT_USER_ID, process.env.ROOT_SESSION_TOKEN, message.content);
    console.log(`Discord → Server: ${message.content}`);
  } catch (err) {
    console.error('Failed to relay Discord message:', err);
  }
});

// ---------------- Chat Server → Discord ----------------
messageEvents.on('messageAdded', async (msg) => {
  if (msg.deleted /*|| msg.actorId === process.env.ROOT_USER_ID*/) return;

  try {
    await webhook.send({
      content: msg.content,
      username: `User:${msg.actorId}`,
    });
    console.log(`Server → Discord: ${msg.content}`);
  } catch (err) {
    console.error('Webhook send failed:', err);
  }
});

// ---------------- Startup ----------------
async function startBot() {
  await await initStorage(); // ensure Redis is ready
  client.once('clientReady', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
  });

  await client.login(process.env.BOT_TOKEN).catch(console.error);

  // Polling fallback
  setInterval(pollServerMessages, process.env.POLL_INTERVAL || 5000);
}

startBot();