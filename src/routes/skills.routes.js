// Skills routes: allows users to view, add, and delete teach and learn skills.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/skills/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const skills = await db.all(
      'SELECT id, skill_name, skill_type, proficiency_level FROM user_skills WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.json({ skills });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/skills — Add skill
router.post('/', requireAuth, async (req, res) => {
  const { skill_name, skill_type, proficiency_level } = req.body;
  if (!skill_name || !skill_type) return res.status(400).json({ error: 'Skill name and type are required.' });
  if (!['teach', 'learn'].includes(skill_type)) return res.status(400).json({ error: 'Skill type must be teach or learn.' });

  try {
    const existing = await db.get(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_name = ? AND skill_type = ?',
      [req.session.userId, skill_name, skill_type]
    );
    if (existing) return res.status(409).json({ error: `You already have "${skill_name}" as a ${skill_type} skill.` });

    const result = await db.run(
      'INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)',
      [req.session.userId, skill_name, skill_type, proficiency_level || 'beginner']
    );
    res.status(201).json({ id: result.id, skill_name, skill_type, proficiency_level });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: `You already have "${skill_name}" as a ${skill_type} skill.` });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/skills/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const skill = await db.get('SELECT id FROM user_skills WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
    if (!skill) return res.status(404).json({ error: 'Skill not found or not yours.' });
    await db.run('DELETE FROM user_skills WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
