const baseConfig = require('./app.json');

module.exports = () => {
  const config = baseConfig.expo;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (process.env.EAS_BUILD === 'true' && !googleMapsApiKey) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is required for Android APK builds. Add it to the EAS preview environment.'
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config || {}),
        ...(googleMapsApiKey
          ? { googleMaps: { apiKey: googleMapsApiKey } }
          : {}),
      },
    },
  };
};
