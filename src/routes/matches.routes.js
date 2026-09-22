// Matches routes: provides ranked peer recommendations based on semantic skill compatibility.
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { getMatchesForUser } = require('../services/matching');

// GET /api/matches
router.get('/', requireAuth, async (req, res) => {
  try {
    const matches = await getMatchesForUser(req.session.userId);
    res.json({ matches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
