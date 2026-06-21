const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { addProspects } = require('./prospect-store');

const QUOTA_FILE = path.resolve(__dirname, 'data', 'daily_query_count.json');

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

  const region = options.region || process.env.GOOGLE_PLACES_DEFAULT_REGION || 'Long Island, NY';
  const fullQuery = `${textQuery} in ${region}`;

  if (!enabled) {
    // Return mock results
    console.log(`[ProspectIntake] Mock mode active. Generating mock results for: "${fullQuery}"`);
    const mockProspects = [
      {
        placeId: `mock_p_${textQuery.toLowerCase().replace(/\s+/g, '_')}_1`,
        name: `Prime ${textQuery} Pros`,
        formattedAddress: `100 Main St, ${region}`,
        phoneNumber: '+1-516-555-0199',
        website: 'https://primeprospecttestexample.com',
        rating: 4.8,
        userRatingCount: 42,
        latitude: 40.75,
        longitude: -73.0,
        types: ['local_business', 'contractor'],
        query: textQuery,
        discoveredAt: new Date().toISOString()
      },
      {
        placeId: `mock_p_${textQuery.toLowerCase().replace(/\s+/g, '_')}_2`,
        name: `Apex ${textQuery} Service`,
        formattedAddress: `202 Broad St, ${region}`,
        phoneNumber: '+1-516-555-0288',
        website: 'https://apexprospecttestexample.com',
        rating: 4.5,
        userRatingCount: 19,
        latitude: 40.76,
        longitude: -72.98,
        types: ['local_business'],
        query: textQuery,
        discoveredAt: new Date().toISOString()
      }
    ];

    addProspects(mockProspects);
    return mockProspects;
  }

  // Live call to Google Places Text Search (New)
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured on the server');
  }

  console.log(`[ProspectIntake] Calling live Google Places API for query: "${fullQuery}"`);
  
  try {
    const response = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      { textQuery: fullQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.location,places.rating,places.userRatingCount,places.types'
        }
      }
    );

    const places = response.data.places || [];
    const discovered = [];

    for (const p of places) {
      const prospect = {
        placeId: p.id,
        name: p.displayName?.text || 'Unknown Business',
        formattedAddress: p.formattedAddress || 'No Address Provided',
        phoneNumber: p.nationalPhoneNumber || undefined,
        website: p.websiteUri || undefined,
        rating: p.rating || undefined,
        userRatingCount: p.userRatingCount || undefined,
        latitude: p.location?.latitude || 0,
        longitude: p.location?.longitude || 0,
        types: p.types || [],
        query: textQuery,
        discoveredAt: new Date().toISOString()
      };
      discovered.push(prospect);
    }

    if (discovered.length > 0) {
      addProspects(discovered);
    }

    return discovered;
  } catch (err) {
    console.error(`[ProspectIntake] Live Places API error: ${err.message}`);
    throw new Error(`Google Places API failure: ${err.message}`);
  }
}

module.exports = {
  searchLocalProspects,
  getDailyQueryCount,
  QUOTA_FILE
};
