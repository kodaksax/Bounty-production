/**
 * Web stub for `react-native-maps`, wired in metro.config.cjs for platform === 'web'.
 *
 * react-native-maps 1.27.2 registers its view managers through Fabric's
 * `codegenNativeComponent`, which does not exist in react-native-web. Bundling it for
 * web therefore throws at module-evaluation time (`codegenNativeComponent is not a
 * function`). Because the throw happens while expo-router is lazily evaluating a route
 * module, the module resolves to `undefined` and the router then fails on
 * `Cannot destructure property 'ErrorBoundary' of 'undefined'` — which is the crash the
 * whole web target died with, one frame removed from its actual cause.
 *
 * The web target exists only so Playwright and the Shoal swarm can drive the product;
 * it is not shipped. So this renders an inert, clearly-labelled placeholder and leaves
 * every surrounding component (address autocomplete, saved locations, the reveal gate)
 * running its real logic, which is the part QA needs to exercise. Native builds never
 * see this file.
 */
const React = require('react');
const { StyleSheet, Text, View } = require('react-native');

const PROVIDER_GOOGLE = 'google';
const PROVIDER_DEFAULT = null;

/**
 * Placeholder styling. Kept as a single StyleSheet so the inert web preview stays
 * visually consistent and future tweaks live in one place rather than inline literals.
 */
const PLACEHOLDER_MIN_HEIGHT = 120;
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6e8eb',
    minHeight: PLACEHOLDER_MIN_HEIGHT,
  },
  label: {
    fontSize: 12,
    color: '#5b6570',
    textAlign: 'center',
  },
});

/** Stable no-op imperative API; identical object every render (see useImperativeHandle deps). */
const createMapHandle = () => ({
  animateToRegion: () => {},
  animateCamera: () => {},
  fitToCoordinates: () => {},
  fitToElements: () => {},
  getMapBoundaries: async () => ({
    northEast: { latitude: 0, longitude: 0 },
    southWest: { latitude: 0, longitude: 0 },
  }),
});

/** True only when both coordinates are real, finite numbers we can safely format. */
const hasRenderableRegion = (r) =>
  !!r && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude));

/** Markers/circles/overlays have no web representation; keep them inert but mounted. */
const nullChild = (name) => {
  const C = () => null;
  C.displayName = name;
  return C;
};

const Marker = nullChild('Marker.web-stub');
const Circle = nullChild('Circle.web-stub');
const Callout = nullChild('Callout.web-stub');
const Polygon = nullChild('Polygon.web-stub');
const Polyline = nullChild('Polyline.web-stub');
const Overlay = nullChild('Overlay.web-stub');
const Heatmap = nullChild('Heatmap.web-stub');

const MapView = React.forwardRef(function MapViewWebStub(props, ref) {
  const { style, children, testID, region, initialRegion } = props || {};
  const r = region || initialRegion;

  // The imperative handle real callers use (animateToRegion, fitToCoordinates...).
  // Empty deps: the handle is a fixed set of no-ops, so build it once and never
  // churn the ref on re-render.
  React.useImperativeHandle(ref, createMapHandle, []);

  const label = hasRenderableRegion(r)
    ? 'Map unavailable on web — ' +
      Number(r.latitude).toFixed(4) +
      ', ' +
      Number(r.longitude).toFixed(4)
    : 'Map unavailable on web';

  return React.createElement(
    View,
    {
      testID: testID || 'map-view-web-stub',
      accessibilityLabel: 'Map preview is not available on web',
      style: [styles.container, style],
    },
    React.createElement(Text, { style: styles.label }, label),
    children,
  );
});

module.exports = MapView;
module.exports.default = MapView;
module.exports.MapView = MapView;
module.exports.Marker = Marker;
module.exports.Circle = Circle;
module.exports.Callout = Callout;
module.exports.Polygon = Polygon;
module.exports.Polyline = Polyline;
module.exports.Overlay = Overlay;
module.exports.Heatmap = Heatmap;
module.exports.PROVIDER_GOOGLE = PROVIDER_GOOGLE;
module.exports.PROVIDER_DEFAULT = PROVIDER_DEFAULT;
module.exports.__esModule = true;
