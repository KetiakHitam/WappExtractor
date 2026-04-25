// Discord webhook notification sender.
// Formats classified messages as rich embeds and dispatches them.

const CATEGORY_COLORS = {
  UMAMUSUME_MERCH: 0x7c3aed,    // Purple (primary accent)
  STORE_MENTION: 0x10b981,       // Green
  LOCATION_TIP: 0x3b82f6,        // Blue
  FIGURE_SALE: 0xf59e0b,         // Amber
  FIGURE_ANNOUNCEMENT: 0xec4899, // Pink
  NOISE: 0x6b7280,               // Gray
};

const CATEGORY_LABELS = {
  UMAMUSUME_MERCH: 'Umamusume Merch',
  STORE_MENTION: 'Store Mention',
  LOCATION_TIP: 'Location Tip',
  FIGURE_SALE: 'Figure Sale',
  FIGURE_ANNOUNCEMENT: 'Figure Announcement',
  NOISE: 'Noise',
};

// Rate limiter for Discord webhooks (30 per minute).
const DISCORD_RATE = {
  maxPerMinute: 25, // Keep buffer.
  timestamps: [],
};

async function waitForDiscordRate() {
  const now = Date.now();
  DISCORD_RATE.timestamps = DISCORD_RATE.timestamps.filter(t => t > now - 60000);

  while (DISCORD_RATE.timestamps.length >= DISCORD_RATE.maxPerMinute) {
    const oldest = DISCORD_RATE.timestamps[0];
    const waitMs = oldest + 60000 - Date.now() + 100;
    await new Promise(r => setTimeout(r, Math.max(waitMs, 500)));
    DISCORD_RATE.timestamps = DISCORD_RATE.timestamps.filter(t => t > Date.now() - 60000);
  }
}

export async function sendDiscordAlert(webhookUrl, message, classification) {
  if (!webhookUrl) return { ok: false, error: 'No webhook URL configured.' };

  await waitForDiscordRate();

  const color = CATEGORY_COLORS[classification.category] || 0x6b7280;
  const label = CATEGORY_LABELS[classification.category] || classification.category;

  // Build relevance bar (visual indicator).
  const relevanceBar = buildRelevanceBar(classification.relevance);

  const fields = [
    { name: 'Category', value: `\`${label}\``, inline: true },
    { name: 'Relevance', value: `${relevanceBar} (${classification.relevance}/5)`, inline: true },
    { name: 'Group', value: message.groupName || 'Unknown', inline: true },
    { name: 'Sender', value: message.sender || 'Unknown', inline: true },
  ];

  if (classification.summary) {
    fields.push({ name: 'Summary', value: classification.summary, inline: false });
  }

  if (message.links && message.links.length > 0) {
    const linkList = message.links.slice(0, 5).join('\n');
    fields.push({ name: 'Links', value: linkList, inline: false });
  }

  if (classification.keywordHits && classification.keywordHits.length > 0) {
    const kwList = classification.keywordHits.slice(0, 10).map(k => `\`${k}\``).join(', ');
    fields.push({ name: 'Keyword Hits', value: kwList, inline: false });
  }

  const embed = {
    title: `New Match - ${label}`,
    description: truncateText(message.text, 1000),
    color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'WappExtractor' },
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    DISCORD_RATE.timestamps.push(Date.now());

    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Discord error ${resp.status}: ${errText}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildRelevanceBar(level) {
  const filled = '\u2588'; // Full block.
  const empty = '\u2591';  // Light shade.
  return filled.repeat(level) + empty.repeat(5 - level);
}

function truncateText(text, maxLen) {
  if (!text) return '_No text content_';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}
