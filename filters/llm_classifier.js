// Layer 3: Gemini API integration for intelligent message classification.

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const RATE_LIMIT = {
  maxPerMinute: 14,
  timestamps: [],
};

function buildPrompt(message) {
  return `You are a message classifier for an anime merchandise hunting tool in Malaysia.
Classify WhatsApp group messages by relevance to anime figure collecting, especially Umamusume.
Messages are primarily in Malay (heavy abbreviations: "blh"="boleh", "dpt"="dapat", "kdai"="kedai", "nk"="nak", "xde"="takde") with some English.

Categories (pick ONE):
- UMAMUSUME_MERCH: Directly about Umamusume merchandise
- FIGURE_SALE: Someone selling/buying anime figures (any franchise)
- STORE_MENTION: Mentions a store that sells anime merchandise
- FIGURE_ANNOUNCEMENT: New figure release or pre-order news
- LOCATION_TIP: Mentions a real-world location for anime merch
- NOISE: Irrelevant chitchat, jokes, greetings, off-topic

Rate relevance to Umamusume collecting 1-5 (1=not relevant, 5=directly about Uma).

Message: "${message.text}"
Sender: "${message.sender}"
Group: "${message.groupName}"
${message.links?.length > 0 ? `Links: ${message.links.join(', ')}` : ''}

Respond ONLY with valid JSON:
{"category":"...","relevance":N,"summary":"brief summary","reasoning":"why this classification"}`;
}

function canMakeRequest() {
  const now = Date.now();
  RATE_LIMIT.timestamps = RATE_LIMIT.timestamps.filter(t => t > now - 60000);
  return RATE_LIMIT.timestamps.length < RATE_LIMIT.maxPerMinute;
}

async function waitForRateLimit() {
  while (!canMakeRequest()) {
    const oldest = RATE_LIMIT.timestamps[0];
    const waitMs = oldest + 60000 - Date.now() + 100;
    await new Promise(r => setTimeout(r, Math.max(waitMs, 500)));
  }
}

export async function classifyWithLLM(message, apiKey) {
  if (!apiKey) throw new Error('Gemini API key not configured.');

  await waitForRateLimit();

  const url = `${GEMINI_ENDPOINT}?key=${apiKey}`;
  let response;
  let retries = 0;

  while (retries < 3) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(message) }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
      });

      RATE_LIMIT.timestamps.push(Date.now());

      if (response.status === 429) {
        const backoff = Math.pow(2, retries) * 5000;
        await new Promise(r => setTimeout(r, backoff));
        retries++;
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText}`);
      }
      break;
    } catch (err) {
      if (retries >= 2) throw err;
      retries++;
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseClassification(rawText);
}

function parseClassification(rawText) {
  const fallback = {
    category: 'NOISE', relevance: 1,
    summary: 'Classification failed.', reasoning: 'Could not parse LLM response.',
    raw: rawText, source: 'gemini',
  };

  try {
    let cleaned = rawText.trim()
      .replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const validCategories = [
      'UMAMUSUME_MERCH', 'FIGURE_SALE', 'STORE_MENTION',
      'FIGURE_ANNOUNCEMENT', 'LOCATION_TIP', 'NOISE',
    ];

    return {
      category: validCategories.includes(parsed.category) ? parsed.category : 'NOISE',
      relevance: typeof parsed.relevance === 'number'
        ? Math.min(5, Math.max(1, Math.round(parsed.relevance))) : 1,
      summary: parsed.summary || '',
      reasoning: parsed.reasoning || '',
      source: 'gemini',
    };
  } catch {
    return fallback;
  }
}
