/**
 * OpenClaw Runtime Model Adapter
 */

const axios = require('axios');
const config = require('./runtime-config');

/**
 * Calls the selected LLM provider.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} options
 * @returns {Promise<{ summary: string, content: string, rawResponse: string }>}
 */
async function generateResponse(systemPrompt, userPrompt, options = {}) {
  const provider = (options.provider || config.provider).toLowerCase();
  const modelName = options.model || config.model;
  const timeout = options.timeoutMs || config.timeoutMs;
  const maxTokens = options.maxOutputTokens || config.maxOutputTokens;

  if (provider === 'mock') {
    // Return deterministic mock response immediately
    const mockOutput = [
      "SUMMARY:",
      "This is a mock result plan for " + userPrompt.substring(0, 50) + "...",
      "",
      "CONTENT:",
      "### Mock Plan Details",
      "- **Step 1:** Initialize the Cresca OS GHL custom fields.",
      "- **Step 2:** Setup pipeline stages and lead tracking triggers.",
      "- **Step 3:** Perform validation tests.",
      "",
      "This mock response verifies the runtime executor pipeline works without requiring real API keys."
    ].join('\n');

    return parseStructuredResponse(mockOutput);
  }

  // Real LLM calls
  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('Missing OpenAI API credentials. Please set OPENAI_API_KEY environment variable.');
    }
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${config.openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
      
      const text = response.data.choices[0].message.content;
      const parsed = parseStructuredResponse(text);
      if (response.data.usage) {
        parsed.usage = {
          inputTokens: response.data.usage.prompt_tokens || 0,
          outputTokens: response.data.usage.completion_tokens || 0,
          totalTokens: response.data.usage.total_tokens || 0
        };
      }
      return parsed;
    } catch (err) {
      throw new Error(`OpenAI API call failed: ${getCleanErrorMessage(err)}`);
    }
  }

  if (provider === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error('Missing Anthropic API credentials. Please set ANTHROPIC_API_KEY environment variable.');
    }
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: modelName,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        {
          headers: {
            'x-api-key': config.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
      
      const text = response.data.content[0].text;
      const parsed = parseStructuredResponse(text);
      if (response.data.usage) {
        parsed.usage = {
          inputTokens: response.data.usage.input_tokens || 0,
          outputTokens: response.data.usage.output_tokens || 0,
          totalTokens: (response.data.usage.input_tokens + response.data.usage.output_tokens) || 0
        };
      }
      return parsed;
    } catch (err) {
      throw new Error(`Anthropic API call failed: ${getCleanErrorMessage(err)}`);
    }
  }

  if (provider === 'openrouter') {
    if (!config.openrouterApiKey) {
      throw new Error('Missing OpenRouter API credentials. Please set OPENROUTER_API_KEY environment variable.');
    }
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${config.openrouterApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout
        }
      );
      
      const text = response.data.choices[0].message.content;
      const parsed = parseStructuredResponse(text);
      if (response.data.usage) {
        parsed.usage = {
          inputTokens: response.data.usage.prompt_tokens || 0,
          outputTokens: response.data.usage.completion_tokens || 0,
          totalTokens: response.data.usage.total_tokens || 0
        };
      }
      return parsed;
    } catch (err) {
      throw new Error(`OpenRouter API call failed: ${getCleanErrorMessage(err)}`);
    }
  }

  throw new Error(`Unsupported model provider: '${provider}'`);
}

/**
 * Parses the structured output into summary and content fields.
 * @param {string} text
 * @returns {{ summary: string, content: string, rawResponse: string }}
 */
function parseStructuredResponse(text) {
  const normalized = text.trim();
  const contentMarkerIndex = normalized.search(/CONTENT:/i);

  if (contentMarkerIndex === -1) {
    // Fallback: parse first paragraph as summary, the rest as content
    const paragraphs = normalized.split(/\n\s*\n/);
    const summary = paragraphs[0].replace(/SUMMARY:/i, '').trim();
    const content = paragraphs.slice(1).join('\n\n').trim() || normalized;
    return { summary, content, rawResponse: normalized };
  }

  const summaryPart = normalized.substring(0, contentMarkerIndex)
    .replace(/SUMMARY:/i, '')
    .trim();
  
  const contentPart = normalized.substring(contentMarkerIndex + 8) // length of "CONTENT:" is 8
    .trim();

  return {
    summary: summaryPart || 'Result generated successfully.',
    content: contentPart || normalized,
    rawResponse: normalized
  };
}

/**
 * Extracts a safe error message without API credentials or stack traces.
 * @param {Error} err
 * @returns {string}
 */
function getCleanErrorMessage(err) {
  if (err.response && err.response.data) {
    if (err.response.data.error && err.response.data.error.message) {
      return err.response.data.error.message;
    }
    return JSON.stringify(err.response.data);
  }
  return err.message;
}

module.exports = {
  generateResponse,
  parseStructuredResponse
};
