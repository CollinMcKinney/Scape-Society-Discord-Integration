// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { initStorage, saveState, loadState, startAutoSaveDynamic } = require("./datastore");
const auth = require("./auth");
const users = require("./users");
const { Roles } = require("./roles");

// Import Discord bot (starts automatically)
require('../discord-bot/discord_bot');

// Import admin router
const adminRouter = require("./admin_router");

const app = express(); // <-- app must exist before using app.use
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Mount the admin router at /admin
app.use("/admin", adminRouter);

async function start() {
  await initStorage();
  await loadState();

  startAutoSaveDynamic();
  await saveState();

  console.log("Server ready!");

  // Create ROOT user if needed
  const root = await users.createUserInternal( 
    "ROOT", 
    "ROOT#0000", 
    "ROOT", 
    Roles.ROOT, 
    users.hashToken("password"));

  const sessionToken = await auth.authenticate(root.id, root.hashedPass);
  const verifiedUserId = await auth.verifySession(root.id, sessionToken);

  process.env.ROOT_USER_ID = verifiedUserId; // Store ROOT user ID in env for reference
  process.env.ROOT_SESSION_TOKEN = sessionToken; // Store ROOT session token in env for admin access

  console.log("Verified user ID from session token:", process.env.ROOT_USER_ID);
  console.log("Session token for ROOT user:", process.env.ROOT_SESSION_TOKEN);

  // You can call other setup code here, e.g., loadState, etc.

}

start();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});