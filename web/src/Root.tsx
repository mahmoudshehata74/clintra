import { lazy, Suspense } from "react";

import App from "./App";
import { isGalleryModeRequested } from "./domain/appMode";

// Lazy so the gallery's own code (and every component it showcases) never
// ships in the bundle a real clinic device loads — only a dynamic import()
// pulls it in, and only when ?gallery=1 actually asks for it.
const Gallery = lazy(() => import("./gallery/Gallery"));

// Decided once, at the same point ?seedDay=1/?demo=1 are read
// (domain/appMode.ts): the gallery replaces the app outright rather than
// layering onto it, so App.tsx's database/registration/lock-screen boot
// sequence never runs for this session at all.
export default function Root() {
  if (isGalleryModeRequested()) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return <App />;
}
