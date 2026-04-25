// Layer 1: Keyword matching engine.
// Scores messages based on keyword hits across multiple categories.

let keywordConfig = null;

export async function loadKeywords() {
  if (keywordConfig) return keywordConfig;

  try {
    // Load from Chrome storage first (user may have customized).
    const stored = await new Promise(resolve => {
      chrome.storage.local.get('keywords', result => {
        resolve(result.keywords || null);
      });
    });

    if (stored) {
      keywordConfig = stored;
      return keywordConfig;
    }

    // Fall back to bundled config.
    const resp = await fetch(chrome.runtime.getURL('config/keywords.json'));
    keywordConfig = await resp.json();
    return keywordConfig;
  } catch (err) {
    console.error('[WappExtractor] Failed to load keywords:', err);
    keywordConfig = {};
    return keywordConfig;
  }
}

// Save updated keywords (from dashboard edits).
export async function saveKeywords(config) {
  keywordConfig = config;
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ keywords: config }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Score a message against all keyword categories.
// Returns: { score, hits, categories }
export function scoreMessage(text, config) {
  if (!text || !config) {
    return { score: 0, hits: [], categories: {} };
  }

  const lowerText = text.toLowerCase();
  const hits = [];
  const categories = {};
  let totalScore = 0;

  // Check exclusion list first.
  const excludeTerms = config.exclude?.terms || [];
  const isExcluded = excludeTerms.some(term => {
    const lower = term.toLowerCase();
    // Only exclude if the entire message is just the excluded term.
    return lowerText.trim() === lower;
  });

  if (isExcluded) {
    return { score: -1, hits: [], categories: {}, excluded: true };
  }

  for (const [category, data] of Object.entries(config)) {
    if (category === 'exclude') continue;

    const confidence = data.confidence || 'medium';
    const multiplier = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
    const terms = data.terms || [];
    const categoryHits = [];

    const lowerCategory = category.toLowerCase();

    for (const term of terms) {
      const lowerTerm = term.toLowerCase();
      if (lowerText.includes(lowerTerm)) {
        categoryHits.push(term);
        hits.push({ term, category, confidence });
      }
    }

    if (categoryHits.length > 0) {
      const categoryScore = categoryHits.length * multiplier;
      categories[lowerCategory] = {
        hits: categoryHits,
        score: categoryScore,
      };
      totalScore += categoryScore;
    }
  }

  // Bonus for multi-category hits (e.g., umamusume + merch = very relevant).
  const categoryCount = Object.keys(categories).length;
  if (categoryCount >= 2) {
    totalScore *= 1 + (categoryCount - 1) * 0.5;
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    hits,
    categories,
    categoryCount,
  };
}

// Determine if a score passes the threshold based on sensitivity.
export function passesThreshold(score, sensitivity) {
  const thresholds = {
    aggressive: 1,
    balanced: 3,
    conservative: 6,
  };
  return score >= (thresholds[sensitivity] || 3);
}
