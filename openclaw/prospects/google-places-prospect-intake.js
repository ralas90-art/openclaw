const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { addProspects } = require('./prospect-store');

const QUOTA_FILE = path.resolve(__dirname, 'data', 'daily_query_count.json');

// Helper to parse address into town and region
function parseAddress(address) {
  const parts = (address || '').split(',').map(s => s.trim());
  let town = 'Unknown';
  let region = 'Unknown';
  
  // Try to find the component that looks like state + zip
  let stateZipIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Z]{2}(?:\s+\d{5})?$/.test(parts[i]) || /^[A-Z]{2}\s+\d{5}-\d{4}$/.test(parts[i])) {
      stateZipIndex = i;
      break;
    }
  }
  
  if (stateZipIndex !== -1) {
    const stateZip = parts[stateZipIndex];
    const match = stateZip.match(/([A-Z]{2})/);
    region = match ? match[1] : stateZip;
    if (stateZipIndex > 0) {
      town = parts[stateZipIndex - 1];
    }
  } else if (parts.length >= 3) {
    const szIndex = parts.length - 2;
    const tIndex = parts.length - 3;
    town = parts[tIndex] || 'Unknown';
    region = parts[szIndex] || 'Unknown';
  } else if (parts.length === 2) {
    town = parts[0];
    region = parts[1];
  } else if (parts.length === 1 && parts[0]) {
    town = parts[0];
  }
  return { town, region };
}

function getDailyQueryCount() {
  const today = new Date().toISOString().split('T')[0];
  try {
    if (fs.existsSync(QUOTA_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
      if (data.date === today) {
        return data.count || 0;
      }
    }
  } catch (err) {
    console.error(`[ProspectIntake] Error reading query count: ${err.message}`);
  }
  return 0;
}

function incrementDailyQueryCount() {
  const today = new Date().toISOString().split('T')[0];
  const current = getDailyQueryCount();
  const data = { date: today, count: current + 1 };
  try {
    const dataDir = path.dirname(QUOTA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[ProspectIntake] Error writing query count: ${err.message}`);
  }
  return current + 1;
}

async function searchLocalProspects(textQuery, options = {}) {
  const enabled = process.env.GOOGLE_PLACES_PROSPECTING_ENABLED === 'true';
  const limit = parseInt(process.env.GOOGLE_PLACES_DAILY_QUERY_LIMIT || '25', 10);
  const currentCount = getDailyQueryCount();

  if (currentCount >= limit) {
    throw new Error(`Google Places API daily query limit reached: ${currentCount}/${limit}`);
  }

  // Increment daily query counter
  incrementDailyQueryCount();

  // Resolve Field Profile
  const fieldProfile = options.fieldProfile || process.env.GOOGLE_PLACES_FIELD_PROFILE || 'BASIC_DISCOVERY';
  if (fieldProfile !== 'BASIC_DISCOVERY' && fieldProfile !== 'ENRICHED_DISCOVERY') {
    throw new Error(`Invalid field profile: ${fieldProfile}`);
  }

  // Resolve Max Results limit
  const maxResults = parseInt(options.maxResults || process.env.GOOGLE_PLACES_MAX_RESULTS_PER_QUERY || '10', 10);

  const defaultRegion = process.env.GOOGLE_PLACES_DEFAULT_REGION || 'Suffolk County, NY';
  const queryRegion = options.region || defaultRegion;
  const fullQuery = `${textQuery} in ${queryRegion}`;

  if (!enabled) {
    // Return mock results
    console.log(`[ProspectIntake] Mock mode active. Generating mock results for: "${fullQuery}"`);
    const mockProspects = [
      {
        placeId: `mock_p_${textQuery.toLowerCase().replace(/\s+/g, '_')}_1`,
        businessName: `Prime ${textQuery} Pros`,
        formattedAddress: `100 Main St, Patchogue, NY 11772, USA`,
        latitude: 40.75,
        longitude: -73.0,
        googleMapsUri: `https://maps.google.com/?cid=mock1`,
        category: 'contractor',
        query: textQuery,
        fieldProfile,
        source: 'mock',
        confidence: 0.8,
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {}
      },
      {
        placeId: `mock_p_${textQuery.toLowerCase().replace(/\s+/g, '_')}_2`,
        businessName: `Apex ${textQuery} Service`,
        formattedAddress: `202 Broad St, Riverhead, NY 11901, USA`,
        latitude: 40.76,
        longitude: -72.98,
        googleMapsUri: `https://maps.google.com/?cid=mock2`,
        category: 'local_business',
        query: textQuery,
        fieldProfile,
        source: 'mock',
        confidence: 0.8,
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {}
      }
    ];

    // Enrich only if ENRICHED_DISCOVERY is selected
    if (fieldProfile === 'ENRICHED_DISCOVERY') {
      mockProspects[0].phoneNumber = '+1-516-555-0199';
      mockProspects[0].website = 'https://primeprospecttestexample.com';
      mockProspects[0].rating = 4.8;
      mockProspects[0].userRatingCount = 42;

      mockProspects[1].phoneNumber = '+1-516-555-0288';
      mockProspects[1].website = 'https://apexprospecttestexample.com';
      mockProspects[1].rating = 4.5;
      mockProspects[1].userRatingCount = 19;
    }

    // Parse town and region and slice by maxResults limit
    const slicedMock = mockProspects.slice(0, maxResults);
    for (const p of slicedMock) {
      const { town, region } = parseAddress(p.formattedAddress);
      p.town = town;
      p.region = region;
    }

    addProspects(slicedMock);
    return slicedMock;
  }

  // Live call to Google Places Text Search (New)
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured on the server');
  }

  console.log(`[ProspectIntake] Calling live Google Places API with ${fieldProfile} for query: "${fullQuery}"`);

  // Define Field Masks
  let fieldMask = '';
  if (fieldProfile === 'BASIC_DISCOVERY') {
    fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri';
  } else {
    fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount';
  }
  
  try {
    const response = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      { textQuery: fullQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask
        }
      }
    );

    const places = response.data.places || [];
    const slicedPlaces = places.slice(0, maxResults);
    const discovered = [];

    for (const p of slicedPlaces) {
      const { town, region: parsedRegion } = parseAddress(p.formattedAddress || '');
      const prospect = {
        placeId: p.id,
        businessName: p.displayName?.text || 'Unknown Business',
        formattedAddress: p.formattedAddress || 'No Address Provided',
        town,
        region: parsedRegion,
        category: (p.types && p.types[0]) || 'business',
        phoneNumber: p.nationalPhoneNumber || undefined,
        website: p.websiteUri || undefined,
        rating: p.rating || undefined,
        userRatingCount: p.userRatingCount || undefined,
        latitude: p.location?.latitude || 0,
        longitude: p.location?.longitude || 0,
        googleMapsUri: p.googleMapsUri || '',
        query: textQuery,
        fieldProfile,
        source: 'google_places',
        confidence: 1.0,
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {}
      };
      discovered.push(prospect);
    }

    if (discovered.length > 0) {
      addProspects(discovered);
    }

    return discovered;
  } catch (err) {
    let msg = err.message || 'Unknown error';
    if (apiKey) {
      msg = msg.replace(new RegExp(apiKey, 'g'), '[REDACTED]');
    }
    throw new Error(`Google Places API failure: ${msg}`);
  }
}

module.exports = {
  searchLocalProspects,
  getDailyQueryCount,
  parseAddress,
  QUOTA_FILE
};
