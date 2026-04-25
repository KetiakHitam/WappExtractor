// Filtering pipeline orchestrator.
// Runs messages through Layer 1 (keywords), Layer 2 (URLs), Layer 3 (LLM).

import { loadKeywords, scoreMessage, passesThreshold } from './keywords.js';
import { analyzeUrls, urlScore } from './url_parser.js';
import { classifyWithLLM } from './llm_classifier.js';

export class FilterPipeline {
  constructor(settingsManager) {
    this.settings = settingsManager;
    this.keywordConfig = null;
  }

  async ensureKeywords() {
    if (!this.keywordConfig) {
      this.keywordConfig = await loadKeywords();
    }
    return this.keywordConfig;
  }

  // Quick classification using only Layer 1 + 2 (no API calls).
  // Used when Gemini API key is not configured.
  preClassify(message) {
    const keywords = this.keywordConfig || {};
    const kwResult = scoreMessage(message.text, keywords);
    const urlResult = analyzeUrls(message.text, message.links);
    const urlPoints = urlScore(urlResult);
    const totalScore = kwResult.score + urlPoints;

    // Map score to a category based on what was hit.
    let category = 'NOISE';
    let relevance = 1;

    if (kwResult.categories?.umamusume) {
      category = 'UMAMUSUME_MERCH';
      relevance = Math.min(5, 3 + kwResult.categories.umamusume.hits.length);
    } else if (urlResult.storeLinks.length > 0 || urlResult.marketplaceLinks.length > 0) {
      category = 'STORE_MENTION';
      relevance = 3;
    } else if (urlResult.locationLinks.length > 0) {
      category = 'LOCATION_TIP';
      relevance = 3;
    } else if (kwResult.categories?.merch || kwResult.categories?.stores) {
      category = 'FIGURE_SALE';
      relevance = 2;
    } else if (kwResult.categories?.locations || kwResult.categories?.stores) {
      category = 'LOCATION_TIP';
      relevance = 2;
    } else if (kwResult.categories?.announcements) {
      category = 'FIGURE_ANNOUNCEMENT';
      relevance = 2;
    } else if (totalScore >= 2) {
      category = 'FIGURE_SALE';
      relevance = 2;
    }

    return {
      category,
      relevance,
      summary: `Keyword score: ${kwResult.score}, URL score: ${urlPoints}`,
      reasoning: `Matched categories: ${Object.keys(kwResult.categories).join(', ') || 'none'}`,
      keywordHits: kwResult.hits.map(h => h.term),
      source: 'local',
    };
  }

  // Full classification using all three layers.
  async classify(message) {
    await this.ensureKeywords();

    const config = await this.settings.getAll();
    const sensitivity = config.filterSensitivity || 'balanced';

    // Layer 1: Keywords.
    const kwResult = scoreMessage(message.text, this.keywordConfig);

    // Excluded messages skip everything.
    if (kwResult.excluded) {
      return {
        category: 'NOISE', relevance: 1,
        summary: 'Excluded by keyword filter.',
        reasoning: 'Message matched exclusion list.',
        keywordHits: [], source: 'local',
      };
    }

    // Layer 2: URLs.
    const urlResult = analyzeUrls(message.text, message.links);
    const urlPoints = urlScore(urlResult);
    const totalScore = kwResult.score + urlPoints;

    // Determine if LLM classification is needed.
    const isCandidate = passesThreshold(totalScore, sensitivity);
    const hasRelevantUrls = urlResult.storeLinks.length > 0
      || urlResult.locationLinks.length > 0
      || urlResult.marketplaceLinks.length > 0;

    const shouldUseLLM = isCandidate || hasRelevantUrls || sensitivity === 'aggressive';

    if (!shouldUseLLM) {
      // Low score, no interesting URLs. Classify as noise locally.
      return {
        category: 'NOISE', relevance: 1,
        summary: 'Below threshold. No LLM classification needed.',
        reasoning: `Score ${totalScore} below ${sensitivity} threshold.`,
        keywordHits: kwResult.hits.map(h => h.term),
        source: 'local',
      };
    }

    // Layer 3: LLM classification.
    try {
      const apiKey = config.geminiApiKey;
      if (!apiKey) {
        return this.preClassify(message);
      }

      const llmResult = await classifyWithLLM(message, apiKey);

      // Merge keyword hits into the LLM result.
      llmResult.keywordHits = kwResult.hits.map(h => h.term);

      // Override the LLM if it hallucinated NOISE but we have a strong keyword match
      if (llmResult.category === 'NOISE') {
        if (kwResult.categories?.umamusume) {
          llmResult.category = 'UMAMUSUME_MERCH';
          llmResult.relevance = Math.max(llmResult.relevance, 4);
        } else if (kwResult.categories?.merch || kwResult.categories?.stores) {
          llmResult.category = 'FIGURE_SALE';
          llmResult.relevance = Math.max(llmResult.relevance, 3);
        } else if (kwResult.categories?.locations) {
          llmResult.category = 'LOCATION_TIP';
          llmResult.relevance = Math.max(llmResult.relevance, 3);
        } else if (kwResult.categories?.announcements) {
          llmResult.category = 'FIGURE_ANNOUNCEMENT';
          llmResult.relevance = Math.max(llmResult.relevance, 3);
        }
      } else {
        // If LLM picked a valid category, just ensure the relevance is boosted
        if (kwResult.categories?.umamusume) llmResult.relevance = Math.max(llmResult.relevance, 4);
        else if (kwResult.categories?.merch || kwResult.categories?.stores) llmResult.relevance = Math.max(llmResult.relevance, 3);
      }

      // DEBUG: Append exactly which categories matched so we can see what's failing
      const termsStr = kwResult.categories?.umamusume ? 'MATCHED' : (this.keywordConfig?.umamusume?.terms?.join(', ') || 'NOT FOUND');
      llmResult.summary = (llmResult.summary || '') + ` | DEBUG HITS: ${Object.keys(kwResult.categories).join(', ')} | UMA_TERMS: ${termsStr}`;

      return llmResult;
    } catch (err) {
      console.error('[WappExtractor] LLM classification failed:', err);
      // Fall back to local classification.
      return this.preClassify(message);
    }
  }

  // Reload keywords (after user edits).
  async reloadKeywords() {
    this.keywordConfig = await loadKeywords();
  }
}
