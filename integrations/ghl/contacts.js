async function upsertContact(client, leadData) {
  const payload = {
    firstName: leadData.first_name,
    lastName: leadData.last_name,
    email: leadData.email,
    phone: leadData.phone,
    source: 'Cresca OS',
    customFields: leadData.custom_fields || []
  };

  try {
    // Attempt to find existing contact by email/phone first
    const searchParams = leadData.email ? { email: leadData.email } : { phone: leadData.phone };
    const existing = await client.get('/contacts/', searchParams);

    if (existing && existing.contacts && existing.contacts.length > 0) {
      const contactId = existing.contacts[0].id;
      return await client.put(`/contacts/${contactId}`, payload);
    } else {
      return await client.post('/contacts/', payload);
    }
  } catch (error) {
    console.error('Error in upsertContact:', error.message);
    throw error;
  }
}

module.exports = { upsertContact };
