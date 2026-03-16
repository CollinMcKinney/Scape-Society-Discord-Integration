// messages.js
const datastore = require("./datastore");
const auth = require("./auth");
const { v4: uuidv4 } = require("uuid");

// Define roles enum locally or import from user.js
const Roles = Object.freeze({
  Blocked: 0,
  Guest: 1,
  User: 2,
  Moderator: 3,
  Admin: 4,
  Owner: 5,
});

// ========================
// Message Record Factory
// ========================
class Message {
  constructor(actorId, content, id = uuidv4(), timestamp = Date.now()) {
    this.id = id;
    this.actorId = actorId;
    this.content = content;
    this.timestamp = timestamp;
    this.deleted = false;
    this.editedContent = null;
  }

  // Mark as deleted
  markDeleted() {
    this.deleted = true;
  }

  // Edit message content
  edit(newContent) {
    this.editedContent = newContent;
  }

  // Serialize for storage
  serialize() {
    return {
      id: this.id,
      actorId: this.actorId,
      content: this.content,
      timestamp: this.timestamp,
      deleted: this.deleted,
      editedContent: this.editedContent,
    };
  }

  // Save to datastore
  async save() {
    await datastore.set(`message:${this.id}`, this.serialize());
    await datastore.zAdd("messages", { score: this.timestamp, value: this.id });
  }

  // Static method to load a message from datastore
  static async load(id) {
    const data = await datastore.get(`message:${id}`);
    if (!data) return null;
    const msg = new Message(data.actorId, data.content, data.id, data.timestamp);
    msg.deleted = data.deleted;
    msg.editedContent = data.editedContent;
    return msg;
  }
}

// ========================
// API Functions
// ========================
async function createMessage(actorId, content) {
  return new Message(actorId, content);
}

async function addMessage(actorId, actorSessionToken, message) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role === Roles.Blocked) return false;

  const existing = await datastore.exists(`message:${message.id}`);
  if (existing) return false;

  await createMessage(actorId, message.content).save();
  return true;
}

async function getMessages(actorId, actorSessionToken, limit = 50) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return [];

  const ids = await datastore.zRange("messages", -limit, -1);
  const messages = [];
  for (const id of ids) {
    const message = await Message.load(id);
    if (message) messages.push(message.serialize());
  }
  return messages;
}

// Moderation
async function deleteMessage(actorId, actorSessionToken, messageId) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const message = await Message.load(messageId);
  if (!message) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.Moderator) return false;

  message.markDeleted();
  await message.save();
  return true;
}

async function editMessage(actorId, actorSessionToken, messageId, newContent) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const message = await Message.load(messageId);
  if (!message) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.Moderator) return false;

  message.edit(newContent);
  await message.save();
  return true;
}

module.exports = 
{ 
    Message,
    createMessage, 
    addMessage, 
    getMessages, 
    editMessage,
    deleteMessage, 
};