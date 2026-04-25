import fs from 'fs';

function scoreMessage(text, config) {
  if (!text || !config) {
    return { score: 0, hits: [], categories: {} };
  }

  const lowerText = text.toLowerCase();
  const hits = [];
  const categories = {};
  let totalScore = 0;

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

  return {
    score: Math.round(totalScore * 100) / 100,
    hits,
    categories,
  };
}

const config = {
  "Umamusume": {
    "confidence": "high",
    "terms": ["hachimi"]
  },
  "Merch": {
    "confidence": "medium",
    "terms": ["hachimi"]
  },
  "Stores": {
    "confidence": "medium",
    "terms": ["hachimi"]
  }
};

const text = "tung tung tung sahur hachimi mambo";
const kwResult = scoreMessage(text, config);

let category = 'NOISE';
let relevance = 1;

if (kwResult.categories?.umamusume) {
  category = 'UMAMUSUME_MERCH';
  relevance = Math.max(relevance, 4);
} else if (kwResult.categories?.merch || kwResult.categories?.stores) {
  category = 'FIGURE_SALE';
  relevance = Math.max(relevance, 3);
}

console.log("Pre-classify output:", { category, relevance });
console.log("Categories object:", kwResult.categories);
