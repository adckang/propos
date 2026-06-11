import { track as vercelTrack } from "@vercel/analytics";

const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim();
const IS_BROWSER = typeof window !== "undefined";
const IS_PROD = import.meta.env.PROD;

function getSafeProperties(properties) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return properties;
}

export function initClarity() {
  if (!IS_BROWSER || !IS_PROD || !CLARITY_PROJECT_ID) return;
  if (window.__clarityInitialized) return;

  ((c, l, a, r, i, t, y) => {
    c[a] = c[a] || function clarityProxy() {
      (c[a].q = c[a].q || []).push(arguments);
    };
    t = l.createElement(r);
    t.async = 1;
    t.src = `https://www.clarity.ms/tag/${i}`;
    y = l.getElementsByTagName(r)[0];
    y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);

  window.__clarityInitialized = true;
}

export function trackEvent(eventName, properties = {}) {
  const safeProperties = getSafeProperties(properties);

  if (!IS_PROD) {
    console.debug("[analytics:event]", eventName, safeProperties);
    return;
  }

  try {
    if (typeof window.clarity === "function") {
      window.clarity("event", eventName);
    }
  } catch {
    // Clarity is optional and should never break the landing page.
  }

  try {
    vercelTrack(eventName, safeProperties);
  } catch {
    // Vercel custom events can be unavailable depending on environment/plan.
  }
}

/*
  Core landing metrics to review:
  - hero_cta_click: whether the first screen drives inquiry intent
  - price_view: whether visitors reach pricing
  - price_cta_click: whether interest survives after seeing pricing
  - faq_open: which concerns trigger extra reading
  - kakao_click: whether visitors prefer direct chat inquiry when added later

  Never include form inputs, phone numbers, email addresses, or free-text payloads.
*/
