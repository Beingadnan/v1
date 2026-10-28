"use client";

import { setNonce } from "get-nonce";

let applied = false;

/**
 * Dialogs and menus (Radix) lock page scrolling by injecting a small <style>
 * tag through react-style-singleton. Under our nonce-only Content-Security-
 * Policy that tag is blocked unless it carries the nonce of the policy the
 * browser is enforcing.
 *
 * A policy is fixed for the life of a page load, but client-side navigations
 * (including server-action redirects) re-render the layout with a newer
 * request's nonce. So the nonce is read once from this document's own script
 * tags, which always match the policy in force, not from props.
 */
export function CspNonce() {
  if (!applied && typeof document !== "undefined") {
    const script = document.querySelector<HTMLScriptElement>("script[nonce]");
    // Browsers hide the nonce attribute after load; the property keeps the value.
    const nonce = script?.nonce || script?.getAttribute("nonce") || "";
    if (nonce) {
      setNonce(nonce);
      applied = true;
    }
  }
  return null;
}
