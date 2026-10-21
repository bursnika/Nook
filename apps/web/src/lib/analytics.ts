/** GA4 custom events. Nothing is sent unless VITE_GA_MEASUREMENT_ID is set at build time. */
type GtagArgs = [string, ...unknown[]];
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

const ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

export function initAnalytics() {
  if (!ID || window.gtag) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function (...args: GtagArgs) {
    window.dataLayer!.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', ID);
}

export type NookEvent = 'page_created' | 'task_completed' | 'calendar_connected';

export function track(event: NookEvent, params: Record<string, unknown> = {}) {
  window.gtag?.('event', event, params);
}
