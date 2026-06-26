// Built-in scenario: a closer, oblique pass over the Himalaya.
// (Cesium/MapLibre render the oblique angle; the Three.js Earth is top-down-centric.)
export default {
  id: 'himalaya',
  title: 'Himalaya Flyover',
  description: 'A low, oblique sweep across the highest mountains on Earth.',
  engines: ['cesium', 'maplibre', 'three'],
  settings: { exaggeration: 7 },
  waypoints: [
    { lon: 78, lat: 22, height: 2_000_000, heading: 45, pitch: -55, durationMs: 0 },
    { lon: 84, lat: 27.5, height: 420_000, heading: 25, pitch: -25, durationMs: 7000, caption: 'The Himalaya' },
    { lon: 86.925, lat: 27.6, height: 240_000, heading: 350, pitch: -18, durationMs: 6000, caption: 'Everest' },
    { lon: 90, lat: 28, height: 360_000, heading: 320, pitch: -22, durationMs: 6000, caption: 'The Roof of the World' },
  ],
};
