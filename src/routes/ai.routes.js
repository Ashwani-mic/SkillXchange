// AI assistant routes: exposes Gemini-powered coaching chats, config status, and bio skill extraction.
const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const ai = require('../services/ai');

// GET /api/ai/config
router.get('/config', requireAuth, (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.json({ online: hasKey });
});

// POST /api/ai/chat
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    // Call real LLM (Gemini 2.0 Flash with 1.5 fallback)
    const result = await ai.chatWithGemini(message, context);
    
    if (result && result.reply) {
      return res.json({ reply: result.reply, source: 'gemini' });
    }

    if (result && result.error) {
      console.warn('Gemini API Error:', result.error);
      if (result.error.includes('API_KEY_INVALID') || result.error.includes('400') || result.error.includes('403') || result.error.includes('API key not valid')) {
        return res.json({
          reply: `⚠️ **Gemini API Error:** Your \`GEMINI_API_KEY\` is invalid or expired. Please update it in your environment with a valid key from Google AI Studio.\n\n*(Google response: ${result.error.slice(0, 200)})*`,
          source: 'error'
        });
      }
    }

    // Fallback if API key is not present or failed
    const msg = message.toLowerCase();
    let fallbackReply = '';

    if (msg.includes('lesson plan') || msg.includes('plan')) {
      fallbackReply = `📋 **1-Hour Lesson Plan**\n\n⏱️ 0-10 min: Introductions & goal-setting. What do you each want to learn today?\n⏱️ 10-30 min: Peer A teaches their skill with live demonstration.\n⏱️ 30-35 min: Q&A and hands-on practice.\n⏱️ 35-55 min: Peer B teaches their skill.\n⏱️ 55-60 min: Wrap-up, what we learned, and schedule next session.`;
    } else if (msg.includes('icebreaker')) {
      fallbackReply = `🎯 **3 Great Icebreakers**\n\n1. **"One Cool Thing"** — Each person shares one thing they built or learned recently.\n2. **"Skill Map"** — Draw or describe your skill journey: where you started vs. where you are now.\n3. **"Teach Me 3 Words"** — Spend 2 minutes teaching each other the 3 most important words in your skill's vocabulary.`;
    } else if (msg.includes('time') || msg.includes('split')) {
      fallbackReply = `⏱️ **Recommended Time Split**\n\nFor a 60-minute session:\n- 10 min: Introduction & goals\n- 20 min: Peer 1 teaches\n- 5 min: Break\n- 20 min: Peer 2 teaches\n- 5 min: Review & next steps\n\nFor 30-minute sessions, cut each block in half. Always end with scheduling the next meeting!`;
    } else if (msg.includes('goal') || msg.includes('track') || msg.includes('progress')) {
      fallbackReply = `📈 **Tracking Learning Progress**\n\n✅ Set 3 specific goals per session (not vague ones — be precise!)\n✅ Use the whiteboard to write down key takeaways\n✅ Rate your confidence (1-5) before and after each session\n✅ Keep a "skill journal" — 5 minutes of notes after every class\n✅ Build a small project or demo to validate learning`;
    } else if (msg.includes('beginner') || msg.includes('start')) {
      fallbackReply = `🚀 **Teaching Beginners: Best Practices**\n\n1. Start with WHY — why is this skill valuable?\n2. Use analogies to familiar things (e.g., "HTML is like the bones, CSS is the skin")\n3. Show before you explain — demo first, explain second\n4. Give them something to DO in the first 10 minutes\n5. Celebrate their first small win — it builds confidence`;
    } else if (msg.includes('video') || msg.includes('call') || msg.includes('class')) {
      fallbackReply = `🎓 **Tips for Great Online Sessions**\n\n📷 Good lighting matters more than camera quality\n🎧 Use headphones to avoid echo\n📺 Share your screen when demonstrating — it's 10x clearer\n📝 Use the whiteboard for diagrams and notes\n⏸️ Pause frequently and ask "Does this make sense?" every 5 minutes`;
    } else {
      const generic = [
        `💡 Great question! The most effective peer learning happens when both people are slightly uncomfortable — you're in the "growth zone." Push each other gently!`,
        `🧠 Research shows that teaching something is the best way to truly learn it. Even as the "teacher," you'll discover new insights by explaining concepts aloud.`,
        `🤝 The best skill exchanges start with trust. Spend the first few minutes getting to know each other before diving into content.`,
        `📚 Feynman Technique: Explain the concept as if teaching a 12-year-old. Where you struggle to simplify — that's where your knowledge gap is. Perfect for identifying what to study next!`,
        `⚡ Schedule your next session BEFORE you end the current one. Consistency is the #1 factor in successful skill learning.`,
      ];
      fallbackReply = generic[Math.floor(Math.random() * generic.length)];
    }

    // Add a helper hint to configure Gemini key
    fallbackReply += `\n\n*⚙️ [AI running in local keyword fallback mode. Set GEMINI_API_KEY in your .env to unlock real Gemini 2.0 Flash answers!]*`;

    res.json({ reply: fallbackReply, source: 'fallback' });
  } catch (err) {
    console.error('AI chat error:', err?.message || err);
    res.status(500).json({ error: 'AI Assistant request failed.', reply: 'I am here to help you exchange skills. Try asking for a lesson plan or icebreakers!' });
  }
});

// POST /api/ai/extract-tags
router.post('/extract-tags', requireAuth, async (req, res) => {
  try {
    const { bio } = req.body;
    if (!bio) return res.status(400).json({ error: 'Bio text is required.' });

    const tags = await ai.extractSkills(bio);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
