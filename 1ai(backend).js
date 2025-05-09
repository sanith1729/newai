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
// ENHANCED MEMORY INTENT ANALYZER - HANDLES SEARCH, UPDATE, DELETE
// =====================================================================
/**
 * Analyzes user prompt to detect memory-related intent (search, update, or delete)
 * @param {string} userPrompt - The user's message
 * @returns {Promise<Object>} - Object with intent and related parameters
 */
async function analyzeMemoryIntent(userPrompt) {
  console.log("🧠 [MEMORY_ANALYZER] Analyzing memory intent:", userPrompt?.slice(0, 50));
  appLogger.log('MEMORY', 'Analyzing memory intent', { userPrompt }, 'memory.analyze.1');
  
  const prompt = `
You are a detector for memory-related queries.

Analyze this query to determine if it's:
1. Searching for stored memory 
2. Trying to update/correct a stored memory
3. Trying to delete a stored memory
4. Just a regular conversation or sharing new information

If it's a search query, respond with:
{ "intent": "search", "search_term": "..." }

If it's an update query, respond with:
{ "intent": "update", "search_term": "...", "new_value": "..." }

If it's a delete query, respond with:
{ "intent": "delete", "search_term": "..." }

Otherwise (regular conversation/sharing):
{ "intent": "conversation" }

Examples:
- "What's my dog's name?" -> { "intent": "search", "search_term": "dog name" }
- "My dog's name is not Rex, it's Max" -> { "intent": "update", "search_term": "dog name", "new_value": "Max" }
- "Update Uday's birthday to May 6th" -> { "intent": "update", "search_term": "Uday birthday", "new_value": "May 6th" }
- "Change my favorite color from blue to red" -> { "intent": "update", "search_term": "favorite color", "new_value": "red" }
- "Delete what I told you about my job" -> { "intent": "delete", "search_term": "job" }
- "I like pizza" -> { "intent": "conversation" }

IMPORTANT: Always extract the correct search terms and new values for proper memory operations.
For updates, correctly identify both what needs to be searched for and the new value to replace it with.

User message: "${userPrompt}"
`;

  try {
    console.log("🧠 [MEMORY_ANALYZER] Sending intent detection prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending memory intent detection prompt to OpenAI', { prompt }, 'memory.analyze.2');
    
    const apiStartTime = Date.now();
    
    const apiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: prompt }],
      temperature: 0.2
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Memory intent analysis completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, 'memory.analyze.2.1');

    const content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Memory intent response:", content);
    appLogger.log('OPENAI_RESPONSE', 'Received memory intent analysis', { raw: content }, 'memory.analyze.3');
    
    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("❌ [MEMORY_PARSE] JSON parsing error:", parseError.message);
      appLogger.log('ERROR', 'Failed to parse memory intent analysis', { 
        error: parseError.message, 
        rawContent: content,
        userPrompt 
      }, 'memory.analyze.3.error');
      
      return { intent: "conversation" }; // Default to conversation on parse error
    }

    if (parsed.intent === undefined) {
      console.error("❌ [MEMORY_PARSE] Missing 'intent' property");
      appLogger.log('ERROR', 'Invalid memory intent structure', { 
        error: "Missing 'intent' property", 
        parsed,
        userPrompt 
      }, 'memory.analyze.3.error');
      
      return { intent: "conversation" };
    }
    
    console.log("🧠 [MEMORY_ANALYZER] Intent detected:", parsed.intent);
    appLogger.log('MEMORY', 'Memory intent detection result', { 
      intent: parsed.intent,
      searchTerm: parsed.search_term || null,
      newValue: parsed.new_value || null
    }, 'memory.analyze.4');

    return parsed;
  } catch (err) {
    console.error("❌ [MEMORY_ANALYZER] Error:", err.message);
    appLogger.log('ERROR', 'Memory intent analysis error', { 
      error: err.message,
      stack: err.stack,
      userPrompt 
    }, 'memory.analyze.error');
    
    // Default to conversation on error
    return { intent: "conversation" };
  }
}

// =====================================================================
// MEMORY SEARCH HANDLER - WITH IMPROVED RANKING AND FILTERING
// =====================================================================
/**
 * Builds a clean memory table from memory entries
 * @param {Array} memoryEntries - Memory entries with metadata
 * @returns {Array} - Formatted memory table
 */
function buildMemoryTable(memoryEntries = []) {
  if (!Array.isArray(memoryEntries) || memoryEntries.length === 0) {
    return [];
  }
  
  return memoryEntries.map(entry => ({
    id: entry.id || `legacy_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    text: entry.text || '',
    timestamp: entry.timestamp || new Date().toISOString(),
    date: entry.memory_date || new Date().toISOString().split('T')[0],
    column: entry.column || '',
    rowId: entry.rowId || 0,
    matchCount: entry.matchCount || 0
  }));
}

/**
 * Filters and sorts memory table by match count
 * @param {Array} table - Memory table
 * @param {number} minMatch - Minimum match count to include
 * @returns {Array} - Filtered and sorted memory table
 */
function filterAndSortMemoryTable(table, minMatch = 1) {
  if (!Array.isArray(table) || table.length === 0) {
    return [];
  }
  
  // First sort by matchCount (descending)
  const sorted = [...table].sort((a, b) => b.matchCount - a.matchCount);
  
  // If we have enough results with high match counts, filter by minimum threshold
  if (sorted.length > 3 && sorted[0].matchCount >= minMatch) {
    return sorted.filter(entry => entry.matchCount >= minMatch);
  }
  
  // Otherwise return all results (sorted)
  return sorted;
}

/**
 * Handle search for memory entries with improved matching and ranking
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} searchTerm - The term to search for
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Response object
 */
async function handleMemorySearch(req, res, searchTerm, userId, requestId) {
  console.log(`🔍 [MEMORY] Searching memory for: "${searchTerm}"`);
  appLogger.log('MEMORY', 'Processing memory search', { 
    searchTerm, 
    userId,
    requestId 
  }, 'memory.search.1');
  
  try {
    // Get raw memory search results with match counts from db.js
    const memoryData = await db.searchMemory(userId, searchTerm);
    console.log(`🔍 [MEMORY] Search returned ${memoryData.length} raw results`);
    
    if (memoryData.length === 0) {
      appLogger.log('MEMORY', 'No memory search results found', { searchTerm }, 'memory.search.3');
      
      return res.json({
        message: `I don't have any stored memories about "${searchTerm}". Would you like to tell me about it?`,
        resultType: 'memory',
        results: []
      });
    }
    
    // Build structured memory table from search results
    const memoryTable = buildMemoryTable(memoryData);
    console.log(`🔍 [MEMORY] Built memory table with ${memoryTable.length} entries`);
    
    // Apply adaptive minimum match threshold based on best match
    const bestMatchScore = memoryTable.length > 0 ? memoryTable[0].matchCount : 0;
    let minMatchThreshold = 1; // Default threshold
    
    // Adjust threshold based on best match quality
    if (bestMatchScore > 10) {
      minMatchThreshold = 3; // For very strong matches, be more selective
    } else if (bestMatchScore > 5) {
      minMatchThreshold = 2; // For medium-strength matches
    }
    
    console.log(`🔍 [MEMORY] Using match threshold ${minMatchThreshold} (best score: ${bestMatchScore})`);
    
    // Filter and sort by match count
    const topMatches = filterAndSortMemoryTable(memoryTable, minMatchThreshold);
    console.log(`🔍 [MEMORY] Filtered to ${topMatches.length} top matches`);
    
    // Take at most 10 results to avoid overwhelming the API
    const limitedMatches = topMatches.slice(0, 10);
    
    if (limitedMatches.length > 0) {
      // Format dates properly for display
      const formattedResults = limitedMatches.map(item => {
        return {
          ...item,
          formattedDate: new Date(item.date).toLocaleDateString('en-US', {
            year: 'numeric', 
            month: 'long', 
            day: 'numeric'
          })
        };
      });
      
      appLogger.log('MEMORY', 'Memory search results', { 
        searchTerm,
        resultCount: formattedResults.length,
        topMatchScore: formattedResults[0]?.matchCount || 0
      }, 'memory.search.2');
      
      // Log top matches for debugging
      console.log(`🔍 [MEMORY] Top 3 matches:`);
      formattedResults.slice(0, 3).forEach((match, i) => {
        console.log(`  ${i+1}. Score ${match.matchCount}: "${match.text.substring(0, 50)}..."`);
      });
      
      // Generate summary of top memory search results
      const summary = await summarizeMemoryFacts(formattedResults, searchTerm);
      
      return res.json({
        message: summary,
        resultType: 'memory',
        results: formattedResults
      });
    } else {
      appLogger.log('MEMORY', 'No matching results after filtering', { searchTerm }, 'memory.search.3');
      
      return res.json({
        message: `I don't have any stored memories about "${searchTerm}". Would you like to tell me about it?`,
        resultType: 'memory',
        results: []
      });
    }
  } catch (err) {
    console.error("❌ [MEMORY_SEARCH] Error:", err.message);
    appLogger.log('ERROR', 'Memory search error', { 
      error: err.message,
      stack: err.stack,
      searchTerm,
      userId,
      requestId
    }, 'memory.search.error');
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't search your memories right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY UPDATE HANDLER
// =====================================================================
/**
 * Handle intent to update memory entries
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} searchTerm - Term to search for memory to update
 * @param {string} newValue - New value to update to
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Response object
 */
async function handleMemoryUpdate(req, res, searchTerm, newValue, userId, requestId) {
  console.log(`🔄 [MEMORY] Update request for: ${searchTerm} -> ${newValue}`);
  appLogger.log('MEMORY', 'Processing memory update request', { 
    searchTerm, 
    newValue,
    userId,
    requestId 
  }, 'memory.update.1');
  
  try {
    // First, search for matching memories
    const searchResults = await db.searchMemory(userId, searchTerm);
    
    // Build memory table from search results
    const memoryTable = buildMemoryTable(searchResults);
    
    // Sort by match count 
    const sortedResults = filterAndSortMemoryTable(memoryTable, 0); // Include all matches
    
    if (sortedResults.length === 0) {
      appLogger.log('MEMORY', 'No memories found to update', { searchTerm }, 'memory.update.2');
      
      return res.json({
        message: `I couldn't find any memories about "${searchTerm}" to update. Would you like to add this information instead?`,
        resultType: 'memory',
        action: 'not_found'
      });
    }
    
    // Format results for display
    const formattedResults = sortedResults.map(item => {
      return {
        ...item,
        formattedDate: new Date(item.date).toLocaleDateString('en-US', {
          year: 'numeric', 
          month: 'long', 
          day: 'numeric'
        })
      };
    });
    
    appLogger.log('MEMORY', 'Found memories for update selection', { 
      count: formattedResults.length,
      searchTerm,
      newValue 
    }, 'memory.update.3');
    
    // We're returning the search results so the frontend can display them
    // with update buttons. The actual update will happen in a separate request.
    return res.json({
      message: `I found ${sortedResults.length} ${sortedResults.length === 1 ? 'memory' : 'memories'} about "${searchTerm}". Which one would you like to update?`,
      resultType: 'memory',
      action: 'update_choice',
      results: formattedResults,
      newValue
    });
  } catch (err) {
    console.error("❌ [MEMORY_UPDATE] Error:", err.message);
    appLogger.log('ERROR', 'Memory update selection error', { 
      error: err.message,
      stack: err.stack,
      searchTerm,
      newValue,
      userId,
      requestId
    }, 'memory.update.error');
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't process your memory update request right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY UPDATE PROCESSOR - HANDLES THE ACTUAL MEMORY UPDATE
// =====================================================================
/**
 * Process memory update after user selects which memory to update
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - Response object
 */
async function processMemoryUpdate(req, res) {
  try {
    // Extract parameters - only need memoryId, newValue, and userId
    const { memoryId, newValue, userId: bodyUserId } = req.body;
    const userId = req.user ? req.user.id : bodyUserId;
    
    console.log(`🔄 [MEMORY_UPDATE_PROCESS] Received update request from frontend:`, {
      memoryId: typeof memoryId === 'string' ? memoryId.slice(0, 30) + '...' : memoryId,
      newValue: newValue?.slice(0, 30) + '...',
      userId,
      hasReqUser: !!req.user
    });
    
    // Check for all required parameters including userId
    if (!memoryId || !newValue || !userId) {
      console.error(`❌ [MEMORY_UPDATE_PROCESS] Missing required parameters:`, {
        hasMemoryId: !!memoryId,
        hasNewValue: !!newValue,
        hasUserId: !!userId
      });
      
      return res.status(400).json({ 
        message: "Missing required parameters for memory update",
        resultType: "memory"
      });
    }
    
    // Use the simplified database function to update memory
    console.log(`🔄 [MEMORY_UPDATE_PROCESS] Calling updateMemory function with userId: ${userId}`);
    const updated = await db.updateMemory(userId, memoryId, newValue);
    
    console.log(`🔄 [MEMORY_UPDATE_PROCESS] updateMemory result:`, updated);
    
    if (!updated) {
      appLogger.log('ERROR', 'Memory update failed', { 
        userId
      }, 'memory.update.process.error');
      
      return res.status(500).json({
        message: "Failed to update memory. Please try again.",
        resultType: "memory"
      });
    }
    
    appLogger.log('MEMORY', 'Memory successfully updated', { 
      memoryId: typeof memoryId === 'string' ? memoryId.slice(0, 50) : memoryId,
      newValue: newValue.slice(0, 50),
      userId
    }, 'memory.update.process.5');
    
    return res.json({
      message: `I've updated the memory to "${newValue}".`,
      resultType: "memory",
      action: "updated"
    });
  } catch (error) {
    console.error("❌ [MEMORY_UPDATE_PROCESS] Error:", error.message);
    appLogger.log('ERROR', 'Memory update processing error', {
      error: error.message,
      stack: error.stack
    }, 'memory.update.process.error');
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't update your memory right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY DELETION HANDLER
// =====================================================================
/**
 * Handle intent to delete memory entries
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} searchTerm - Term to search for memory to delete
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Response object
 */
async function handleMemoryDeletion(req, res, searchTerm, userId, requestId) {
  console.log(`🗑️ [MEMORY] Deletion request for: ${searchTerm}`);
  appLogger.log('MEMORY', 'Processing memory deletion request', { 
    searchTerm, 
    userId,
    requestId 
  }, 'memory.delete.1');
  
  try {
    // First, search for matching memories
    const searchResults = await db.searchMemory(userId, searchTerm);
    
    // Build memory table from search results
    const memoryTable = buildMemoryTable(searchResults);
    
    // Sort by match count 
    const sortedResults = filterAndSortMemoryTable(memoryTable, 0); // Include all matches
    
    if (sortedResults.length === 0) {
      appLogger.log('MEMORY', 'No memories found to delete', { searchTerm }, 'memory.delete.2');
      
      return res.json({
        message: `I couldn't find any memories about "${searchTerm}" to delete.`,
        resultType: 'memory',
        action: 'not_found'
      });
    }
    
    // Format results for display
    const formattedResults = sortedResults.map(item => {
      return {
        ...item,
        formattedDate: new Date(item.date).toLocaleDateString('en-US', {
          year: 'numeric', 
          month: 'long', 
          day: 'numeric'
        })
      };
    });
    
    appLogger.log('MEMORY', 'Found memories for deletion selection', { 
      count: formattedResults.length,
      searchTerm
    }, 'memory.delete.3');
    
    // We're returning the search results so the frontend can display them
    // with delete buttons. The actual deletion will happen in a separate request.
    return res.json({
      message: `I found ${sortedResults.length} ${sortedResults.length === 1 ? 'memory' : 'memories'} about "${searchTerm}". Which one would you like to delete?`,
      resultType: 'memory',
      action: 'delete_choice',
      results: formattedResults
    });
  } catch (err) {
    console.error("❌ [MEMORY_DELETE] Error:", err.message);
    appLogger.log('ERROR', 'Memory deletion selection error', { 
      error: err.message,
      stack: err.stack,
      searchTerm,
      userId,
      requestId
    }, 'memory.delete.error');
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't process your memory deletion request right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY DELETION PROCESSOR - HANDLES THE ACTUAL MEMORY DELETION
// =====================================================================
/**
 * Process memory deletion after user selects which memory to delete
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - Response object
 */
async function processMemoryDeletion(req, res) {
  try {
    // Extract parameters - only need memoryId and userId
    const { memoryId, userId: bodyUserId } = req.body;
    const userId = req.user ? req.user.id : bodyUserId;
    
    console.log(`🗑️ [MEMORY_DELETE_PROCESS] Received delete request from frontend:`, {
      memoryId: typeof memoryId === 'string' ? memoryId.slice(0, 30) + '...' : memoryId,
      userId,
      hasReqUser: !!req.user
    });
    
    // Check for all required parameters including userId
    if (!memoryId || !userId) {
      console.error(`❌ [MEMORY_DELETE_PROCESS] Missing required parameters:`, {
        hasMemoryId: !!memoryId,
        hasUserId: !!userId
      });
      
      return res.status(400).json({ 
        message: "Missing required parameters for memory deletion",
        resultType: "memory"
      });
    }
    
    // Use the simplified database function to delete memory
    console.log(`🗑️ [MEMORY_DELETE_PROCESS] Calling deleteMemory function with userId: ${userId}`);
    const deleted = await db.deleteMemory(userId, memoryId);
    
    console.log(`🗑️ [MEMORY_DELETE_PROCESS] deleteMemory result:`, deleted);
    
    if (!deleted) {
      appLogger.log('ERROR', 'Memory deletion failed', { 
        userId
      }, 'memory.delete.process.error');
      
      return res.status(500).json({
        message: "Failed to delete memory. Please try again.",
        resultType: "memory"
      });
    }
    
    appLogger.log('MEMORY', 'Memory successfully deleted', { 
      memoryId: typeof memoryId === 'string' ? memoryId.slice(0, 50) : memoryId,
      userId
    }, 'memory.delete.process.5');
    
    return res.json({
      message: `I've deleted the memory.`,
      resultType: "memory",
      action: "deleted"
    });
  } catch (error) {
    console.error("❌ [MEMORY_DELETE_PROCESS] Error:", error.message);
    appLogger.log('ERROR', 'Memory deletion processing error', {
      error: error.message,
      stack: error.stack
    }, 'memory.delete.process.error');
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't delete your memory right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY CONVERSATION HANDLER
// =====================================================================
/**
 * Process a conversation in memory mode for storing facts
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} userPrompt - User's message
 * @param {number} userId - User ID
 * @param {string} requestId - Unique request identifier
 * @returns {Promise<Object>} - Response object
 */
async function handleMemoryConversationPrompt(req, res, userPrompt, userId, requestId) {
  console.log("🧠 [MEMORY_CONV] Processing memory conversation:", userPrompt?.slice(0, 50));
  appLogger.log('MEMORY', 'Processing memory conversation for storing facts', { 
    userPrompt: userPrompt?.slice(0, 50),
    requestId
  }, 'memory.conv.1');
  
  try {
    const prompt = `
You are an AI assistant that helps store personal information the user shares.
Analyze this message and determine if there's any personal information to remember:

"${userPrompt}"

Reply in JSON format:
{
  "reply": "Your friendly response to the user",
  "store": true/false,
  "memory": "The exact fact to store (only if store=true)"
}

Examples:
- If user says "My birthday is May 5th": 
  { "reply": "I'll remember that your birthday is May 5th!", "store": true, "memory": "User's birthday is May 5th" }
- If user says "Uday's birthday is June 10th":
  { "reply": "I'll remember that Uday's birthday is June 10th!", "store": true, "memory": "Uday's birthday is June 10th" }
- If user says "I like pizza": 
  { "reply": "Thanks for letting me know you enjoy pizza!", "store": true, "memory": "User likes pizza" }
- If user says "How are you today?": 
  { "reply": "I'm doing well, thanks for asking! How are you?", "store": false }

Always capture personal information, preferences, dates, names, and facts.
IMPORTANT: For dates, include the full date in the memory. Don't convert dates to a format that might cause "Invalid Date" errors.
`;

    console.log("🔎 [OPENAI_REQUEST] Sending memory conversation prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending memory conversation prompt to OpenAI', { 
      prompt 
    }, 'memory.conv.2');
    
    const apiStartTime = Date.now();
    
    const apiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: prompt }],
      temperature: 0.6
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Memory conversation API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, 'memory.conv.2.1');

    const content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Memory conversation response:", content);
    
    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("❌ [MEMORY_PARSE] JSON parsing error:", parseError.message);
      appLogger.log('ERROR', 'Failed to parse memory conversation response', { 
        error: parseError.message, 
        rawContent: content,
        userPrompt 
      }, 'memory.conv.3.error');
      
      // Return a fallback response
      return res.json({
        message: "I understand, but I'm having trouble processing that right now.",
        resultType: "memory"
      });
    }
    
    // Extract reply and store information
    const reply = parsed.reply || "I'm here to help!";
    const shouldStore = parsed.store === true;
    const memoryText = parsed.memory;
    
    // Store memory if needed and get the memory ID
    let memoryId = null;
    if (shouldStore && memoryText) {
      console.log("🧠 [MEMORY_STORE] Storing memory fact:", memoryText);
      
      // db.saveMemory now returns the memory ID
      memoryId = await db.saveMemory(userId, memoryText);
      
      appLogger.log('MEMORY', 'Stored memory fact', { 
        userId, 
        memoryText,
        memoryId
      }, 'memory.conv.4');
    }
    
    // Include memoryId in the response if available
    const response = {
      message: reply,
      resultType: "memory"
    };
    
    if (memoryId) {
      response.memoryId = memoryId;
    }
    
    // Return the conversation response
    return res.json(response);
    
  } catch (err) {
    console.error("❌ [MEMORY_CONV] Error:", err.message);
    
    appLogger.log('ERROR', 'Memory conversation error', {
      requestId,
      error: err.message,
      stack: err.stack
    }, 'memory.conv.error');
    
    // Log error to database
    try {
      await db.logError({
        message: err.message,
        location: 'handleMemoryConversationPrompt',
        stack: err.stack,
        userAgent: req.headers['user-agent']
      });
    } catch (logError) {
      console.error('❌ [ERROR_LOG] Failed to log error to database:', logError.message);
    }
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't process your memory message right now.",
      resultType: "memory"
    });
  }
}

// =====================================================================
// MEMORY SUMMARY - IMPROVED PROMPT FOR BETTER ACCURACY
// =====================================================================
/**
 * Summarizes memory results into a natural language response with improved prompting
 * @param {Array} memories - Memory items retrieved from database
 * @param {string} userQuery - The original user query
 * @returns {Promise<string>} - Formatted response
 */
async function summarizeMemoryFacts(memories, userQuery) {
  console.log("📊 [MEMORY_SUMMARY] Summarizing", memories.length, "memory facts");
  appLogger.log('MEMORY', 'Summarizing memory facts', { 
    userQuery, 
    memoryCount: memories.length,
    topMemoryScore: memories[0]?.matchCount || 0
  }, 'memory.summary.1');
  
  if (!memories || memories.length === 0) {
    return "I don't have any stored memories about that.";
  }
  
  // Include relevance scores in prompt for better context
  const scoredMemories = memories.map(m => ({
    text: m.text,
    score: m.matchCount || 0,
    date: m.formattedDate || new Date(m.date).toLocaleDateString()
  }));
  
  // IMPROVED: Enhanced prompt for better answers with ranking context
  const summaryPrompt = `
You are a personal memory assistant that helps recall stored information.

A user asked: "${userQuery}"

Here are stored memory facts that match their question, ranked by relevance score (higher is better):
${scoredMemories.map((mem, i) => `${i+1}. [Score: ${mem.score}] "${mem.text}" (from ${mem.date})`).join('\n')}

Only use these facts to answer the question. Do NOT guess or assume. 
If none of the facts directly answer the question, respond with: "I have some information that might be related, but I don't have a specific answer to your question."

Your response should be:
1. Accurate - only use the information in the memories
2. Concise - respond in 1-2 sentences
3. Helpful - prioritize information from higher-scored memories
4. Confident - when a clear answer exists in a high-scoring memory

IMPORTANT: If the memories contain any dates, leave them exactly as they appear (don't try to reformat or make them more specific).
Don't attempt to extract or calculate dates from the text in ways that could cause "Invalid Date" errors.
`;

  try {
    console.log("🔎 [OPENAI_REQUEST] Sending memory summarization prompt to OpenAI");
    appLogger.log('OPENAI_REQUEST', 'Sending memory summarization prompt to OpenAI', { 
      summaryPrompt, 
      memoryCount: memories.length,
      topScore: scoredMemories[0]?.score || 0
    }, 'memory.summary.2');
    
    const apiStartTime = Date.now();
    
    const apiResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes stored memories." },
        { role: "user", content: summaryPrompt }
      ],
      temperature: 0.3 // Lower temperature for more precise answers
    });
    
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [OPENAI] Memory summary API call completed in ${apiDuration}ms`);
    appLogger.log('OPENAI_DEBUG', 'OpenAI API call duration', { 
      durationMs: apiDuration,
      success: true 
    }, 'memory.summary.2.1');

    const content = apiResponse.choices[0].message.content.trim();
    console.log("📬 [OPENAI_RAW] Memory summary response:", content);
    appLogger.log('OPENAI_RESPONSE', 'Received memory summary response', { 
      summary: content 
    }, 'memory.summary.3');
    
    return content;
  } catch (err) {
    console.error("❌ [MEMORY_SUMMARY] Error:", err.message);
    appLogger.log('ERROR', 'Memory summarization error', { 
      error: err.message,
      stack: err.stack,
      userQuery
    }, 'memory.summary.error');
    
    // Fallback to basic summary
    const factCount = memories.length;
    return `I found ${factCount} ${factCount === 1 ? 'memory' : 'memories'} related to your question. ${memories[0]?.text || ''}`;
  }
}

// =====================================================================
// MASTER MEMORY HANDLER
// =====================================================================
/**
 * Master handler for all memory-related requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} - Response object
 */
async function handleMemoryPrompt(req, res) {
  const requestId = Date.now().toString();
  const userId = req.user ? req.user.id : req.body.userId; // MODIFIED: Added fallback
  const { prompt } = req.body;
  
  console.log(`🧠 [MEMORY_MASTER] Processing memory request ${requestId}:`, prompt?.slice(0, 50));
  appLogger.log('MEMORY', 'Starting memory request processing', { 
    requestId,
    prompt: prompt?.slice(0, 50),
    userId,
    hasReqUser: !!req.user
  }, 'memory.master.1');
  
  // MODIFIED: Check if we have a valid userId
  if (!userId) {
    console.error("❌ [MEMORY_MASTER] No user ID available");
    return res.status(400).json({
      message: "User ID is required for memory operations",
      resultType: "memory"
    });
  }
  
  try {
    // First, analyze the intent of the memory request
    const intentAnalysis = await analyzeMemoryIntent(prompt);
    
    // Route based on the detected intent
    switch (intentAnalysis.intent) {
      case "search":
        appLogger.log('MEMORY', 'Routing to memory search handler', { 
          searchTerm: intentAnalysis.search_term 
        }, 'memory.master.route.search');
        
        return await handleMemorySearch(req, res, intentAnalysis.search_term, userId, requestId);
        
      case "update":
        appLogger.log('MEMORY', 'Routing to memory update handler', { 
          searchTerm: intentAnalysis.search_term,
          newValue: intentAnalysis.new_value
        }, 'memory.master.route.update');
        
        return await handleMemoryUpdate(req, res, intentAnalysis.search_term, intentAnalysis.new_value, userId, requestId);
        
      case "delete":
        appLogger.log('MEMORY', 'Routing to memory deletion handler', { 
          searchTerm: intentAnalysis.search_term 
        }, 'memory.master.route.delete');
        
        return await handleMemoryDeletion(req, res, intentAnalysis.search_term, userId, requestId);
        
      case "conversation":
      default:
        appLogger.log('MEMORY', 'Routing to conversation handler', { 
          intent: intentAnalysis.intent 
        }, 'memory.master.route.conversation');
        
        return await handleMemoryConversationPrompt(req, res, prompt, userId, requestId);
    }
  } catch (error) {
    console.error("❌ [MEMORY_MASTER] Error:", error.message);
    appLogger.log('ERROR', 'Memory master handler error', {
      requestId,
      error: error.message,
      stack: error.stack
    }, 'memory.master.error');
    
    // Log error to database
    try {
      await db.logError({
        message: error.message,
        location: 'handleMemoryPrompt',
        stack: error.stack,
        userAgent: req.headers['user-agent']
      });
    } catch (logError) {
      console.error('❌ [ERROR_LOG] Failed to log error to database:', logError.message);
    }
    
    return res.status(500).json({ 
      message: "Sorry, I couldn't process your memory request right now.",
      resultType: "memory"
    });
  }
}

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
  
  // NEW/MODIFIED: Updated systemPrompt to include memo action detection
  const systemPrompt = `
You are a MySQL assistant for filtering a "memos" table.
Extract search filters from this user message:
"${userMessage}"
`;

  // NEW/MODIFIED: Updated instruction with action detection
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
    
    // NEW/MODIFIED: Log if an action was detected
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

    // NEW/MODIFIED: Return the full parsed object, not just the filters
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
    
    switch (classification) {
      case 'memo':
        // NEW/MODIFIED: Generate filters from the user's natural language query with action detection
        const memoFilters = await generateMemoFilters(prompt);
        console.log('📋 [MEMOS] Filters generated:', memoFilters);
        
        // NEW/MODIFIED: Extract action if present in memo filters
        let action = null;
        let memoNumber = null;
        let customerName = null;
        if (memoFilters.action) {
          action = memoFilters.action;
          memoNumber = memoFilters.memoNumber;
          customerName = memoFilters.customerName;
          
          console.log(`🎯 [ACTION] Detected memo action: ${action}`);
        }
        
        // NEW/MODIFIED: Add user ID to ensure data isolation
        if (memoFilters.filters) {
          memoFilters.filters.userId = userId;
          
          // Query the database with the generated filters
          results = await db.findMemos(memoFilters.filters);
        } else {
          // Backward compatibility for old format
          memoFilters.userId = userId;
          results = await db.findMemos(memoFilters);
        }
        
        console.log(`📊 [MEMOS] Found ${results.length} results`);
        
        // Generate natural language summary
        message = await summarizeResults(prompt, results, 'memo');
        
        // NEW/MODIFIED: Return results with action info if present
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
// CHAT ROUTES
// =====================================================================

// Get all chats for the authenticated user (paginated)
router.get('/api/chats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`Fetching all chats for user ${userId}`);
    
    // Use the getRecentChats function with high limit for backward compatibility
    const chats = await db.getRecentChats(userId, 50, 0);
    
    // Format for compatibility with legacy format
    const formattedChats = chats.map(chat => {
      // Get the first message content as title or use a default
      const title = chat.messages && chat.messages.length > 0 && chat.messages[0].content
        ? chat.messages[0].content.substring(0, 30) + (chat.messages[0].content.length > 30 ? '...' : '')
        : 'Untitled Chat';
        
      return {
        id: chat.rowId,
        rowId: chat.rowId,
        column: chat.column,
        title: title,
        chat_date: chat.chat_date,
        message_count: chat.messages ? chat.messages.length : 0
      };
    });
    
    res.json({ 
      success: true, 
      chats: formattedChats
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Get recent chats with pagination
router.get('/api/chats/recent', auth, async (req, res) => {
  try {
    // Add debug logging to identify issues
    console.log("[DEBUG] Starting /api/chats/recent route");
    console.log("[DEBUG] User:", req.user);
    
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 12;
    const offset = parseInt(req.query.offset) || 0;
    
    console.log(`[DEBUG] Getting recent chats with userId=${userId}, limit=${limit}, offset=${offset}`);
    
    // Check if getRecentChats exists
    console.log("[DEBUG] db.getRecentChats exists:", typeof db.getRecentChats === 'function');
    
    // Get chats from the database
    const chats = await db.getRecentChats(userId, limit, offset);
    console.log(`[DEBUG] Found ${chats.length} chats`);
    
    res.json({ 
      success: true, 
      chats: chats
    });
  } catch (error) {
    console.error('Error in /api/chats/recent:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Search chats
router.get('/api/chats/search', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const query = req.query.q;
    
    if (!query) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Search query is required'
      });
    }
    
    console.log(`Searching chats for user ${userId} with query "${query}"`);
    
    const results = await db.searchChats(userId, query);
    
    res.json({ 
      success: true, 
      results: results
    });
  } catch (error) {
    console.error('Error searching chats:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Get one chat by row+column
router.get('/api/chats/single', auth, async (req, res) => {
  try {
    const { rowId, column } = req.query;
    const userId = req.user.id;
    
    if (!rowId || !column) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Both rowId and column are required'
      });
    }
    
    console.log(`Fetching chat at row ${rowId}, column ${column} for user ${userId}`);
    
    const chat = await db.getChatByRowAndColumn(rowId, column, userId);
    
    if (!chat) {
      return res.status(404).json({
        error: 'Chat not found',
        message: `Chat at row ${rowId}, column ${column} not found or you don't have access`
      });
    }
    
    res.json({
      success: true,
      messages: chat.messages
    });
  } catch (error) {
    console.error(`Error fetching chat:`, error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Create a new chat
router.post('/api/chats', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log(`Creating new chat for user ${userId}`);
    
    // Create new chat with column-based architecture
    const chatLocation = await db.createNewChat(userId);
    
    // Return success with the new chat details
    res.status(201).json({
      success: true,
      message: 'Chat created successfully',
      chat: {
        id: chatLocation.rowId, // For backward compatibility
        rowId: chatLocation.rowId,
        column: chatLocation.column,
        title: 'New Chat',
        chat_date: new Date().toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Add message to a chat
router.post('/api/chats/:chatId/messages', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = parseInt(req.params.chatId);
    const { message, column } = req.body;
    
    if (isNaN(chatId)) {
      return res.status(400).json({
        error: 'Invalid chat ID',
        message: 'Chat ID must be a number'
      });
    }
    
    if (!message || typeof message !== 'object') {
      return res.status(400).json({
        error: 'Invalid message format',
        message: 'Message must be an object with role and content'
      });
    }
    
    // Column might be provided in request or need to be determined
    let chatColumn = column;
    
    if (!chatColumn) {
      // Try to find which column contains this chat
      const hourColumns = Array.from({ length: 24 }, (_, i) => `h${i.toString().padStart(2, '0')}`);
      for (const col of hourColumns) {
        const chat = await db.getChatByRowAndColumn(chatId, col, userId);
        if (chat) {
          chatColumn = col;
          break;
        }
      }
      
      if (!chatColumn) {
        return res.status(404).json({
          error: 'Chat not found',
          message: 'Unable to locate the chat. Please provide column name.'
        });
      }
    }
    
    console.log(`Adding message to chat ${chatId}, column ${chatColumn} for user ${userId}`);
    
    // Add timestamp if not provided
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }
    
    try {
      const updatedChat = await db.addMessageToChat(chatId, chatColumn, userId, message);
      
      res.json({
        success: true,
        message: 'Message added successfully',
        chatMessages: updatedChat
      });
    } catch (error) {
      // Special handling for chat size limit
      if (error.message && error.message.includes('Chat memory is full')) {
        return res.status(400).json({
          error: 'Chat size limit exceeded',
          message: 'Chat memory is full. Please start a new chat.'
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error adding message to chat:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Delete a chat
router.delete('/api/chats/:chatId', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const chatId = parseInt(req.params.chatId);
    const { column } = req.body;
    
    if (isNaN(chatId)) {
      return res.status(400).json({
        error: 'Invalid chat ID',
        message: 'Chat ID must be a number'
      });
    }
    
    // Column might be provided in request or need to be determined
    let chatColumn = column;
    
    if (!chatColumn) {
      // Try to find which column contains this chat
      const hourColumns = Array.from({ length: 24 }, (_, i) => `h${i.toString().padStart(2, '0')}`);
      for (const col of hourColumns) {
        const chat = await db.getChatByRowAndColumn(chatId, col, userId);
        if (chat) {
          chatColumn = col;
          break;
        }
      }
      
      if (!chatColumn) {
        return res.status(404).json({
          error: 'Chat not found',
          message: 'Unable to locate the chat. Please provide column name.'
        });
      }
    }
    
    console.log(`Deleting chat ${chatId}, column ${chatColumn} for user ${userId}`);
    
    const success = await db.deleteChat(chatId, chatColumn, userId);
    
    res.json({
      success,
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// =====================================================================
// COMMON API ENDPOINTS
// =====================================================================

// Main API endpoint for processing requests
router.post('/process', auth, async (req, res) => {
  await mainPipelineHandler(req, res);
});

// Memory management endpoints
router.post('/memory/update', auth, async (req, res) => {
  console.log('🔄 [API] Received memory update request');
  await processMemoryUpdate(req, res);
});

router.post('/memory/delete', auth, async (req, res) => {
  console.log('🗑️ [API] Received memory delete request');
  await processMemoryDeletion(req, res);
});

// Simple test endpoint for connection debugging
router.post('/test', auth, (req, res) => {
  console.log("🧪 TEST endpoint reached!");
  console.log("Request body:", req.body);
  res.json({ 
    success: true, 
    message: "Test endpoint working!",
    receivedData: req.body 
  });
});

// Export the router
module.exports = router;
