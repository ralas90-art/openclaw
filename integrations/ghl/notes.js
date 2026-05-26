async function addSyncNote(client, contactId, leadData) {
  const noteBody = `
Cresca OS Sync Metadata:
- Lead Score: ${leadData.score || 'N/A'}
- Grade: ${leadData.grade || 'N/A'}
- Urgency: ${leadData.urgency || 'N/A'}
- Sync Date: ${new Date().toLocaleString()}
  `.trim();

  try {
    return await client.post(`/contacts/${contactId}/notes`, {
      body: noteBody
    });
  } catch (error) {
    console.error('Error in addSyncNote:', error.message);
    throw error;
  }
}

module.exports = { addSyncNote };
