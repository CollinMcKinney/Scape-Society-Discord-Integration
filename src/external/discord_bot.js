require('dotenv').config();
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const { addMessage, getMessages, messageEvents } = require('./messages');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const webhookClient = new WebhookClient({ id: process.env.WEBHOOK_ID, token: process.env.WEBHOOK_TOKEN });

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

// ---------------- Discord → Server ----------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  await addMessage(message.author.id, process.env.ROOT_SESSION_TOKEN, message.content);
});

// ---------------- Server → Discord ----------------
messageEvents.on('messageAdded', async (msg) => {
  if (msg.deleted || msg.actorId === process.env.ROOT_USER_ID) return;

  await webhookClient.send({
    content: msg.content,
    username: `User:${msg.actorId}`
  });
});

messageEvents.on('messageEdited', async (msg) => {
  await webhookClient.send({
    content: `✏️ Edited message from User:${msg.actorId}: ${msg.editedContent}`
  });
});

messageEvents.on('messageDeleted', async (msg) => {
  await webhookClient.send({
    content: `🗑️ Deleted message from User:${msg.actorId}: "${msg.content}"`
  });
});

// ---------------- Poll for server messages ----------------
let lastTimestamp = 0;
async function pollServerMessages() {
  const messages = await getMessages(process.env.ROOT_USER_ID, process.env.ROOT_SESSION_TOKEN, 50);
  for (const msg of messages) {
    if (msg.timestamp > lastTimestamp && !msg.deleted && msg.actorId !== process.env.ROOT_USER_ID) {
      await webhookClient.send({
        content: msg.content,
        username: `User:${msg.actorId}`
      });
      lastTimestamp = Math.max(lastTimestamp, msg.timestamp);
    }
  }
}
setInterval(pollServerMessages, process.env.POLL_INTERVAL);

client.login(process.env.BOT_TOKEN);

module.exports = { client };