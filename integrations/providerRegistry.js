const GHLProvider = require('./providers/ghl');

const providers = {
  ghl: GHLProvider,
  // hubspot: HubSpotProvider, // Future
};

function getProvider(name, connectionInfo) {
  const ProviderClass = providers[name];
  if (!ProviderClass) {
    throw new Error(`Unsupported provider: ${name}`);
  }
  return new ProviderClass(connectionInfo);
}

module.exports = { getProvider };
