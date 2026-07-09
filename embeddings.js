const db = require('./db');

let extractor = null;
let modelLoading = null;

// Initialize the local ONNX feature-extractor pipeline
async function initModel() {
  if (extractor) return extractor;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    try {
      console.log('⏳ Loading local ONNX all-MiniLM-L6-v2 pipeline for embeddings...');
      const { pipeline } = await import('@xenova/transformers');
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('✅ Local ONNX embedding model loaded successfully.');
      return extractor;
    } catch (err) {
      console.error('❌ Failed to load local ONNX model:', err.message);
      modelLoading = null;
      throw err;
    }
  })();

  return modelLoading;
}

// Generate or fetch a normalized embedding for a given text
async function getEmbedding(text) {
  if (!text || typeof text !== 'string') return null;
  const cleanText = text.trim().toLowerCase();
  if (!cleanText) return null;

  try {
    // 1. Check PostgreSQL cache
    const cached = await db.get('SELECT embedding FROM skill_embeddings WHERE skill_name = ?', [cleanText]);
    if (cached && cached.embedding) {
      return JSON.parse(cached.embedding);
    }

    // 2. Generate embedding locally
    const model = await initModel();
    const output = await model(cleanText, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);

    await db.run(
      'INSERT INTO skill_embeddings (skill_name, embedding) VALUES (?, ?) ON CONFLICT (skill_name) DO UPDATE SET embedding = EXCLUDED.embedding',
      [cleanText, JSON.stringify(vector)]
    ).catch(err => console.warn('Cache write failed:', err.message));

    return vector;
  } catch (err) {
    console.warn(`⚠️ Embedding generation failed for "${text}":`, err.message);
    // Return a simple character-level n-gram mock embedding as a robust fallback
    return getMockEmbedding(cleanText);
  }
}

// Simple fallback mock embedding generator (uses character bigrams)
// This guarantees we always return a 384-dimensional vector and cosine similarity is reasonable
function getMockEmbedding(text) {
  const vector = new Array(384).fill(0);
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.charCodeAt(i) + text.charCodeAt(i + 1);
    const index = bigram % 384;
    vector[index] += 1;
  }
  // Normalize the vector
  const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (mag > 0) {
    for (let i = 0; i < 384; i++) vector[i] /= mag;
  } else {
    vector[0] = 1; // unit vector default
  }
  return vector;
}

// Dot product since our vectors are normalized to unit length
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// Helper to batch preload embeddings
async function preloadEmbeddings(skillsList) {
  try {
    await initModel().catch(() => {});
    const uniqueSkills = [...new Set(skillsList.map(s => s.trim().toLowerCase()))].filter(Boolean);
    console.log(`⏳ Preloading embeddings for ${uniqueSkills.length} unique skills...`);
    await Promise.all(uniqueSkills.map(skill => getEmbedding(skill).catch(() => null)));
    console.log('✅ Embedding preloading complete.');
  } catch (err) {
    console.warn('Preloading failed:', err.message);
  }
}

// Rule-based and LLM-ready tag classifier for bio tag extraction
const SKILLS_TAXONOMY = [
  'javascript', 'typescript', 'nodejs', 'react', 'vue', 'angular', 'html', 'css', 'tailwind',
  'python', 'django', 'flask', 'fastapi', 'java', 'spring', 'c++', 'c#', 'dotnet', 'go', 'golang',
  'ruby', 'rails', 'php', 'laravel', 'sql', 'mysql', 'postgresql', 'sqlite', 'mongodb', 'redis',
  'aws', 'docker', 'kubernetes', 'git', 'github', 'devops', 'ci/cd', 'testing', 'jest',
  'machine learning', 'artificial intelligence', 'ai', 'data science', 'pandas', 'numpy', 'pytorch', 'tensorflow',
  'ui/ux', 'design', 'figma', 'photoshop', 'illustrator', 'video editing', 'photography',
  'english', 'spanish', 'french', 'german', 'mandarin', 'japanese', 'korean', 'russian',
  'marketing', 'seo', 'sales', 'finance', 'accounting', 'public speaking', 'writing', 'copywriting',
  'piano', 'guitar', 'violin', 'drums', 'singing', 'music theory', 'cooking', 'baking', 'fitness', 'yoga'
];

async function extractSkillsFromBio(bio, apiKey = null) {
  if (!bio || typeof bio !== 'string') return [];
  
  // If API Key is available, use Gemini to do a smart extraction
  if (apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an expert skill-tag classifier. Analyze the following user bio from a peer-to-peer learning platform and extract a JSON array of up to 5 clear, concise skill tags (e.g., "Python", "React", "Public Speaking", "Guitar").
Return ONLY a valid JSON array of strings and nothing else. No markdown block formatting, no explanations.

Bio: "${bio}"`
              }]
            }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const tags = JSON.parse(text);
          if (Array.isArray(tags)) {
            return tags.map(t => t.trim()).filter(Boolean);
          }
        }
      }
    } catch (err) {
      console.warn('Gemini skill extraction failed, falling back to local taxonomy:', err.message);
    }
  }

  // Fallback: local keyword classifier
  const found = [];
  const text = bio.toLowerCase();
  for (const skill of SKILLS_TAXONOMY) {
    // Regex boundary check to avoid partial matching (e.g. "go" in "good")
    const regex = new RegExp(`\\b${skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (regex.test(text)) {
      // Capitalize first letters for clean display tags
      const capitalized = skill.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      found.push(capitalized);
    }
  }
  return found.slice(0, 5);
}

module.exports = {
  initModel,
  getEmbedding,
  cosineSimilarity,
  preloadEmbeddings,
  extractSkillsFromBio
};
