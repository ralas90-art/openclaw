async function applyTags(client, contactId, leadData) {
  const tags = [
    'cresca:synced',
    `cresca:source_${leadData.source || 'unknown'}`,
    `cresca:lifecycle_${leadData.lifecycle || 'new'}`
  ];

  if (leadData.score >= 80) {
    tags.push('cresca:priority_high');
  }

  try {
    return await client.post(`/contacts/${contactId}/tags`, {
      tags: tags
    });
  } catch (error) {
    throw error;
  }
}

module.exports = { applyTags };
