// Built-in scenario: a sweep over all seven continents, ending on Europe.
// Waypoints are geographic poses; `arcHeight` (Cesium) lifts the camera between
// legs. height is metres above the ellipsoid; pitch is Cesium-style (−90 = down).
export default {
  id: 'seven-continents',
  title: 'The Seven Continents',
  description: 'A Game-of-Thrones-style sweep over all seven continents, ending on Europe.',
  engines: ['cesium', 'maplibre', 'three'],
  settings: { exaggeration: 5 },
  waypoints: [
    { lon: 86.9, lat: 5, height: 14_000_000, heading: 0, pitch: -88, durationMs: 0 },
    { lon: 133, lat: -25, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'Oceania' },
    { lon: 86, lat: 30, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'Asia' },
    { lon: 21, lat: 2, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'Africa' },
    { lon: 20, lat: -78, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'Antarctica' },
    { lon: -63, lat: -16, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'South America' },
    { lon: -98, lat: 41, height: 10_000_000, heading: 0, pitch: -85, durationMs: 6000, arcHeight: 12_000_000, caption: 'North America' },
    { lon: 14, lat: 50, height: 9_000_000, heading: 0, pitch: -88, durationMs: 8000, arcHeight: 12_000_000, caption: 'Europe' },
  ],
};
