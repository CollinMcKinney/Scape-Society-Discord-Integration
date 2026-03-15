
// generic discord bot template
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { storeMessage, isAuthenticated, sendMessage, getMessages } = require('./redis-chat-server'); 


// Add a way for the bot to send messages via webhooks,
// using a customized username & avatar.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore messages from bots
    const userId = message.author.id;

    // Store the message in Redis
    await storeMessage({
        id: message.id,
        userId: userId,
        content: message.content,
        timestamp: Date.now()
    });
