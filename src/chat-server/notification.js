// notification.js
const crypto = require("crypto");
const datastore = require("./datastore");
const auth = require("./auth");

const NotificationType = Object.freeze({
  ACHIEVEMENT: "achievement",
  EVENT: "event",
  SYSTEM: "system",
});

async function addNotification(actorId, actorSessionToken, notification) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const id = notification.id || crypto.randomUUID();
  const stored = {
    id,
    actorId,
    type: notification.type,
    content: notification.content,
    targetUsers: notification.targetUsers || [],
    timestamp: Date.now()
  };

  await datastore.set(`notification:${id}`, stored);
  await datastore.zAdd("notifications", { score: stored.timestamp, value: id });

  return true;
}

async function getNotifications(actorId, actorSessionToken, limit = 50) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return [];

  const ids = await datastore.zRange("notifications", -limit, -1);
  const notifications = [];

  for (const id of ids) {
    const notification = await datastore.get(`notification:${id}`);
    if (!notification) continue;

    if (notification.targetUsers.length === 0 || notification.targetUsers.includes(userId)) {
      notifications.push(notification);
    }
  }

  return notifications;
}

async function deleteNotification(actorId, actorSessionToken, notificationId) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  await datastore.del(`notification:${notificationId}`);
  await datastore.zRem("notifications", notificationId);

  return true;
}

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