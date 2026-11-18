import { defineAssets } from '@iwsdk/core';

// Every mesh, texture and sound in Shadow Play is generated at runtime,
// so the asset manifest is intentionally empty (fast cold start, no CDN).
export default defineAssets({});
