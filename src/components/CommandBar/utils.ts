// Layout constants
export const LINE_HEIGHT = 21; // 14px font-size * 1.5 line-height
export const MAX_LINES = 3;
export const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 63px
export const BASE_HEIGHT = 38; // Single line input + minimal padding
export const MAX_AGENT_AREA_HEIGHT = 63; // 3 lines for agent/status area

// Placeholder texts shown when the command bar opens
export const PLACEHOLDER_TEXTS = [
  "What do you seek?",
  "What weighs upon your mind?",
  "The present is but a bridge...",
  "In what direction shall we proceed?",
  "Time reveals all things...",
  "What truth shall we uncover?",
  "What hidden thing seeks light?",
  "Life is a tempest, one must learn to sail...",
  "What door shall we open?",
  "In what cavern of thought shall we dwell?",
  "What sleeping thing shall we awaken?",
  "To wait and to hope...",
  "What treasure lies buried in your mind?",
  "What revenge upon ignorance shall we take?",
  "The slow unraveling of all things...",
  "One must have lived to know...",
  "What shadows dance at the edge of understanding?",
  "What song does solitude sing?",
  "What melody does the wind play?",
  "What shadow does the sun cast?",
];

// Default theme colors (fallback only)
export const DEFAULT_COLORS = { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' };

// Toolkit slug display name mappings
const TOOLKIT_NAMES: Record<string, string> = {
  'perplexityai': 'Perplexity AI',
  'retellai': 'Retell AI',
  'openai': 'OpenAI',
  'googlecalendar': 'Google Calendar',
  'googledrive': 'Google Drive',
  'googlesheets': 'Google Sheets',
  'googledocs': 'Google Docs',
  'googlemeet': 'Google Meet',
  'googlemail': 'Google Mail',
  'github': 'GitHub',
  'gitlab': 'GitLab',
  'linkedin': 'LinkedIn',
  'youtube': 'YouTube',
  'chatgpt': 'ChatGPT',
  'hubspot': 'HubSpot',
  'clickup': 'ClickUp',
  'sendgrid': 'SendGrid',
  'whatsapp': 'WhatsApp',
  'tiktok': 'TikTok',
  'soundcloud': 'SoundCloud',
  'woocommerce': 'WooCommerce',
};

/** Convert a toolkit slug (e.g. 'perplexityai') into a display name (e.g. 'Perplexity AI'). */
export function formatToolkitName(slug: string): string {
  const direct = TOOLKIT_NAMES[slug.toLowerCase()];
  if (direct) return direct;

  return slug
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(ai)$/i, '$1 $2')
    .replace(/(calendar|drive|sheets|docs|mail|meet|chat|cloud|hub)$/gi, ' $1')
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (['ai', 'api', 'crm', 'io'].includes(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}

/** Lighten or darken a hex color by a factor (>1 lightens, <1 darkens). */
export function adjustColor(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * factor)));
  const b = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Convert a hex color to an rgba string. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Apply theme CSS variables to document.documentElement. */
export function applyTheme(theme: string, colors?: { background: string; text: string; accent: string }, font?: string) {
  const c = colors || DEFAULT_COLORS;
  const doc = document.documentElement;

  // Base colors
  doc.style.setProperty('--color-primary', c.background);
  doc.style.setProperty('--color-secondary', c.text);
  doc.style.setProperty('--color-accent', c.accent);

  // Derived colors
  doc.style.setProperty('--color-primary-light', adjustColor(c.background, 1.2));
  doc.style.setProperty('--color-primary-dark', adjustColor(c.background, 0.7));
  doc.style.setProperty('--color-secondary-muted', c.text + 'B3');
  doc.style.setProperty('--color-accent-hover', adjustColor(c.accent, 1.15));
  doc.style.setProperty('--color-accent-active', adjustColor(c.accent, 0.85));

  // UI colors
  doc.style.setProperty('--color-background', c.background);
  doc.style.setProperty('--color-surface', adjustColor(c.background, 1.2));
  doc.style.setProperty('--color-text', c.text);
  doc.style.setProperty('--color-text-muted', c.text + 'B3');
  doc.style.setProperty('--color-border', c.text + '26');
  doc.style.setProperty('--color-hover', c.text + '14');

  if (font) {
    doc.style.setProperty('--font-family', font);
  }

  doc.setAttribute('data-theme', theme === 'custom' ? 'custom' : theme);
}
