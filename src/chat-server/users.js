// user.js
const crypto = require("crypto");
const datastore = require("./datastore");
const auth = require("./auth");
const { Roles } = require("./roles");


function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Internal
async function createUserInternal(osrs_name, disc_name, forum_name, role = Roles.USER, password ) {
  console.log("Creating user with data:", { osrs_name, disc_name, forum_name, role });

  // if role is ROOT, check if another root user exists first and don't create a new one.
  if (role === Roles.ROOT) {
    const existingRootId = await datastore.get("user:role:ROOT");
    if (existingRootId) throw new Error("ROOT user already exists!", { existingRootId });
  }

  const id = crypto.randomUUID();
  
  const hashedPass = hashToken(password);

  const user = { id, osrs_name, disc_name, forum_name, role, hashedPass: hashedPass, created_at: Date.now() };
  const result = await datastore.set(`user:${id}`, user, { NX: true });
  if (!result) throw new Error("User already exists");

  await datastore.sAdd("users", id);

  if (osrs_name) await datastore.set(`user:osrs:${osrs_name}`, id);
  if (disc_name) await datastore.set(`user:discord:${disc_name}`, id);
  if (forum_name) await datastore.set(`user:forum:${forum_name}`, id);

  console.log("User created: ", { id, osrs_name, disc_name, forum_name, role });

  return { id, osrs_name, disc_name, forum_name, role, created_at: user.created_at, hashedPass: hashedPass };
}

// Public API
async function createUser(actorId, actorSessionToken, osrs_name, disc_name, forum_name, password) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) throw new Error("Actor not authenticated");

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.MODERATOR) throw new Error("Insufficient role");

  return createUserInternal(osrs_name, disc_name, forum_name, Roles.USER, password);
}

async function listUsers(actorId, actorSessionToken) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) throw new Error("Actor not authenticated");

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.MODERATOR) throw new Error("Insufficient role");

  const ids = await datastore.sMembers("users");
  const users = [];
  for (const id of ids) {
    const user = await datastore.get(`user:${id}`);
    if (user) users.push({
      id: user.id,
      osrs_name: user.osrs_name,
      disc_name: user.disc_name,
      forum_name: user.forum_name,
      role: user.role,
      created_at: user.created_at,
    });
  }
  return users;
}

async function getUser(actorId, actorSessionToken, targetId) {
  await auth.verifySession(actorId, actorSessionToken);
  return datastore.get(`user:${targetId}`);
}

async function setRole(actorId, actorSessionToken, targetId, newRole) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) return false;

  const actor = await datastore.get(`user:${actorId}`);
  const target = await datastore.get(`user:${targetId}`);
  if (!actor || !target) return false;

  if (actor.role < Roles.MODERATOR) return false;
  if (actor.role <= target.role) return false;
  if (actor.role <= newRole) return false;

  target.role = newRole;
  await datastore.set(`user:${targetId}`, target);
  return true;
}

// set

// TODO: is this even necessary? The only change we can make to a user is role, 
// and that should be done through setRole for better validation. 
// Maybe we can remove this and just use setRole for all updates?
async function updateUser(actorId, actorSessionToken, targetUser) {
  const verified = await auth.verifySession(actorId, actorSessionToken);
  if (!verified) throw new Error("Actor not authenticated");

  const actor = await datastore.get(`user:${actorId}`);
  if (!actor || actor.role < Roles.MODERATOR) throw new Error("Insufficient role");

  return datastore.set(`user:${targetUser.id}`, targetUser);
}

module.exports = { 
    createUser, 
    listUsers, 
    getUser, 
    setRole,
    updateUser, 

    createUserInternal,
    hashToken
};