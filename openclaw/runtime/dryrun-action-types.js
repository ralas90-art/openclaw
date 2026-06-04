/**
 * OpenClaw Supported Dry-Run Action Types Allowlist
 */

const DRYRUN_ACTION_TYPES = {
  ghl_contact_create_preview: {
    description: 'Preview GHL contact creation payload.',
    requiredFields: ['name', 'email'],
    example: 'Create contact name: John Doe, email: john@example.com',
    generateMockPayload: (input, fields) => ({
      firstName: fields.firstName || fields.name?.split(' ')[0] || 'John',
      lastName: fields.lastName || fields.name?.split(' ').slice(1).join(' ') || 'Doe',
      email: fields.email || 'john@example.com',
      phone: fields.phone || '+1234567890',
      customFields: fields.customFields || {},
      status: 'pending_sync'
    })
  },
  ghl_opportunity_create_preview: {
    description: 'Preview GHL opportunity update/creation.',
    requiredFields: ['opportunityName', 'pipelineId', 'stageId'],
    example: 'Create opportunity name: Solar Lead, pipelineId: pipe_123, stageId: stage_456',
    generateMockPayload: (input, fields) => ({
      name: fields.opportunityName || 'Solar Lead',
      pipelineId: fields.pipelineId || 'pipe_default',
      stageId: fields.stageId || 'stage_default',
      status: fields.status || 'open',
      monetaryValue: parseFloat(fields.value) || 1200,
      contactId: fields.contactId || 'ct_mock_88723'
    })
  },
  ghl_pipeline_update_preview: {
    description: 'Preview GHL pipeline stage updates.',
    requiredFields: ['opportunityId', 'pipelineId', 'stageId'],
    example: 'Update pipeline stage opportunityId: opt_789, pipelineId: pipe_123, stageId: stage_456',
    generateMockPayload: (input, fields) => ({
      opportunityId: fields.opportunityId || 'opt_mock_112',
      pipelineId: fields.pipelineId || 'pipe_default',
      stageId: fields.stageId || 'stage_default',
      updatedAt: new Date().toISOString()
    })
  },
  airtable_lead_record_preview: {
    description: 'Preview Airtable lead record payload.',
    requiredFields: ['tableName', 'email'],
    example: 'Create Airtable lead record tableName: Leads, email: lead@example.com',
    generateMockPayload: (input, fields) => ({
      table: fields.tableName || 'Leads',
      fields: {
        Email: fields.email || 'lead@example.com',
        Name: fields.name || 'Anonymous Lead',
        Phone: fields.phone || '',
        Source: fields.source || 'OpenClaw Bot',
        Status: fields.status || 'New Lead'
      }
    })
  },
  google_places_research_preview: {
    description: 'Preview Google Places research request parameters.',
    requiredFields: ['query', 'location'],
    example: 'Research query: cleaning company, location: Suffolk County',
    generateMockPayload: (input, fields) => ({
      query: fields.query || 'cleaning services',
      location: fields.location || 'Suffolk County, NY',
      radius: parseInt(fields.radius, 10) || 5000,
      type: fields.type || 'establishment',
      maxResults: parseInt(fields.maxResults, 10) || 20
    })
  },
  outbound_email_sequence_preview: {
    description: 'Preview outbound email outreach sequence details.',
    requiredFields: ['toEmail', 'subject'],
    example: 'Send email toEmail: customer@example.com, subject: Meeting follow-up',
    generateMockPayload: (input, fields) => ({
      recipient: fields.toEmail || 'customer@example.com',
      subject: fields.subject || 'Meeting follow-up',
      template: fields.templateName || 'outreach_intro_v1',
      variables: fields.variables || {},
      steps: [
        { step: 1, delayDays: 0, subject: fields.subject || 'Follow-up', body: 'Hi, just following up...' },
        { step: 2, delayDays: 3, subject: 'Re: Follow-up', body: 'Hi, wanted to make sure you saw my last email...' }
      ]
    })
  },
  outbound_sms_sequence_preview: {
    description: 'Preview outbound SMS outreach sequence.',
    requiredFields: ['toPhone', 'messageText'],
    example: 'Send SMS toPhone: +12135550199, messageText: Hello from OpenClaw',
    generateMockPayload: (input, fields) => ({
      recipient: fields.toPhone || '+12135550199',
      message: fields.messageText || 'Hello from OpenClaw',
      complianceRegistered: true,
      optOutMessage: 'Reply STOP to unsubscribe'
    })
  },
  webhook_payload_preview: {
    description: 'Preview webhook automation payload content.',
    requiredFields: ['webhookUrl', 'event'],
    example: 'Send webhook webhookUrl: https://hooks.zapier.com/123, event: contact_created',
    generateMockPayload: (input, fields) => ({
      targetUrl: fields.webhookUrl || 'https://hooks.zapier.com/default',
      event: fields.event || 'default_event',
      payload: {
        timestamp: new Date().toISOString(),
        event: fields.event || 'default_event',
        data: fields.payload || {}
      }
    })
  }
};

module.exports = {
  DRYRUN_ACTION_TYPES
};
