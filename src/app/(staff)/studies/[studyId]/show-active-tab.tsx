"use client";

import { useEffect } from "react";

/** On a phone the tab row scrolls: bring the current step into view. */
export function ShowActiveTab() {
  useEffect(() => {
    document
      .querySelector('nav[aria-label="Study steps"] [aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  });
  return null;
}
