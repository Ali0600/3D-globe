// Built-in scenario: dive toward the deepest place on Earth. Shines on CesiumJS
// (real bathymetry); the others approximate the descent.
export default {
  id: 'mariana',
  title: 'Into the Deep',
  description: 'A descent toward the Mariana Trench — the deepest point of the ocean floor.',
  engines: ['cesium', 'maplibre', 'three'],
  settings: { exaggeration: 8 },
  waypoints: [
    { lon: 142, lat: 11, height: 5_000_000, heading: 0, pitch: -75, durationMs: 0 },
    { lon: 142.2, lat: 11.35, height: 700_000, heading: 10, pitch: -45, durationMs: 7000, caption: 'The Mariana Trench' },
    { lon: 142.2, lat: 11.35, height: 160_000, heading: 0, pitch: -35, durationMs: 6000, caption: 'Challenger Deep' },
  ],
};
