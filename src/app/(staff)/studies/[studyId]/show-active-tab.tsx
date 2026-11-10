"use client";

import { useEffect } from "react";

/**
 * On a phone the tab row scrolls sideways: bring the current step into view.
 * Only the tab row moves, never the page (scrollIntoView also scrolled the
 * page back to the tabs after every refresh, e.g. after placing a logger).
 */
export function ShowActiveTab() {
  useEffect(() => {
    const tab = document.querySelector<HTMLElement>(
      'nav[aria-label="Study steps"] [aria-current="page"]',
    );
    const row = tab?.closest("nav");
    if (!tab || !row || row.scrollWidth <= row.clientWidth) return;
    const t = tab.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    row.scrollTo({ left: row.scrollLeft + (t.left - r.left) - (r.width - t.width) / 2 });
  });
  return null;
}
