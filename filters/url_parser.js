// Layer 2: URL detection and categorization.
// Extracts URLs from message text and classifies them by domain.

const DOMAIN_CATEGORIES = {
  // Marketplaces
  'shopee': 'marketplace',
  'lazada': 'marketplace',
  'carousell': 'marketplace',
  'mudah.my': 'marketplace',
  'mercari': 'marketplace',

  // Japanese stores
  'amiami': 'jp_store',
  'mandarake': 'jp_store',
  'suruga-ya': 'jp_store',
  'solarisjapan': 'jp_store',
  'hobbysearch': 'jp_store',
  'hlj.com': 'jp_store',
  'cdjapan': 'jp_store',
  'hobbylink': 'jp_store',

  // Proxy/forwarding services
  'buyee': 'proxy',
  'zenmarket': 'proxy',
  'fromjapan': 'proxy',
  'japonica': 'proxy',

  // Figure manufacturers
  'goodsmile': 'manufacturer',
  'kotobukiya': 'manufacturer',
  'alter-web': 'manufacturer',
  'bandai': 'manufacturer',

  // Social media (less relevant, but capture for context)
  'instagram': 'social',
  'facebook': 'social',
  'twitter': 'social',
  'x.com': 'social',
  'tiktok': 'social',

  // Maps/locations
  'google.com/maps': 'location',
  'maps.google': 'location',
  'goo.gl/maps': 'location',
  'waze.com': 'location',

  // Auction sites
  'yahoo.co.jp/auction': 'auction',
  'page.auctions.yahoo': 'auction',

  // Image hosting (usually figure photos)
  'imgur': 'image',
  'ibb.co': 'image',
};

// URL regex for extracting URLs from text.
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

// Extract and categorize all URLs in a message.
export function analyzeUrls(text, existingLinks = []) {
  const results = {
    urls: [],
    hasUrls: false,
    categories: {},
    storeLinks: [],
    locationLinks: [],
    marketplaceLinks: [],
  };

  // Combine text-extracted URLs with DOM-extracted links.
  const allUrls = new Set(existingLinks || []);
  const textUrls = text?.match(URL_REGEX) || [];
  for (const url of textUrls) {
    allUrls.add(url);
  }

  if (allUrls.size === 0) return results;

  results.hasUrls = true;

  for (const url of allUrls) {
    const category = categorizeUrl(url);
    const urlInfo = {
      url,
      category,
      domain: extractDomain(url),
    };

    results.urls.push(urlInfo);

    if (!results.categories[category]) {
      results.categories[category] = [];
    }
    results.categories[category].push(url);

    // Convenience arrays.
    if (['jp_store', 'manufacturer'].includes(category)) {
      results.storeLinks.push(urlInfo);
    }
    if (category === 'location') {
      results.locationLinks.push(urlInfo);
    }
    if (category === 'marketplace') {
      results.marketplaceLinks.push(urlInfo);
    }
  }

  return results;
}

function categorizeUrl(url) {
  const lower = url.toLowerCase();

  for (const [domain, category] of Object.entries(DOMAIN_CATEGORIES)) {
    if (lower.includes(domain)) {
      return category;
    }
  }

  return 'unknown';
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    // Malformed URL. Extract what we can.
    const match = url.match(/https?:\/\/([^/]+)/);
    return match ? match[1].replace('www.', '') : 'unknown';
  }
}

// Scoring contribution from URL analysis.
export function urlScore(urlAnalysis) {
  if (!urlAnalysis.hasUrls) return 0;

  let score = 0;

  // Store and marketplace links are valuable.
  score += urlAnalysis.storeLinks.length * 4;
  score += urlAnalysis.marketplaceLinks.length * 3;
  score += urlAnalysis.locationLinks.length * 5;

  // Unknown URLs get a small score (worth checking).
  const unknowns = urlAnalysis.categories['unknown'] || [];
  score += unknowns.length * 1;

  return score;
}
