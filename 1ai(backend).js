const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const auth = require('./auth');  // Auth middleware
const db = require('./db');      // Database module

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =====================================================================
// ENHANCED LOGGING SYSTEM
// =====================================================================
// Create a global logger object to store logs
const appLogger = {
  logs: [],
  maxLogs: 1000, // Maximum number of logs to keep
  
  // Add a log entry with step tracking
  log: function(type, message, data = null, step = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
      step
    };
    
    this.logs.unshift(logEntry); // Add to beginning of array
    
    // Trim logs if exceeding maximum
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    // Format for console logs
    let logPrefix = '';
    if (step) {
      logPrefix = `[${type}] [Step ${step}]`;
    } else {
      logPrefix = `[${type}]`;
    }
    
    // Log with step information if provided
    console.log(`${logPrefix} ${message}`);
    
    // Only log data to console if it exists and is small enough
    if (data && typeof data === 'object') {
      const dataStr = JSON.stringify(data);
      if (dataStr.length < 500) {
        console.log(`${logPrefix} Data:`, dataStr);
      } else {
        console.log(`${logPrefix} Data: [large object, ${dataStr.length} chars]`);
      }
    }
    
    return logEntry;
  }
};

// =====================================================================
// DEBUG MIDDLEWARE - Logs all requests for debugging
// =====================================================================
router.use((req, res, next) => {
  console.log(`🔎 [REQUEST] ${req.method} ${req.path} received`);
  console.log(`🔎 [REQUEST] Headers: Authorization: ${req.headers.authorization ? 'Bearer [token]' : 'none'}`);
  console.log(`🔎 [REQUEST] Body:`, req.body);
  next();
});

// =====================================================================
// PROMPT 1A: CLASSIFY BUSINESS INPUT
// =====================================================================
/**
 * Classifies user prompt in business mode into one of four routes.
 * @param {string} userMessage - The raw user input
 * @returns {Promise<string>} - One of: "memo", "invoice", "customer", "conversation"
 */
async function classifyBusinessInput(userMessage) {
  console.log("🔍 [BUSINESS_CLASSIFIER] Starting classification for:", userMessage?.slice(0, 50));
  appLogger.log('PIPELINE', 'Starting business input classification', { userMessage }, '1.1');
  
  const prompt = `
You are a classifier for a business assistant AI. Classify this message:

"${userMessage}"

Your options:
- memo
- invoice
- customer
- conversation

Respond ONLY in JSON:
{ "action": "memo" }
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🤖 [OPENAI] Sending business classification prompt");
    appLogger.log('OPENAI_REQUEST', 'Sending business classification prompt to OpenAI', { prompt }, '1.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: prompt }],
      temperature: 0.0
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Business classification API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '1.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Business classification response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }
    
    appLogger.log('OPENAI_RESPONSE', 'Received business classification response', { 
      raw: content 
    }, '1.3');
    
    // Try parsing as JSON with detailed error handling
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Specific error for JSON parsing failures
      console.error("❌ [OPENAI_PARSE] JSON parsing error:", parseError.message);
      console.log("❌ [OPENAI_PARSE] RAW output that couldn't be parsed:", content);
      
      appLogger.log('ERROR', 'Failed to parse OpenAI response as JSON', { 
        error: parseError.message, 
        rawContent: content,
        userMessage 
      }, '1.3.error');
      
      throw new Error(`Failed to parse response: ${parseError.message}`);
    }

    if (!parsed || !parsed.action) {
      console.error("❌ [OPENAI] Invalid response format: missing 'action' property");
      throw new Error("Invalid response format: missing 'action' property");
    }
    
    console.log("✅ [BUSINESS_CLASSIFIER] Input classified as:", parsed.action);
    appLogger.log('CLASSIFICATION', 'Business input classified', { 
      userMessage, 
      classification: parsed.action 
    }, '1.4');

    return parsed.action; // e.g., "memo"
  } catch (err) {
    console.error("❌ [BUSINESS_CLASSIFIER] Error in classifyBusinessInput:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Business classification error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userMessage 
    }, '1.error');
    
    return "conversation"; // default safe fallback
  }
}

// =====================================================================
// MODE-BASED CLASSIFIER ROUTER
// =====================================================================
/**
 * Routes classification based on the mode (business or memory)
 * @param {string} userMessage - The user's input message
 * @param {boolean} memoryMode - Whether memory mode is active
 * @returns {Promise<string>} - The classified action
 */
async function classifyInputByMode(userMessage, memoryMode = false) {
  console.log(`🔀 [CLASSIFIER_ROUTER] Routing to ${memoryMode ? 'memory' : 'business'} classifier`);
  appLogger.log('PIPELINE', 'Routing classification by mode', { 
    userMessage: userMessage?.slice(0, 50), 
    memoryMode 
  }, '1.0.router');
  
  try {
    if (memoryMode) {
      return "memory_conversation"; // Memory mode is handled by the new memory system
    } else {
      const action = await classifyBusinessInput(userMessage);
      
      console.log(`✅ [CLASSIFIER_ROUTER] Routed business classification: ${action}`);
      appLogger.log('CLASSIFICATION', 'Classification routed by mode', { 
        memoryMode, 
        action 
      }, '1.5.router');
      
      return action;
    }
  } catch (err) {
    console.error(`❌ [CLASSIFIER_ROUTER] Error routing classification:`, err.message);
    
    appLogger.log('ERROR', 'Classification router error', { 
      error: err.message,
      stack: err.stack,
      memoryMode,
      userMessage
    }, '1.error.router');
    
    // Default fallbacks based on mode
    return memoryMode ? "memory_conversation" : "conversation";
  }
}

// =====================================================================
// PROMPT 2: MEMO FILTER GENERATION WITH ACTION DETECTION
// =====================================================================
/**
 * Generates search filters from user message for the memos table.
 * Also detects if the user wants to update or create a memo.
 * @param {string} userMessage - User's natural language query
 * @returns {Promise<Object>} - Filters object with optional action
 */
async function generateMemoFilters(userMessage) {
  console.log("🤖 [OPENAI] Generating memo filters for:", userMessage?.slice(0, 50));
  appLogger.log('PIPELINE', 'Generating memo filters', { userMessage }, '2.1');
  
  const systemPrompt = `
You are a MySQL assistant for filtering a "memos" table.
Extract search filters from this user message:
"${userMessage}"
`;

  const instruction = `
Table structure:
- memoNumber (int)
- customerName (text)
- status (open, invoiced, returned)
- date (YYYY-MM-DD)
- items: array [{ sku, description, caratWeight, price, quantity }]

IMPORTANT: If the user's request involves UPDATING, EDITING, or CREATING a memo, 
include an "action" field in your response:

For updating existing memos:
{
  "filters": { 
    "memoNumber": 123,
    "customerName": "...",
    "status": "...",
    "fromDate": "2023-01-01",
    "toDate": "2023-12-31",
    "items.description": "..."
  },
  "action": "update_memo",
  "memoNumber": 10073,
  "customerName": "Bhavya"
}

For creating new memos:
{
  "filters": { 
    "customerName": "..." 
  },
  "action": "create_memo",
  "customerName": "Bhavya"
}

For just searching/viewing memos (no "action" needed):
{
  "filters": {
    "memoNumber": 123,
    "customerName": "...",
    "status": "...",
    "fromDate": "2023-01-01",
    "toDate": "2023-12-31",
    "items.description": "..."
  }
}

Examples:
- "Edit memo #10073 for Bhavya" → include action: "update_memo", memoNumber: 10073
- "Update Bhavya's memo from last week" → include action: "update_memo", customerName: "Bhavya"
- "Create a new memo for John" → include action: "create_memo", customerName: "John"
- "Show me all memos for Sarah" → NO action field (this is just a search)

Even if the user message is vague, provide the best possible general filters. If you can't extract any specific filters, return empty values:
{ "filters": {} }
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending memo filter prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending memo filter prompt to OpenAI', { 
      systemPrompt, 
      instruction 
    }, '2.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: instruction }
      ],
      temperature: 0
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Memo filter API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '2.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Filter response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }
    
    appLogger.log('OPENAI_RESPONSE', 'Received memo filter response', { 
      raw: content 
    }, '2.3');
    
    // Try parsing as JSON with detailed error handling
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Specific error for JSON parsing failures
      console.error("❌ [OPENAI_PARSE] JSON parsing error:", parseError.message);
      console.log("❌ [OPENAI_PARSE] RAW output that couldn't be parsed:", content);
      
      appLogger.log('ERROR', 'Failed to parse OpenAI response as JSON', { 
        error: parseError.message, 
        rawContent: content,
        userMessage 
      }, '2.3.error');
      
      throw new Error(`Failed to parse response: ${parseError.message}`);
    }
    
    // Validate the structure
    if (!parsed.filters) {
      console.error("❌ [OPENAI_PARSE] Missing 'filters' property in parsed response", parsed);
      appLogger.log('ERROR', 'Invalid structure in OpenAI response', { 
        error: "Missing 'filters' property", 
        parsed,
        userMessage 
      }, '2.3.error');
      
      throw new Error("Invalid response structure: missing 'filters' property");
    }

    // Check for action and log it if present
    if (parsed.action) {
      console.log("🔎 [ACTION] Detected memo action:", parsed.action);
      appLogger.log('ACTION_DETECTION', 'Detected memo action', { 
        action: parsed.action,
        memoNumber: parsed.memoNumber,
        customerName: parsed.customerName
      }, '2.4.1');
    }

    console.log("🔎 [FILTERS] Generated memo filters:", JSON.stringify(parsed.filters));
    appLogger.log('FILTER_GENERATION', 'Generated memo filters', { 
      userMessage,
      filters: parsed.filters
    }, '2.4');

    return parsed;
  } catch (err) {
    console.error("❌ [OPENAI_ERROR] Memo filter error:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Memo filter generation error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userMessage 
    }, '2.error');
    
    // Still return a valid object structure as a fail-safe
    return { filters: {} };
  }
}

// =====================================================================
// PROMPT 3: INVOICE FILTER GENERATION
// =====================================================================
/**
 * Generates search filters from user message for the invoices table.
 * @param {string} userMessage - User's natural language query
 * @returns {Promise<Object>} - Filters object
 */
async function generateInvoiceFilters(userMessage) {
  console.log("🤖 [OPENAI] Generating invoice filters for:", userMessage?.slice(0, 50));
  appLogger.log('PIPELINE', 'Generating invoice filters', { userMessage }, '3.1');
  
  const systemPrompt = `
You are a MySQL filter assistant for the "invoices" table.
Extract filters from this message:
"${userMessage}"

The table fields are:
- invoiceNumber, memoNumber, customerName, items.description, totalAmount, status, date
`;

  const instruction = `
Return this JSON with any filters you can extract:
{
  "filters": {
    "status": "...",
    "memoNumber": 123,
    "invoiceNumber": 456,
    "customerName": "...",
    "fromDate": "2023-01-01",
    "toDate": "2023-12-31",
    "items.description": "..."
  }
}

Even if the user message is vague, provide the best possible general filters. If you can't extract any specific filters, return empty values:
{ "filters": {} }
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending invoice filter prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending invoice filter prompt to OpenAI', { 
      systemPrompt, 
      instruction 
    }, '3.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: instruction }
      ],
      temperature: 0
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Invoice filter API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '3.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Filter response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }
    
    appLogger.log('OPENAI_RESPONSE', 'Received invoice filter response', { 
      raw: content 
    }, '3.3');
    
    // Try parsing as JSON with detailed error handling
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Specific error for JSON parsing failures
      console.error("❌ [OPENAI_PARSE] JSON parsing error:", parseError.message);
      console.log("❌ [OPENAI_PARSE] RAW output that couldn't be parsed:", content);
      
      appLogger.log('ERROR', 'Failed to parse OpenAI response as JSON', { 
        error: parseError.message, 
        rawContent: content,
        userMessage 
      }, '3.3.error');
      
      throw new Error(`Failed to parse response: ${parseError.message}`);
    }
    
    // Validate the structure
    if (!parsed.filters) {
      console.error("❌ [OPENAI_PARSE] Missing 'filters' property in parsed response", parsed);
      appLogger.log('ERROR', 'Invalid structure in OpenAI response', { 
        error: "Missing 'filters' property", 
        parsed,
        userMessage 
      }, '3.3.error');
      
      throw new Error("Invalid response structure: missing 'filters' property");
    }

    console.log("🔎 [FILTERS] Generated invoice filters:", JSON.stringify(parsed.filters));
    appLogger.log('FILTER_GENERATION', 'Generated invoice filters', { 
      userMessage,
      filters: parsed.filters
    }, '3.4');

    return parsed.filters;
  } catch (err) {
    console.error("❌ [OPENAI_ERROR] Invoice filter error:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Invoice filter generation error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userMessage 
    }, '3.error');
    
    // Still return a valid object structure as a fail-safe
    return {};
  }
}

// =====================================================================
// PROMPT 4: CUSTOMER FILTER GENERATION
// =====================================================================
/**
 * Extracts filters for the customers table from user message.
 * @param {string} userMessage - User's natural language query
 * @returns {Promise<Object>} - Filters object
 */
async function generateCustomerFilters(userMessage) {
  console.log("🤖 [OPENAI] Generating customer filters for:", userMessage?.slice(0, 50));
  appLogger.log('PIPELINE', 'Generating customer filters', { userMessage }, '4.1');
  
  const prompt = `
You are a MySQL assistant for the "customers" table.

User message:
"${userMessage}"

Return JSON with any filters you can extract:
{
  "filters": {
    "name": "...",
    "email": "...",
    "phone": "...",
    "address": "..."
  }
}

Even if the user message is vague, provide the best possible general filters. If you can't extract any specific filters, return empty values:
{ "filters": {} }
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending customer filter prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending customer filter prompt to OpenAI', { prompt }, '4.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: prompt }
      ],
      temperature: 0
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Customer filter API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '4.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Filter response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }
    
    appLogger.log('OPENAI_RESPONSE', 'Received customer filter response', { 
      raw: content 
    }, '4.3');
    
    // Try parsing as JSON with detailed error handling
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Specific error for JSON parsing failures
      console.error("❌ [OPENAI_PARSE] JSON parsing error:", parseError.message);
      console.log("❌ [OPENAI_PARSE] RAW output that couldn't be parsed:", content);
      
      appLogger.log('ERROR', 'Failed to parse OpenAI response as JSON', { 
        error: parseError.message, 
        rawContent: content,
        userMessage 
      }, '4.3.error');
      
      throw new Error(`Failed to parse response: ${parseError.message}`);
    }
    
    // Validate the structure
    if (!parsed.filters) {
      console.error("❌ [OPENAI_PARSE] Missing 'filters' property in parsed response", parsed);
      appLogger.log('ERROR', 'Invalid structure in OpenAI response', { 
        error: "Missing 'filters' property", 
        parsed,
        userMessage 
      }, '4.3.error');
      
      throw new Error("Invalid response structure: missing 'filters' property");
    }

    console.log("🔎 [FILTERS] Generated customer filters:", JSON.stringify(parsed.filters));
    appLogger.log('FILTER_GENERATION', 'Generated customer filters', { 
      userMessage,
      filters: parsed.filters
    }, '4.4');

    return parsed.filters;
  } catch (err) {
    console.error("❌ [OPENAI_ERROR] Customer filter error:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Customer filter generation error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userMessage 
    }, '4.error');
    
    // Still return a valid object structure as a fail-safe
    return {};
  }
}

// =====================================================================
// PROMPT 5: CONVERSATION HANDLER
// =====================================================================
/**
 * Processes general conversation that isn't specifically about memos, invoices or customers
 * @param {string} userMessage - User's message
 * @returns {Promise<Object>} - Response message
 */
async function handleGeneralConversation(userMessage) {
  console.log("💬 [CONVERSATION] Processing message:", userMessage?.slice(0, 50));
  appLogger.log('PIPELINE', 'Processing general conversation', { userMessage }, '5.1');
  
  const prompt = `
You are an AI business assistant helping with a jewelry inventory and sales system.
The system can:
- Track memos (items sent to customers to view)
- Generate invoices from memos
- Manage customer information

Respond helpfully to this message in a professional but friendly tone:
"${userMessage}"

Keep your response concise, around 2-3 sentences. Focus on helping the user understand how to interact with the system.
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending conversation prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending conversation prompt to OpenAI', { prompt }, '5.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.7
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Conversation API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '5.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Conversation response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }
    
    appLogger.log('OPENAI_RESPONSE', 'Received conversation response', { 
      raw: content
    }, '5.3');
    
    return content;
  } catch (err) {
    console.error("❌ [CONVERSATION] Error:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Conversation error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userMessage 
    }, '5.error');
    
    // Safe fallback
    return "I'm here to help with your business queries about memos, invoices, and customers. How can I assist you today?";
  }
}

// =====================================================================
// PROMPT 6: RESULT SUMMARIZATION
// =====================================================================
/**
 * Generates a natural language summary of database results
 * @param {string} userPrompt - Original user query
 * @param {Array} results - Database result rows
 * @returns {Promise<string>} - Natural language summary
 */
async function summarizeResults(userPrompt, results = [], resultType) {
  console.log("📊 [SUMMARY] Summarizing", results.length, resultType);
  appLogger.log('PIPELINE', 'Summarizing results', { 
    userPrompt, 
    resultCount: results.length,
    resultType 
  }, '6.1');
  
  if (!results || results.length === 0) {
    console.log("ℹ️ [SUMMARY] No results to summarize");
    return `I couldn't find any matching ${resultType} for your query.`;
  }

  // Prepare summary data with basic stats tailored for each type
  const summaryData = {
    totalResults: results.length,
    resultType,
    query: userPrompt
  };
  
  // Add type-specific summary data
  if (resultType === 'memo') {
    summaryData.statusCounts = {};
    summaryData.customerCounts = {};
    summaryData.dateRange = { oldest: null, newest: null };
    
    // Extract key information
    for (const result of results) {
      // Status breakdown
      if (result.status) {
        const status = result.status;
        summaryData.statusCounts[status] = (summaryData.statusCounts[status] || 0) + 1;
      }
      
      // Customer breakdown
      if (result.customer_name) {
        const customer = result.customer_name;
        summaryData.customerCounts[customer] = (summaryData.customerCounts[customer] || 0) + 1;
      }
      
      // Track date range
      if (result.date) {
        const date = new Date(result.date);
        if (!summaryData.dateRange.newest || date > new Date(summaryData.dateRange.newest)) {
          summaryData.dateRange.newest = date.toISOString().split('T')[0];
        }
        if (!summaryData.dateRange.oldest || date < new Date(summaryData.dateRange.oldest)) {
          summaryData.dateRange.oldest = date.toISOString().split('T')[0];
        }
      }
    }
    
    // Analyze items if they exist
    let itemsSummary = {};
    let itemsCount = 0;
    
    for (const result of results) {
      if (result.items && Array.isArray(result.items)) {
        itemsCount += result.items.length;
        
        // Track common item descriptions
        result.items.forEach(item => {
          if (item.description) {
            const desc = item.description.toLowerCase();
            itemsSummary[desc] = (itemsSummary[desc] || 0) + 1;
          }
        });
      }
    }
    
    summaryData.itemsTotal = itemsCount;
    summaryData.commonItems = Object.entries(itemsSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([desc, count]) => ({ description: desc, count }));
  } 
  else if (resultType === 'invoice') {
    summaryData.statusCounts = {};
    summaryData.totalAmount = 0;
    summaryData.dateRange = { oldest: null, newest: null };
    
    // Extract key information
    for (const result of results) {
      // Status breakdown
      if (result.status) {
        const status = result.status;
        summaryData.statusCounts[status] = (summaryData.statusCounts[status] || 0) + 1;
      }
      
      // Total sum
      if (result.total_amount) {
        summaryData.totalAmount += parseFloat(result.total_amount);
      }
      
      // Track date range
      if (result.date) {
        const date = new Date(result.date);
        if (!summaryData.dateRange.newest || date > new Date(summaryData.dateRange.newest)) {
          summaryData.dateRange.newest = date.toISOString().split('T')[0];
        }
        if (!summaryData.dateRange.oldest || date < new Date(summaryData.dateRange.oldest)) {
          summaryData.dateRange.oldest = date.toISOString().split('T')[0];
        }
      }
    }
  }
  else if (resultType === 'customer') {
    // For customers, just provide a simple preview
    summaryData.examples = results.slice(0, 3).map(c => c.name);
  }

  const summaryPrompt = `
User prompt: "${userPrompt}"

Summary of query result for ${resultType}:
${JSON.stringify(summaryData, null, 2)}

User asked a question and this is the data we have in the database, from this data find the answer to the user question and reply back to the user in a professional way. Do not give any other responce your answer will be directly given to the user.
`;

  let content = null;
  let apiResponse = null;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending summarization prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending summarization prompt to OpenAI', { 
      summaryPrompt, 
      summaryData 
    }, '6.2');
    
    // Track API start time for debugging
    const apiStartTime = Date.now();
    
    apiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are a business assistant that turns database results into summaries." },
        { role: "user", content: summaryPrompt }
      ],
      temperature: 0.6
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Summary API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, '6.2.1');

    if (!apiResponse || !apiResponse.choices || !apiResponse.choices[0] || !apiResponse.choices[0].message) {
      console.error("❌ [OPENAI] Invalid response structure from OpenAI");
      throw new Error("Invalid response structure from OpenAI");
    }

    content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Summary response:", content);
    
    if (!content) {
      console.error("❌ [OPENAI] Empty content received from OpenAI");
      throw new Error("Empty content received from OpenAI");
    }

    console.log("📊 [SUMMARY] Generated:", content);
    appLogger.log('OPENAI_RESPONSE', 'Received summarization response', { summary: content }, '6.3');
    return content;
    
  } catch (err) {
    console.error("❌ [SUMMARY] Error:", err.message);
    
    // Log RAW response if we have it
    if (content) {
      console.log("❌ [OPENAI_RAW] Output was:", content);
    } else {
      console.log("❌ [OPENAI_RAW] No output available (error occurred before response)");
    }
    
    appLogger.log('ERROR', 'Summarization error', { 
      error: err.message,
      stack: err.stack,
      phase: content ? 'parsing' : 'api_call',
      rawContent: content,
      apiResponse: !content && apiResponse ? JSON.stringify(apiResponse).substring(0, 500) : null,
      userPrompt
    }, '6.error');
    
    return `I found ${results.length} ${resultType} matching your query.`;
  }
}

// =====================================================================
// MAIN HANDLER FUNCTION
// =====================================================================
/**
 * Main handler for processing user prompts through the AI pipeline
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function mainPipelineHandler(req, res) {
  const requestId = Date.now().toString();
  console.log(`🚀 [REQUEST] Starting request ${requestId}`);
  
  try {
    const { prompt, memoryMode, userId: bodyUserId } = req.body;
    const userId = req.user ? req.user.id : bodyUserId; // MODIFIED: Added fallback
    
    // MODIFIED: Check for user ID
    if (!userId) {
      console.error("❌ [PIPELINE] No user ID available");
      return res.status(400).json({
        error: 'User ID is required',
        message: 'User ID is required for processing your request'
      });
    }
    
    // Verify prompt is provided
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    console.log(`✉️ [REQUEST] ${memoryMode ? 'MEMORY' : 'BUSINESS'} mode prompt: ${prompt.slice(0, 100)}`);
    
    // Handle memory mode with our enhanced approach
    if (memoryMode) {
      return await handleMemoryPrompt(req, res);
    }
    
    // BUSINESS MODE - Standard pipeline processing
    
    // Step 1: Classify input to determine which data type we're querying
    const classification = await classifyInputByMode(prompt, memoryMode);
    console.log(`🔍 [PIPELINE] Classified as: ${classification}`);
    
    // Step 2: Process based on classification
    let results = [];
    let message = '';
    let action = null;
    let memoNumber = null;
    let customerName = null;
    
    switch (classification) {
      case 'memo':
        // Generate filters from the user's natural language query
        const memoFilters = await generateMemoFilters(prompt);
        console.log('📋 [MEMOS] Filters generated:', memoFilters);
        
        // Extract action if present in memo filters
        if (memoFilters.action) {
          action = memoFilters.action;
          memoNumber = memoFilters.memoNumber;
          customerName = memoFilters.customerName;
          
          console.log(`🎯 [ACTION] Detected memo action: ${action}`);
        }
        
        // Add user ID to ensure data isolation
        memoFilters.filters.userId = userId;
        
        // Query the database with the generated filters
        results = await db.findMemos(memoFilters.filters);
        console.log(`📊 [MEMOS] Found ${results.length} results`);
        
        // Generate natural language summary
        message = await summarizeResults(prompt, results, 'memo');
        
        // Return results with action info if present
        return res.json({
          message,
          resultType: 'memo',
          results,
          ...(action && { 
            action,
            ...(memoNumber && { memoNumber }),
            ...(customerName && { customerName })
          })
        });
        
      case 'invoice':
        // Generate filters from the user's natural language query
        const invoiceFilters = await generateInvoiceFilters(prompt);
        console.log('📋 [INVOICES] Filters generated:', invoiceFilters);
        
        // Add user ID to ensure data isolation
        invoiceFilters.userId = userId;
        
        // Query the database with the generated filters
        results = await db.findInvoices(invoiceFilters);
        console.log(`📊 [INVOICES] Found ${results.length} results`);
        
        // Generate natural language summary
        message = await summarizeResults(prompt, results, 'invoice');
        
        return res.json({
          message,
          resultType: 'invoice',
          results
        });
        
      case 'customer':
        // Generate filters from the user's natural language query
        const customerFilters = await generateCustomerFilters(prompt);
        console.log('📋 [CUSTOMERS] Filters generated:', customerFilters);
        
        // Add user ID to ensure data isolation
        customerFilters.userId = userId;
        
        // Query the database with the generated filters
        results = await db.findCustomers(customerFilters);
        console.log(`📊 [CUSTOMERS] Found ${results.length} results`);
        
        // Generate natural language summary
        message = await summarizeResults(prompt, results, 'customer');
        
        return res.json({
          message,
          resultType: 'customer',
          results
        });
        
      case 'conversation':
      default:
        // Handle general conversation
        message = await handleGeneralConversation(prompt);
        
        return res.json({
          message,
          resultType: 'conversation'
        });
    }
  } catch (error) {
    console.error(`❌ [ERROR] Request ${requestId} failed:`, error);
    
    // Log error to database
    try {
      await db.logError({
        message: error.message,
        location: 'mainPipelineHandler',
        stack: error.stack,
        userAgent: req.headers['user-agent']
      });
    } catch (logError) {
      console.error('❌ [ERROR_LOG] Failed to log error to database:', logError.message);
    }
    
    return res.status(500).json({
      error: 'An error occurred while processing your request',
      message: 'I encountered an issue while processing your request. Please try again or rephrase your question.'
    });
  }
}

// =====================================================================
// ROUTE DEFINITION
// =====================================================================

// Main endpoint for processing AI requests
router.post('/process', auth, mainPipelineHandler);

// Simple test endpoint
router.post('/test', auth, (req, res) => {
  console.log("🧪 TEST endpoint reached!");
  console.log("Request body:", req.body);
  res.json({ 
    success: true, 
    message: "Test endpoint working!",
    receivedData: req.body 
  });
});

module.exports = router;
