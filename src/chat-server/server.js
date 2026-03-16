// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { initStorage, saveState, loadState, client } = require("./datastore");
const auth = require("./auth");
const users = require("./users");

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
  console.log("Server ready!");

  // Create ROOT user if needed
  const root = await users.createUserInternal({ 
    osrs_name: "ROOT", 
    disc_name: "ROOT#0000", 
    forum_name: "ROOT", 
    role: users.Roles.ROOT, 
    hashedPass: users.hashToken("password") 
  });

  const sessionToken = await auth.authenticate({
        userId: root.id,
        hashedPass: root.hashedPass
    });
  const verifiedUserId = await auth.verifySession(root.id, sessionToken);

  console.log("Verified user ID from session token:", verifiedUserId);
  console.log("Session token for ROOT user:", sessionToken);

  // You can call other setup code here, e.g., loadState, etc.

}

start();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});