// app.json stays the source of truth; this only adds the one thing it cannot
// express, because it depends on where the build is being served from.
//
// The web export writes absolute paths (`/_expo/...`), which is right at a
// domain root and wrong under a project path like `/ideal-parakeet/`. Expo
// rewrites them when `experiments.baseUrl` is set, so the Pages workflow sets
// PARAKEET_BASE_URL and nothing else has to know. Unset - local `npm run web`,
// the headless verification, any native build - the export is byte-for-byte
// what it was before this file existed.
module.exports = ({ config }) => {
  const baseUrl = process.env.PARAKEET_BASE_URL;
  if (!baseUrl) return config;
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
