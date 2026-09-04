/**
 * Web stub for `react-native-map-clustering` (see stubs/react-native-maps.web.js).
 *
 * The clustering wrapper re-exports react-native-maps' native MapView, so it drags the
 * same Fabric codegen call into the web bundle even when react-native-maps itself is
 * already aliased. Clustering is a purely visual concern, so on web this is just the
 * stubbed MapView: BountyMapView's data fetching, region state and marker construction
 * all still run and stay observable to QA.
 */
module.exports = require('./react-native-maps.web.js');
