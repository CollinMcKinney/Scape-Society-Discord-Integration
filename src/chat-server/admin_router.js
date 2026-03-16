// admin_router.js
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const adminApi = require("./admin_api"); // only exposes allowed admin functions

const router = express.Router();

// Middleware for this router
router.use(bodyParser.json());

// Serve admin.html (static HTML for the panel)
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Safe admin function caller
router.post("/call", async (req, res) => {
  const { functionName, args } = req.body;

  const func = adminApi[functionName];
  if (!func) {
    return res.status(400).json({ error: "Function not allowed" });
  }

  try {
    // call the admin function with args
    const result = await func(...args);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;