const { GHLClient } = require('./client');
const { upsertContact } = require('./contacts');
const { upsertOpportunity } = require('./opportunities');
const { createNote } = require('./notes');
const { applyTags } = require('./tags');

class GHLProvider {
  constructor(connectionInfo) {
    this.client = new GHLClient(connectionInfo);
    this.connectionInfo = connectionInfo;
  }

  async contactsUpsert(data) {
    return upsertContact(this.client, data);
  }

  async opportunitiesUpsert(data) {
    return upsertOpportunity(this.client, this.connectionInfo, data);
  }

  async notesCreate(data) {
    return createNote(this.client, data.contact_id, data.lead_data);
  }

  async tagsApply(data) {
    return applyTags(this.client, data.contact_id, data.lead_data);
  }
}

module.exports = GHLProvider;
