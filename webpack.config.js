const path = require('path');
const createExpoWebpackConfigAsync = require('@expo/webpack-config');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);

  // Alias the native Stripe SDK to a web stub to avoid importing native-only modules on web
  config.resolve = config.resolve || {};
  config.resolve.alias = Object.assign({}, config.resolve.alias || {}, {
    '@stripe/stripe-react-native': path.resolve(__dirname, 'lib/services/stripe-mock.web.js'),
  });

  return config;
};
