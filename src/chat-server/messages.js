// messages.js
const datastore = require('./datastore');
const auth = require('./auth');
const { v4: uuidv4 } = require('uuid');
const { Roles } = require('./roles');
const EventEmitter = require('events');

const messageEvents = new EventEmitter();

// ========================
// Message class
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
    await datastore.client.set(`message:${this.id}`, JSON.stringify(this.serialize()));
    await datastore.client.zAdd('messages', { score: this.timestamp, value: this.id });
  }

  static async load(id) {
    const data = await datastore.client.get(`message:${id}`);
    if (!data) return null;
    const parsed = JSON.parse(data);
    const msg = new Message(parsed.actorId, parsed.content, parsed.id, parsed.timestamp);
    msg.deleted = parsed.deleted;
    msg.editedContent = parsed.editedContent;
    return msg;
  }
}

// ========================
// API Functions
// ========================

async function createMessage(actorId, content) {
  return new Message(actorId, content);
}

async function addMessage(actorId, actorSessionToken, messageContent) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const actor = await datastore.client.get(`user:${actorId}`);
  if (!actor || JSON.parse(actor).role === Roles.BLOCKED) return false;

  const message = await createMessage(actorId, messageContent);
  await message.save();

  // Emit event
  messageEvents.emit('messageAdded', message);

  return true;
}

async function getMessages(actorId, actorSessionToken, limit = 50) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return [];

  const ids = await datastore.client.zRange('messages', -limit, -1);
  const messages = [];
  for (const id of ids) {
    const msg = await Message.load(id);
    if (msg) messages.push(msg.serialize());
  }
  return messages;
}

async function deleteMessage(actorId, actorSessionToken, messageId) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const message = await Message.load(messageId);
  if (!message) return false;

  const actor = await datastore.client.get(`user:${actorId}`);
  if (!actor || JSON.parse(actor).role < Roles.MODERATOR) return false;

  message.markDeleted();
  await message.save();

  messageEvents.emit('messageDeleted', message);

  return true;
}

async function editMessage(actorId, actorSessionToken, messageId, newContent) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const message = await Message.load(messageId);
  if (!message) return false;

  const actor = await datastore.client.get(`user:${actorId}`);
  if (!actor || JSON.parse(actor).role < Roles.MODERATOR) return false;

  message.edit(newContent);
  await message.save();

  messageEvents.emit('messageEdited', message);

  return true;
}

module.exports = {
  Message,
  addMessage,
  getMessages,
  editMessage,
  deleteMessage,
  messageEvents,
};