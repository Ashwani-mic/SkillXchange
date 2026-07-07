const { extractSkillsFromBio } = require('./embeddings');

// Simple helper to call Gemini 2.5 Flash API
async function callGeminiAPI(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }
  return text;
}

// Main AI chat wrapper
async function chatWithGemini(message, chatContext = '', apiKey = null) {
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  }

  if (!apiKey) {
    // Graceful offline local fallback message
    return null;
  }

  const systemContext = `You are a helpful and expert Learning Coach assistant on SkillXchange, a peer-to-peer skill-sharing platform. 
SkillXchange allows users to teach skills they are good at and learn skills they want to study.
The user is asking a question inside their virtual classroom or dashboard.

Context of the current conversation/session:
${chatContext || 'General skill exchange session'}

Guidelines:
- Provide highly constructive, educational, and inspiring advice.
- If they ask for a lesson plan, split it logically (e.g. 10m setup, 20m teach, etc.).
- Keep your formatting clean using concise Markdown. Keep it under 250 words.`;

  const prompt = `${systemContext}\n\nUser Question: "${message}"\nAssistant Answer:`;

  try {
    const reply = await callGeminiAPI(prompt, apiKey);
    return reply.trim();
  } catch (err) {
    console.error('Failed to chat with Gemini:', err.message);
    return null;
  }
}

// Smart skill extractor
async function extractSkills(bio, apiKey = null) {
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  }

  // Use the local or remote tag extractor defined in embeddings.js
  const tags = await extractSkillsFromBio(bio, apiKey);
  
  // Categorize tags into teach and learn lists
  // If we don't have Gemini, we will suggest them generally and let the user categorize them.
  // If we have Gemini, we can ask for structured teach/learn mapping.
  if (apiKey) {
    try {
      const prompt = `You are an expert skill-tag classifier. Analyze this user bio: "${bio}"
Extract:
1. Skills they can teach (skills they possess, teach, or share).
2. Skills they want to learn (skills they want to study, acquire, or practice).

Return a valid JSON object ONLY with the following structure:
{
  "teach": ["SkillA", "SkillB"],
  "learn": ["SkillC", "SkillD"]
}
Do not return any explanations or markdown blocks.`;
      
      const responseText = await callGeminiAPI(prompt, apiKey);
      const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      if (parsed && (Array.isArray(parsed.teach) || Array.isArray(parsed.learn))) {
        return {
          teach: Array.isArray(parsed.teach) ? parsed.teach : [],
          learn: Array.isArray(parsed.learn) ? parsed.learn : []
        };
      }
    } catch (err) {
      console.warn('Gemini structured extraction failed, mapping flat list:', err.message);
    }
  }

  // Fallback: we return the flat tags list under both categories so the user can choose
  return {
    teach: tags,
    learn: tags
  };
}

module.exports = {
  chatWithGemini,
  extractSkills
};
