async function applySyncTags(client, contactId, leadData) {
  const tags = [
    'cresca-synced',
    `source-${leadData.source || 'unknown'}`,
    `lifecycle-${leadData.lifecycle || 'new'}`
  ];

  if (leadData.score >= 80) {
    tags.push('high-intent');
  }

  try {
    return await client.post(`/contacts/${contactId}/tags`, {
      tags: tags
    });
  } catch (error) {
    console.error('Error in applySyncTags:', error.message);
    throw error;
  }
}

module.exports = { applySyncTags };
