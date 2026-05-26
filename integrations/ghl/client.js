const axios = require('axios');

class GHLClient {
  constructor({ location_id, api_key, access_token }) {
    this.location_id = location_id;
    this.api_key = api_key;
    this.access_token = access_token;
    this.baseUrl = 'https://services.leadconnectorhq.com';
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Version': '2021-07-28' // Standard GHL API version
    };

    if (this.access_token) {
      headers['Authorization'] = `Bearer ${this.access_token}`;
    } else if (this.api_key) {
      headers['Authorization'] = `Bearer ${this.api_key}`;
    }

    return headers;
  }

  async request(method, path, data = {}, params = {}) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${path}`,
        headers: this.getHeaders(),
        data,
        params: {
          ...params,
          locationId: this.location_id
        }
      });
      return response.data;
    } catch (error) {
      const errorData = error.response?.data || error.message;
      console.error(`GHL API Error [${method} ${path}]:`, JSON.stringify(errorData));
      throw new Error(`GHL API Error: ${JSON.stringify(errorData)}`);
    }
  }

  async post(path, data, params) {
    return this.request('POST', path, data, params);
  }

  async put(path, data, params) {
    return this.request('PUT', path, data, params);
  }

  async get(path, params) {
    return this.request('GET', path, {}, params);
  }
}

module.exports = { GHLClient };
