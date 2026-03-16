// messages.js
const datastore = require("./datastore");
const auth = require("./auth");
const { v4: uuidv4 } = require("uuid");
const { Roles } = require("./roles");


// ========================
// Message Class
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

  markDeleted() {
    this.deleted = true;
  }

  edit(newContent) {
    this.editedContent = newContent;
  }

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

  async save() {
    await datastore.set(`message:${this.id}`, this.serialize());
    await datastore.zAdd("messages", { score: this.timestamp, value: this.id });
  }

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

// Create a new Message instance
async function createMessage(actorId, content) {
  return new Message(actorId, content);
}

// ---------------- Add Message ----------------
// Now `messageContent` is a string
async function addMessage(actorId, actorSessionToken, messageContent) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role === Roles.BLOCKED) return false;

  const message = await createMessage(actorId, messageContent);
  await message.save();
  return true;
}

// ---------------- Get Messages ----------------
async function getMessages(actorId, actorSessionToken, limit = 50) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return [];

  const ids = await datastore.zRange("messages", -limit, -1);
  const messages = [];
  for (const id of ids) {
    const msg = await Message.load(id);
    if (msg) messages.push(msg.serialize());
  }
  return messages;
}

// ---------------- Moderation ----------------
// TODO: messages not being deleted.
async function deleteMessage(actorId, actorSessionToken, messageId) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const message = await Message.load(messageId);
  if (!message) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.MODERATOR) return false;

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
  if (!actor || actor.role < Roles.MODERATOR) return false;

  message.edit(newContent);
  await message.save();
  return true;
}

module.exports = {
  Message,
  addMessage,
  getMessages,
  editMessage,
  deleteMessage,
};