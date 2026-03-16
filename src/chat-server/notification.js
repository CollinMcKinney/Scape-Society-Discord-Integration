// notification.js
const crypto = require("crypto");
const datastore = require("./datastore");
const auth = require("./auth");
const { Roles } = require("./roles");

// Notification types enum
const NotificationType = Object.freeze({
  ACHIEVEMENT: "achievement",
  EVENT: "event",
  SYSTEM: "system",
});

// ---------------- Add Notification ----------------
// Only Moderator+ can add
async function addNotification(actorId, actorSessionToken, type, content) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.MODERATOR) return false;

  const id = crypto.randomUUID();
  const stored = {
    id,
    actorId,
    type,
    content,
    timestamp: Date.now()
  };

  await datastore.set(`notification:${id}`, stored);
  await datastore.zAdd("notifications", { score: stored.timestamp, value: id });

  return true;
}

// ---------------- Get Notifications ----------------
async function getNotifications(actorId, actorSessionToken, limit = 50) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return [];

  const ids = await datastore.zRange("notifications", -limit, -1);
  const notifications = [];

  for (const id of ids) {
    const notification = await datastore.get(`notification:${id}`);
    if (!notification) continue;
    notifications.push(notification);
  }

  return notifications;
}

// ---------------- Delete Notification ----------------
async function deleteNotification(actorId, actorSessionToken, notificationId) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  await datastore.del(`notification:${notificationId}`);
  await datastore.zRem("notifications", notificationId);

  return true;
}

// ---------------- Edit Notification ----------------
async function editNotification(actorId, actorSessionToken, notificationId, updatedFields) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const notification = await datastore.get(`notification:${notificationId}`);
  if (!notification) return false;

  Object.assign(notification, updatedFields);
  await datastore.set(`notification:${notificationId}`, notification);

  return true;
}

module.exports = { 
  NotificationType,
  addNotification,
  getNotifications,
  deleteNotification,
  editNotification
};