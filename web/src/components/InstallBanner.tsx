import { useEffect, useState } from "react";
import { installBannerStrings } from "./strings";

const DISMISSED_STORAGE_KEY = "clintra-install-banner-dismissed";

/** The non-standard event Chromium fires when it judges the page installable. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function wasDismissed(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
}

function persistDismissed(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
  }
}

/**
 * A small, in-flow install invite — never fixed/overlaying, so it never
 * competes with the day screen's own bottom-fixed toast and action buttons.
 * Shown only once the browser fires beforeinstallprompt, and hidden for good
 * (across reloads) the moment the app is installed or the banner dismissed.
 */
export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(wasDismissed);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      persistDismissed();
      setIsDismissed(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (isDismissed || !deferredPrompt) {
    return null;
  }

  async function handleInstall() {
    await deferredPrompt!.prompt();
    await deferredPrompt!.userChoice;
    persistDismissed();
    setIsDismissed(true);
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    persistDismissed();
    setIsDismissed(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-green-soft px-4 py-2">
      <p className="text-sm">{installBannerStrings.message}</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={handleInstall}
          className="rounded-full bg-green px-3 py-1.5 text-sm font-semibold text-paper"
        >
          {installBannerStrings.installAction}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={installBannerStrings.dismissAriaLabel}
          className="rounded-full border border-line px-3 py-1.5 text-sm"
        >
          {installBannerStrings.dismissAction}
        </button>
      </div>
    </div>
  );
}
