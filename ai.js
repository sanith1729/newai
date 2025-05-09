/**
 * Business AI Assistant Main Script
 * This script handles the AI interface, chat functionality, authentication,
 * and dynamic component injection.
 */

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements - App UI
    const authContainer = document.getElementById('authContainer');
    const appHeader = document.getElementById('appHeader');
    const appMainContainer = document.getElementById('appMainContainer');
    const messagesContainer = document.getElementById('messagesContainer');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const chatForm = document.getElementById('chatForm');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const logoutBtn = document.getElementById('logoutBtn');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');
    const memoryToggleBtn = document.getElementById('memoryToggleBtn');
    const chatContainer = document.getElementById('chatContainer');
    const toastContainer = document.getElementById('toast-container');
    const dynamicComponentContainer = document.getElementById('dynamicComponentContainer');
    
    // DOM Elements - Auth UI
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const showRegisterLink = document.getElementById('showRegisterLink');
    const showLoginLink = document.getElementById('showLoginLink');
    const loginButton = document.getElementById('loginButton');
    const registerButton = document.getElementById('registerButton');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const registerEmail = document.getElementById('registerEmail');
    const registerPassword = document.getElementById('registerPassword');
    const confirmPassword = document.getElementById('confirmPassword');
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    const loginEmailError = document.getElementById('loginEmailError');
    const loginPasswordError = document.getElementById('loginPasswordError');
    const registerEmailError = document.getElementById('registerEmailError');
    const registerPasswordError = document.getElementById('registerPasswordError');
    const confirmPasswordError = document.getElementById('confirmPasswordError');
    
    // DOM Elements - Chat Sidebar
    const chatSidebar = document.getElementById('chatSidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const chatList = document.getElementById('chatList');
    const newChatBtn = document.getElementById('newChatBtn');
    const storageStatus = document.getElementById('storageStatus');
    const chatSearchInput = document.getElementById('chatSearchInput');
    const loadMoreChatsBtn = document.getElementById('loadMoreChatsBtn');
    
    // Memory dialog elements
    const memoryUpdateDialog = document.getElementById('memoryUpdateDialog');
    const memoryUpdateOld = document.getElementById('memoryUpdateOld');
    const memoryUpdateInput = document.getElementById('memoryUpdateInput');
    const memoryUpdateId = document.getElementById('memoryUpdateId');
    const memoryUpdateCancel = document.getElementById('memoryUpdateCancel');
    const memoryUpdateConfirm = document.getElementById('memoryUpdateConfirm');
    
    const memoryDeleteDialog = document.getElementById('memoryDeleteDialog');
    const memoryDeleteText = document.getElementById('memoryDeleteText');
    const memoryDeleteId = document.getElementById('memoryDeleteId');
    const memoryDeleteCancel = document.getElementById('memoryDeleteCancel');
    const memoryDeleteConfirm = document.getElementById('memoryDeleteConfirm');
    
    // Debug panel elements
    const debugPanel = document.getElementById('debugPanel');
    const debugToggle = document.getElementById('debugToggle');

    // State variables
    let isWaitingForResponse = false;
    let currentChatId = null;
    let currentColumn = null;
    let chatSizeTotalBytes = 0;
    let chats = [];
    let chatOffset = 12; // Starting offset for pagination
    let memoryMode = false;
    let birthdayKeywords = ['birthday', 'born']; // Keywords to filter out from search
    let isSearchingChats = false; // Flag to indicate if we're in search mode
    let currentInjectedComponent = null; // Track the currently injected component
    
    const API_URL = "http://146.190.115.76:3000"; // Centralized API prefix
    
    // Initialize debug panel in development environment
    initializeDebugPanel();
    
    // Auth-related event listeners
    showRegisterLink.addEventListener('click', () => {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        clearErrors();
    });
    
    showLoginLink.addEventListener('click', () => {
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        clearErrors();
    });
    
    // Sidebar toggle for mobile
    toggleSidebarBtn.addEventListener('click', () => {
        chatSidebar.classList.toggle('visible');
    });
    
    // New chat button
    newChatBtn.addEventListener('click', createNewChat);
    
    // Memory mode toggle
    memoryToggleBtn.addEventListener('click', function() {
        memoryMode = !memoryMode;
        
        if (memoryMode) {
            this.classList.add('active');
            chatContainer.classList.add('memory-mode');
        } else {
            this.classList.remove('active');
            chatContainer.classList.remove('memory-mode');
        }
        
        debugLog('info', `Switched to ${memoryMode ? 'Memory' : 'Business'} Mode`);
    });
    
    // Auto-resize the textarea as user types
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        // Enable/disable send button based on input
        sendButton.disabled = this.value.trim() === '';
    });

    // Handle form submission
    chatForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const message = userInput.value.trim();
        if (message && !isWaitingForResponse) {
            sendMessage(message);
        }
    });

    // Handle suggestion chips
    suggestionChips.forEach(chip => {
        chip.addEventListener('click', function() {
            userInput.value = this.textContent;
            userInput.dispatchEvent(new Event('input'));
            sendMessage(this.textContent);
        });
    });
    
    // Memory update dialog event handlers
    memoryUpdateCancel.addEventListener('click', function() {
        memoryUpdateDialog.style.display = 'none';
    });
    
    memoryUpdateConfirm.addEventListener('click', function() {
        debugLog('info', "Update confirm button clicked");
        
        // Get the memory ID and new value
        const memoryId = memoryUpdateId.value;
        const newValue = memoryUpdateInput.value;
        
        // Validate required fields
        if (!memoryId || !newValue) {
            debugLog('error', "Missing memory ID or new value");
            showToast("Missing required information", "error");
            return;
        }
        
        // Call the update function
        updateMemory(memoryId, newValue);
        memoryUpdateDialog.style.display = 'none';
    });
    
    // Memory delete dialog event handlers
    memoryDeleteCancel.addEventListener('click', function() {
        memoryDeleteDialog.style.display = 'none';
    });
    
    memoryDeleteConfirm.addEventListener('click', function() {
        debugLog('info', "Delete confirm button clicked");
        
        // Get the memory ID
        const memoryId = memoryDeleteId.value;
        
        // Validate required field
        if (!memoryId) {
            debugLog('error', "Missing memory ID");
            showToast("Missing memory ID", "error");
            return;
        }
        
        // Call the delete function
        deleteMemory(memoryId);
        memoryDeleteDialog.style.display = 'none';
    });
    
    // Chat search input event
    chatSearchInput.addEventListener('keydown', async function(e) {
        if (e.key === 'Enter') {
            const query = this.value.trim();
            if (!query) {
                // If search is empty, show recent chats
                isSearchingChats = false;
                fetchRecentChats();
                return;
            }
            
            isSearchingChats = true;
            
            try {
                debugLog('info', `Searching chats for: "${query}"`);
                
                const token = localStorage.getItem('jwt');
                const res = await fetch(`${API_URL}/api/chats/search?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (!res.ok) {
                    throw new Error(`Search failed: ${res.status}`);
                }
                
                const data = await res.json();
                
                if (data.success) {
                    debugLog('info', `Found ${data.results.length} matching chats`);
                    
                    // Filter out birthday-related chats from search results
                    // but not for edit/delete functionality
                    const filteredResults = data.results.filter(chat => {
                        if (!chat.messages || chat.messages.length === 0) return true;
                        
                        // Check if any message contains birthday keywords
                        const containsBirthdayKeyword = chat.messages.some(msg => {
                            if (!msg.content) return false;
                            return birthdayKeywords.some(keyword => 
                                msg.content.toLowerCase().includes(keyword));
                        });
                        
                        return !containsBirthdayKeyword;
                    });
                    
                    debugLog('info', `Filtered to ${filteredResults.length} chats (removed birthday entries)`);
                    
                    renderChatList(filteredResults);
                    
                    // Hide load more button during search results
                    loadMoreChatsBtn.style.display = 'none';
                } else {
                    throw new Error(data.error || 'Search failed');
                }
            } catch (error) {
                console.error('Search error:', error);
                showToast('Error searching chats', 'error');
            }
        }
    });
    
    // Load more button
    loadMoreChatsBtn.addEventListener('click', async function() {
        try {
            debugLog('info', `Loading more chats from offset ${chatOffset}`);
            
            const token = localStorage.getItem('jwt');
            const res = await fetch(`${API_URL}/api/chats/recent?limit=12&offset=${chatOffset}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok) {
                throw new Error(`Failed to load more chats: ${res.status}`);
            }
            
            const data = await res.json();
            
            if (data.success) {
                // If no more chats returned, hide the button
                if (data.chats.length === 0) {
                    debugLog('info', 'No more chats to load');
                    this.style.display = 'none';
                    showToast('No more chats to load', 'info');
                    return;
                }
                
                debugLog('info', `Loaded ${data.chats.length} more chats`);
                
                // Append new chats to existing list
                const allChats = [...chats, ...data.chats];
                chats = allChats;
                renderChatList(allChats);
                
                // Update offset for next load
                chatOffset += data.chats.length;
            } else {
                throw new Error(data.error || 'Failed to load more chats');
            }
        } catch (error) {
            console.error('Error loading more chats:', error);
            showToast('Error loading more chats', 'error');
        }
    });
    
    // Handle logout
    logoutBtn.addEventListener('click', function() {
        debugLog('info', "Logout button clicked");
        
        // Clear user data and token
        localStorage.removeItem('jwt');
        localStorage.removeItem('user');
        
        // Reset state
        currentChatId = null;
        currentColumn = null;
        chats = [];
        
        // Show auth screen and hide app
        showAuthScreen();
        
        // Show logout toast
        showToast("Logged out successfully", "success");
    });

    // Allow Enter to submit, Shift+Enter for new line
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (this.value.trim() !== '' && !isWaitingForResponse) {
                sendMessage(this.value.trim());
            }
        }
    });
    
    // Initialize application on page load
    init();

    /**
     * App initialization
     */
    function init() {
        // Check if we have a valid token
        const token = localStorage.getItem('jwt');
        
        if (token) {
            // Initialize the main app
            initializeApp();
        } else {
            // Show auth screen
            showAuthScreen();
        }
        
        // Show debug panel in development
        if (isDevelopment()) {
            debugToggle.style.display = 'block';
        }
    }
    
    /**
     * Show auth screen
     */
    function showAuthScreen() {
        authContainer.style.display = 'block';
        appHeader.style.display = 'none';
        appMainContainer.style.display = 'none';
        
        // Reset forms
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        clearErrors();
        
        // Clear form inputs
        loginEmail.value = '';
        loginPassword.value = '';
        registerEmail.value = '';
        registerPassword.value = '';
        confirmPassword.value = '';
        
        debugLog('info', "Showing auth screen");
    }
    
    /**
     * Initialize main app
     */
    function initializeApp() {
        // Hide auth container and show app
        authContainer.style.display = 'none';
        appHeader.style.display = 'flex';
        appMainContainer.style.display = 'flex';
        
        // Set user avatar and name
        const user = getUser();
        if (user) {
            userName.textContent = user.email || 'User';
            userAvatar.textContent = (user.email || 'U').charAt(0).toUpperCase();
        }
        
        // Fetch chats
        fetchRecentChats();
        
        debugLog('info', "App initialized");
    }
    
    /**
     * Component Injection Function
     * @param {string} componentName - Name of the component to inject ('memos', 'invoices', 'customers')
     * @returns {Promise<void>}
     */
    async function injectComponent(componentName) {
        const container = document.getElementById('dynamicComponentContainer');

        // Step 1: Remove existing module
        container.innerHTML = '';
        currentInjectedComponent = null;

        // Step 2: Load and inject the HTML file
        try {
            debugLog('info', `Loading component: ${componentName}`);
            const res = await fetch(`/${componentName}.component.html`);
            if (!res.ok) {
                throw new Error(`Failed to load component HTML: ${res.status}`);
            }
            const html = await res.text();
            container.innerHTML = html;
        } catch (err) {
            container.innerHTML = '<p>Error loading component.</p>';
            debugLog('error', `Failed to load ${componentName} HTML: ${err.message}`);
            showToast(`Error loading ${componentName} component`, 'error');
            return;
        }

        // Step 3: Load and attach its JS file if not already loaded
        if (!document.getElementById(`${componentName}-script`)) {
            try {
                const script = document.createElement('script');
                script.src = `/${componentName}.js?v=${Date.now()}`; // cache-busted
                script.id = `${componentName}-script`;
                document.body.appendChild(script);
                debugLog('info', `Loaded script: ${componentName}.js`);
            } catch (err) {
                debugLog('error', `Failed to load ${componentName} JS: ${err.message}`);
                showToast(`Error loading ${componentName} script`, 'error');
            }
        }

        // Track what is loaded
        currentInjectedComponent = componentName;
        debugLog('info', `Component ${componentName} injected successfully`);
    }
    
    /**
     * Handle component injection based on AI response
     * @param {Object} data - AI response data 
     */
    function handleComponentInjection(data) {
        if (!data) return;
        
        if (data.action === 'update_memo' || data.action === 'edit_memo' || 
            data.action === 'view_memos' || data.action === 'create_memo') {
            injectComponent('memos');
        } 
        else if (data.action === 'create_invoice' || data.action === 'edit_invoice' || 
                data.action === 'view_invoices') {
            injectComponent('invoices');
        } 
        else if (data.action === 'edit_customer' || data.action === 'view_customers' || 
                data.action === 'add_customer') {
            injectComponent('customers');
        } 
        else if (data.action === 'clear_component') {
            // Clear any injected component
            const container = document.getElementById('dynamicComponentContainer');
            container.innerHTML = '';
            currentInjectedComponent = null;
            debugLog('info', 'Cleared component container');
        }
    }
    
    /**
     * Fetch recent chats
     * @returns {Promise<void>}
     */
    async function fetchRecentChats() {
        try {
            debugLog('info', "Fetching recent chats");
            
            // Show loading state
            chatList.innerHTML = '<div class="chat-item"><i class="fas fa-spinner fa-spin chat-icon"></i><div><div class="chat-title">Loading chats...</div></div></div>';
            
            // Reset search and show load more button
            chatSearchInput.value = '';
            loadMoreChatsBtn.style.display = 'block';
            
            // Reset offset for pagination
            chatOffset = 12;
            isSearchingChats = false;
            
            const token = localStorage.getItem('jwt');
            const response = await fetch(`${API_URL}/api/chats/recent?limit=12&offset=0`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch chats');
            }
            
            const data = await response.json();
            
            if (data.success) {
                chats = data.chats || [];
                renderChatList();
                
                // If no chats, hide load more button
                if (chats.length < 12) {
                    loadMoreChatsBtn.style.display = 'none';
                }
                
                debugLog('info', `Fetched ${chats.length} chats`);
                
                // If we have chats, select the first one
                if (chats.length > 0) {
                    selectChat(chats[0].rowId, chats[0].column);
                } else {
                    // Create new chat if none exist
                    createNewChat();
                }
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            debugLog('error', `Error fetching chats: ${error.message}`);
            showToast('Error loading chats', 'error');
            
            // Show error in chat list
            chatList.innerHTML = '<div class="chat-item"><i class="fas fa-exclamation-circle chat-icon"></i><div><div class="chat-title">Error loading chats</div></div></div>';
        }
    }
    
    /**
     * Render chat list
     * @param {Array} chatsToRender - Optional specific chats to render 
     */
    function renderChatList(chatsToRender = null) {
        const chatData = chatsToRender || chats;
        chatList.innerHTML = '';
        
        if (chatData.length === 0) {
            chatList.innerHTML = '<div class="chat-item"><i class="fas fa-comment-slash chat-icon"></i><div><div class="chat-title">No chats found</div></div></div>';
            return;
        }
        
        chatData.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = `chat-item ${(currentChatId === chat.rowId && currentColumn === chat.column) ? 'active' : ''}`;
            chatItem.dataset.chatId = chat.rowId;
            chatItem.dataset.column = chat.column;
            
            // Extract title from first message if available
            let chatTitle = 'Chat';
            if (chat.messages && chat.messages.length > 0) {
                // Try to get title from first message with content
                for (let msg of chat.messages) {
                    if (msg.content) {
                        chatTitle = msg.content.substring(0, 25);
                        if (msg.content.length > 25) chatTitle += '...';
                        break;
                    }
                }
            } else if (chat.title) {
                // Fallback to provided title
                chatTitle = chat.title;
            }
            
            const chatDate = new Date(chat.chat_date).toLocaleDateString();
            
            chatItem.innerHTML = `
                <i class="fas fa-comment chat-icon"></i>
                <div>
                    <div class="chat-title">${escapeHtml(chatTitle)}</div>
                    <div class="chat-date">${chatDate}</div>
                </div>
                <div class="chat-actions">
                    <button class="chat-action-btn delete-chat-btn" title="Delete Chat">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            // Add event listener for chat selection
            chatItem.addEventListener('click', (e) => {
                // Don't select chat if clicking on action buttons
                if (!e.target.closest('.chat-actions')) {
                    selectChat(chat.rowId, chat.column);
                }
            });
            
            chatList.appendChild(chatItem);
        });
        
        // Add event listeners for chat action buttons
        document.querySelectorAll('.delete-chat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chatItem = btn.closest('.chat-item');
                const rowId = chatItem.dataset.chatId;
                const column = chatItem.dataset.column;
                deleteChat(rowId, column);
            });
        });
        
        // Update storage status
        updateStorageStatus();
    }
    
    /**
     * Update chat storage status
     * @returns {boolean} True if storage is near limit
     */
    function updateStorageStatus() {
        // Calculate total size of chat data
        chatSizeTotalBytes = 0;
        
        // For now just use an approximate calculation
        if (chats.length > 0) {
            chatSizeTotalBytes = JSON.stringify(chats).length;
        }
        
        // Calculate percentage (60KB limit per chat)
        const maxBytes = 60 * 1024;
        const usedPercentage = Math.min(100, Math.floor((chatSizeTotalBytes / maxBytes) * 100));
        
        // Update status text
        storageStatus.textContent = `Chat storage: ${usedPercentage}%`;
        
        // Update color based on percentage
        if (usedPercentage > 90) {
            storageStatus.style.color = 'var(--danger-color)';
        } else if (usedPercentage > 70) {
            storageStatus.style.color = 'var(--warning-color)';
        } else {
            storageStatus.style.color = 'var(--secondary-text)';
        }
        
        // Return true if we're close to limit
        return usedPercentage > 90;
    }
    
    /**
     * Select chat to display
     * @param {number} rowId - Chat row ID
     * @param {string} column - Chat column
     * @returns {Promise<void>}
     */
    async function selectChat(rowId, column) {
        // If same chat, do nothing
        if (currentChatId === rowId && currentColumn === column) return;
        
        try {
            debugLog('info', `Selecting chat at row ${rowId}, column ${column}`);
            
            // Clear current messages
            messagesContainer.innerHTML = '';
            appendLoadingIndicator();
            
            // Update active state in UI
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.toggle('active', 
                    item.dataset.chatId === rowId.toString() && 
                    item.dataset.column === column);
            });
            
            // Fetch chat details
            const token = localStorage.getItem('jwt');
            const response = await fetch(`${API_URL}/api/chats/single?rowId=${rowId}&column=${column}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch chat details');
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Update current chat ID and column
                currentChatId = rowId;
                currentColumn = column;
                
                // Clear any previously injected component
                if (currentInjectedComponent) {
                    dynamicComponentContainer.innerHTML = '';
                    currentInjectedComponent = null;
                }
                
                // Render messages
                removeLoadingIndicator();
                
                // Get the messages from the correct format
                const messages = data.messages;
                
                if (!messages || messages.length === 0) {
                    // Show welcome message for empty chat
                    showWelcomeMessage();
                } else {
                    // Render messages
                    renderChatMessages(messages);
                }
                
                // On mobile, hide sidebar after selection
                if (window.innerWidth <= 768) {
                    chatSidebar.classList.remove('visible');
                }
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            debugLog('error', `Error selecting chat: ${error.message}`);
            showToast('Error loading chat', 'error');
            
            // Show error message
            removeLoadingIndicator();
            messagesContainer.innerHTML = `
                <div class="welcome-container">
                    <div class="welcome-icon">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <h1 class="welcome-title">Error Loading Chat</h1>
                    <p class="welcome-text">
                        There was a problem loading this chat. Please try again or select a different chat.
                    </p>
                </div>
            `;
        }
    }
    
    /**
     * Create a new chat
     * @returns {Promise<void>}
     */
    async function createNewChat() {
        try {
            debugLog('info', "Creating new chat");
            
            // Show loading state in chat list
            const loadingItem = document.createElement('div');
            loadingItem.className = 'chat-item';
            loadingItem.innerHTML = `
                <i class="fas fa-spinner fa-spin chat-icon"></i>
                <div>
                    <div class="chat-title">Creating new chat...</div>
                </div>
            `;
            chatList.prepend(loadingItem);
            
            const token = localStorage.getItem('jwt');
            const response = await fetch(`${API_URL}/api/chats`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                throw new Error('Failed to create chat');
            }
            
            const data = await response.json();
            
            if (data.success && data.chat) {
                // Format for the chat list
                const newChat = {
                    rowId: data.chat.rowId,
                    column: data.chat.column,
                    chat_date: data.chat.chat_date,
                    messages: []
                };
                
                // Add to local cache and refresh list
                chats.unshift(newChat);
                renderChatList();
                
                // Select the new chat
                selectChat(newChat.rowId, newChat.column);
                
                debugLog('info', `Created new chat at row ${newChat.rowId}, column ${newChat.column}`);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            debugLog('error', `Error creating chat: ${error.message}`);
            showToast('Error creating new chat', 'error');
            
            // Remove loading item
            renderChatList();
        }
    }
    
    /**
     * Delete a chat
     * @param {number} rowId - Chat row ID
     * @param {string} column - Chat column
     * @returns {Promise<void>}
     */
    async function deleteChat(rowId, column) {
        try {
            if (!confirm('Are you sure you want to delete this chat?')) {
                return;
            }
            
            debugLog('info', `Deleting chat at row ${rowId}, column ${column}`);
            
            const token = localStorage.getItem('jwt');
            const response = await fetch(`${API_URL}/api/chats/${rowId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ column })
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete chat');
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Remove from local cache
                chats = chats.filter(chat => 
                    !(chat.rowId == rowId && chat.column === column));
                
                // If current chat was deleted
                if (currentChatId == rowId && currentColumn === column) {
                    currentChatId = null;
                    currentColumn = null;
                    
                    // Clear any injected component
                    dynamicComponentContainer.innerHTML = '';
                    currentInjectedComponent = null;
                    
                    // If we have other chats, select the first one
                    if (chats.length > 0) {
                        selectChat(chats[0].rowId, chats[0].column);
                    } else {
                        // Otherwise create a new chat
                        createNewChat();
                    }
                }
                
                // Update UI
                renderChatList();
                
                // Show success message
                showToast('Chat deleted', 'success');
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            debugLog('error', `Error deleting chat: ${error.message}`);
            showToast('Error deleting chat', 'error');
        }
    }
    
    /**
     * Show welcome message
     */
    function showWelcomeMessage() {
        messagesContainer.innerHTML = `
            <div class="welcome-container">
                <div class="welcome-icon">
                    <i class="fas fa-robot"></i>
                </div>
                <h1 class="welcome-title">Welcome to your Business AI Assistant</h1>
                <p class="welcome-text">
                    I can help you find information about your memos, invoices, and customers.
                    Just ask me anything about your business data in natural language.
                    Toggle Memory Mode to store and recall personal information.
                </p>
                <div class="suggestions-container business-suggestions">
                    <div class="suggestion-chip">Show me all open memos</div>
                    <div class="suggestion-chip">Find paid invoices from last month</div>
                    <div class="suggestion-chip">List customers in New York</div>
                    <div class="suggestion-chip">Show memos with diamonds</div>
                    <div class="suggestion-chip">Find invoices over $1000</div>
                    <div class="suggestion-chip">Edit memo 7011</div>
                </div>
                <div class="suggestions-container mode-suggestions">
                    <div class="suggestion-chip">My birthday is May 5th</div>
                    <div class="suggestion-chip">I like to drink coffee in the morning</div>
                    <div class="suggestion-chip">My favorite color is blue</div>
                    <div class="suggestion-chip">When is my birthday?</div>
                    <div class="suggestion-chip">What's my favorite color?</div>
                    <div class="suggestion-chip">What do I drink in the morning?</div>
                </div>
            </div>
        `;
        
        // Re-add event listeners for suggestion chips
        document.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.addEventListener('click', function() {
                userInput.value = this.textContent;
                userInput.dispatchEvent(new Event('input'));
                sendMessage(this.textContent);
            });
        });
    }
    
    /**
     * Render chat messages
     * @param {Array} messages - Chat messages to render
     */
    function renderChatMessages(messages) {
        if (!messages || messages.length === 0) {
            showWelcomeMessage();
            return;
        }
        
        // Clear messages container
        messagesContainer.innerHTML = '';
        
        // Render each message 
        messages.forEach(msg => {
            if (msg.role === 'user') {
                appendUserMessage(msg.content, msg.timestamp);
            } else if (msg.role === 'assistant') {
                appendAssistantMessage(msg.content, msg.timestamp, msg.data);
                
                // Check if we need to inject a component based on the response
                if (msg.data && msg.data.action) {
                    handleComponentInjection(msg.data);
                }
            }
        });
        
        // Scroll to bottom
        scrollToBottom();
    }
    
    /**
     * Send a message to the AI
     * @param {string} message - User message
     */
    function sendMessage(message) {
        // Check if we're already waiting for a response
        if (isWaitingForResponse) return;
        
        // Check if we have a current chat
        if (!currentChatId || !currentColumn) {
            debugLog('error', "No current chat selected");
            showToast("Please create or select a chat first", "error");
            return;
        }
        
        // Check if we're near storage limit
        if (updateStorageStatus()) {
            showToast("Chat is near storage limit. Consider starting a new chat.", "warning");
        }
        
        // Add user message to UI
        appendUserMessage(message);
        
        // Clear input field and reset height
        userInput.value = '';
        userInput.style.height = 'auto';
        sendButton.disabled = true;
        
        // Show loading indicator
        appendLoadingIndicator();
        isWaitingForResponse = true;
        
        // Store user message in conversation history
        const userMsg = {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
            memoryMode: memoryMode
        };
        
        // Send user message to API to add to chat
        const token = localStorage.getItem('jwt');
        
        fetch(`${API_URL}/api/chats/${currentChatId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                message: userMsg,
                column: currentColumn
            })
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 400) {
                    // This could be a chat size limit error
                    return response.json().then(data => {
                        if (data.error === 'Chat size limit exceeded') {
                            showToast("Chat memory is full. Starting a new chat.", "warning");
                            createNewChat().then(() => {
                                // Once new chat is created, retry sending the message
                                setTimeout(() => {
                                    sendMessage(message);
                                }, 1000);
                            });
                            throw new Error('chat_full');
                        } else {
                            throw new Error(data.message || 'Error adding message to chat');
                        }
                    });
                }
                throw new Error('Network response was not ok: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            // Now send to AI API
            return fetch(`${API_URL}/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    prompt: message,
                    memoryMode: memoryMode,
                    userId: getCurrentUserId()
                })
            });
        })
        .then(response => {
            debugLog('info', `AI API response status: ${response.status}`);
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            debugLog('info', `AI API response data type: ${data.resultType}` + 
                    (data.action ? `, action: ${data.action}` : ''));
            
            // Process any memory ID that may be returned
            if (data.memoryId) {
                debugLog('info', `Received memory ID: ${data.memoryId}`);
            }
            
            // Remove loading indicator
            removeLoadingIndicator();
            
            // Add assistant response to UI
            appendAssistantMessage(data.message, new Date().toISOString(), data);
            
            // Handle component injection based on response
            handleComponentInjection(data);
            
            // Store in conversation history
            const assistantMsg = {
                role: 'assistant',
                content: data.message,
                data: data,
                timestamp: new Date().toISOString(),
                memoryMode: memoryMode
            };
            
            // Add assistant message to chat
            return fetch(`${API_URL}/api/chats/${currentChatId}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    message: assistantMsg,
                    column: currentColumn
                })
            }).then(() => {
                // Update chat in local list
                const chatIndex = chats.findIndex(chat => 
                    chat.rowId == currentChatId && chat.column === currentColumn);
                
                if (chatIndex !== -1) {
                    if (!chats[chatIndex].messages) {
                        chats[chatIndex].messages = [];
                    }
                    chats[chatIndex].messages.push(userMsg);
                    chats[chatIndex].messages.push(assistantMsg);
                }
                
                // Update storage status
                updateStorageStatus();
                
                // Reset state
                isWaitingForResponse = false;
            });
        })
        .catch(error => {
            if (error.message === 'chat_full') {
                // Already handled
                return;
            }
            
            debugLog('error', `API error: ${error.message}`);
            removeLoadingIndicator();
            appendAssistantMessage('Sorry, I encountered an error. Please try again.', new Date().toISOString());
            isWaitingForResponse = false;
            showToast('Error connecting to the server', 'error');
        });
        
        // Scroll to bottom
        scrollToBottom();
    }

    /**
     * Append a user message to the chat
     * @param {string} message - User message
     * @param {string} timestamp - Message timestamp
     */
    function appendUserMessage(message, timestamp = new Date().toISOString()) {
        // Remove welcome container if present
        const welcomeContainer = document.querySelector('.welcome-container');
        if (welcomeContainer) {
            messagesContainer.removeChild(welcomeContainer);
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = 'message user';
        messageElement.innerHTML = `
            <div class="message-content">${escapeHtml(message)}</div>
            <div class="message-timestamp">${formatTimestamp(timestamp)}</div>
        `;
        messagesContainer.appendChild(messageElement);
        scrollToBottom();
    }

    /**
     * Append an assistant message to the chat
     * @param {string} message - Assistant message
     * @param {string} timestamp - Message timestamp
     * @param {Object} data - Additional message data
     */
    function appendAssistantMessage(message, timestamp = new Date().toISOString(), data = null) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message assistant';
        
        // Prepare message content with mode tag
        let messageContent = `
            <div class="message-content">
                ${data && data.resultType === 'memory' 
                    ? '<span class="mode-tag memory-tag">Memory</span>' 
                    : '<span class="mode-tag business-tag">Business</span>'}
                ${formatMessage(message)}
            </div>
        `;
        
        // Add appropriate data display based on result type
        if (data && data.results && data.results.length > 0) {
            if (data.resultType === 'memory') {
                if (data.action === 'update_choice') {
                    messageContent += generateMemoryUpdateChoiceDisplay(data);
                } else if (data.action === 'delete_choice') {
                    messageContent += generateMemoryDeleteChoiceDisplay(data);
                } else {
                    messageContent += generateMemoryDisplay(data);
                }
            } else {
                messageContent += generateDataDisplay(data);
            }
        }
        
        messageContent += `<div class="message-timestamp">${formatTimestamp(timestamp)}</div>`;
        
        messageElement.innerHTML = messageContent;
        messagesContainer.appendChild(messageElement);
        
        // Initialize item accordions and memory action buttons
        initAccordions();
        initMemoryActionButtons();
        
        scrollToBottom();
    }

    /**
     * Append loading indicator
     */
    function appendLoadingIndicator() {
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading-indicator';
        loadingElement.innerHTML = `
            <div class="loading-dots">
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
            </div>
        `;
        loadingElement.id = 'loadingIndicator';
        messagesContainer.appendChild(loadingElement);
        scrollToBottom();
    }

    /**
     * Remove loading indicator
     */
    function removeLoadingIndicator() {
        const loadingElement = document.getElementById('loadingIndicator');
        if (loadingElement) {
            messagesContainer.removeChild(loadingElement);
        }
    }
    
    /**
     * Generate memory display HTML
     * @param {Object} data - Memory data
     * @returns {string} - HTML for memory display
     */
    function generateMemoryDisplay(data) {
        if (!data.results || data.results.length === 0) return '';
        
        let html = `
            <div class="data-summary">
                Found ${data.results.length} memory entries
            </div>
            <div class="memory-items">
        `;
        
        // Display each memory entry
        data.results.forEach(memory => {
            const formattedDate = memory.formattedDate || 
                new Date(memory.date).toLocaleDateString('en-US', {
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric'
                });
            
            html += `
                <div class="memory-item">
                    ${escapeHtml(memory.text)}
                    <span class="memory-time">${formattedDate}</span>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    /**
     * Generate memory update choice display HTML
     * @param {Object} data - Memory update data
     * @returns {string} - HTML for memory update choices
     */
    function generateMemoryUpdateChoiceDisplay(data) {
        if (!data.results || data.results.length === 0) return '';
        
        let html = `
            <div class="data-summary">
                Select a memory to update
            </div>
            <div class="memory-items">
        `;
        
        // Display each memory entry with update button
        data.results.forEach(memory => {
            const formattedDate = memory.formattedDate || 
                new Date(memory.date).toLocaleDateString('en-US', {
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric'
                });
            
            html += `
                <div class="memory-item" data-memory-id="${encodeURIComponent(memory.id)}">
                    ${escapeHtml(memory.text)}
                    <div class="memory-actions">
                        <button class="memory-action-btn memory-update-btn" 
                            data-memory-id="${encodeURIComponent(memory.id)}"
                            data-memory-text="${encodeURIComponent(memory.text)}"
                            data-memory-new-value="${encodeURIComponent(data.newValue || '')}">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <span class="memory-time">${formattedDate}</span>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    /**
     * Generate memory delete choice display HTML
     * @param {Object} data - Memory delete data
     * @returns {string} - HTML for memory delete choices
     */
    function generateMemoryDeleteChoiceDisplay(data) {
        if (!data.results || data.results.length === 0) return '';
        
        let html = `
            <div class="data-summary">
                Select a memory to delete
            </div>
            <div class="memory-items">
        `;
        
        // Display each memory entry with delete button
        data.results.forEach(memory => {
            const formattedDate = memory.formattedDate || 
                new Date(memory.date).toLocaleDateString('en-US', {
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric'
                });
            
            html += `
                <div class="memory-item" data-memory-id="${encodeURIComponent(memory.id)}">
                    ${escapeHtml(memory.text)}
                    <div class="memory-actions">
                        <button class="memory-action-btn memory-delete-btn" 
                            data-memory-id="${encodeURIComponent(memory.id)}"
                            data-memory-text="${encodeURIComponent(memory.text)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                    <span class="memory-time">${formattedDate}</span>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    /**
     * Initialize memory action buttons
     */
    function initMemoryActionButtons() {
        debugLog('info', "Initializing memory action buttons");
        
        // Update buttons
        document.querySelectorAll('.memory-update-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                debugLog('info', "Update button clicked");
                
                try {
                    // Get only the memory ID and text
                    const memoryId = decodeURIComponent(this.getAttribute('data-memory-id') || '');
                    const memoryText = decodeURIComponent(this.getAttribute('data-memory-text') || '');
                    const newValue = decodeURIComponent(this.getAttribute('data-memory-new-value') || '');
                    
                    // Validate data attributes
                    if (!memoryId) {
                        debugLog('error', "Missing memory ID");
                        showToast("Missing memory ID", "error");
                        return;
                    }
                    
                    debugLog('info', `Opening update dialog for memory ID: ${memoryId}`);
                    
                    // Store the memory ID and text in the dialog
                    memoryUpdateId.value = memoryId;
                    memoryUpdateOld.textContent = memoryText;
                    
                    // Use the original memory text, not "unknown"
                    memoryUpdateInput.value = newValue || memoryText;
                    
                    memoryUpdateDialog.style.display = 'flex';
                    memoryUpdateInput.focus();
                } catch (error) {
                    debugLog('error', `Error preparing update dialog: ${error.message}`);
                    showToast("Error preparing update", "error");
                }
            });
        });
        
        // Delete buttons
        document.querySelectorAll('.memory-delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                debugLog('info', "Delete button clicked");
                
                try {
                    // Get only the memory ID and text
                    const memoryId = decodeURIComponent(this.getAttribute('data-memory-id') || '');
                    const memoryText = decodeURIComponent(this.getAttribute('data-memory-text') || '');
                    
                    // Validate data attributes
                    if (!memoryId) {
                        debugLog('error', "Missing memory ID");
                        showToast("Missing memory ID", "error");
                        return;
                    }
                    
                    debugLog('info', `Opening delete dialog for memory ID: ${memoryId}`);
                    
                    // Store the memory ID and text in the dialog
                    memoryDeleteId.value = memoryId;
                    memoryDeleteText.textContent = memoryText;
                    memoryDeleteDialog.style.display = 'flex';
                } catch (error) {
                    debugLog('error', `Error preparing delete dialog: ${error.message}`);
                    showToast("Error preparing delete", "error");
                }
            });
        });
    }
    
    /**
     * Update memory
     * @param {string} memoryId - Memory ID to update
     * @param {string} newValue - New memory text
     */
    function updateMemory(memoryId, newValue) {
        const token = localStorage.getItem('jwt');
        const userId = getCurrentUserId();
        
        debugLog('info', `Updating memory with ID: ${memoryId}`);
        
        // Validate required parameters
        if (!memoryId || !newValue) {
            debugLog('error', "Missing required parameters for memory update");
            showToast("Missing required information", "error");
            return;
        }
        
        // Show loading indicator
        appendLoadingIndicator();
        
        fetch(`${API_URL}/memory/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                memoryId,
                newValue,
                userId
            })
        })
        .then(response => {
            debugLog('info', `Update response status: ${response.status}`);
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            debugLog('info', `Memory update response: ${data.action || 'no action'}`);
            
            // Remove loading indicator
            removeLoadingIndicator();
            
            // Add assistant response to UI
            appendAssistantMessage(data.message, new Date().toISOString(), data);
            
            // Store in conversation history
            const assistantMsg = {
                role: 'assistant',
                content: data.message,
                data: data,
                timestamp: new Date().toISOString(),
                memoryMode: true
            };
            
            // Add to chat in database
            if (currentChatId && currentColumn) {
                fetch(`${API_URL}/api/chats/${currentChatId}/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        message: assistantMsg,
                        column: currentColumn
                    })
                });
                
                // Update chat in local list
                const chatIndex = chats.findIndex(chat => 
                    chat.rowId == currentChatId && chat.column === currentColumn);
                
                if (chatIndex !== -1) {
                    if (!chats[chatIndex].messages) {
                        chats[chatIndex].messages = [];
                    }
                    chats[chatIndex].messages.push(assistantMsg);
                }
                
                // Update storage status
                updateStorageStatus();
            }
            
            // Show success toast
            showToast("Memory updated successfully", "success");
        })
        .catch(error => {
            debugLog('error', `Memory update error: ${error.message}`);
            removeLoadingIndicator();
            appendAssistantMessage('Sorry, I encountered an error while updating the memory. Please try again.', new Date().toISOString());
            showToast("Error updating memory", "error");
        });
    }
    
    /**
     * Delete memory
     * @param {string} memoryId - Memory ID to delete
     */
    function deleteMemory(memoryId) {
        const token = localStorage.getItem('jwt');
        const userId = getCurrentUserId();
        
        debugLog('info', `Deleting memory with ID: ${memoryId}`);
        
        // Validate required parameter
        if (!memoryId) {
            debugLog('error', "Missing memory ID for deletion");
            showToast("Missing memory ID", "error");
            return;
        }
        
        // Show loading indicator
        appendLoadingIndicator();
        
        fetch(`${API_URL}/memory/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                memoryId,
                userId
            })
        })
        .then(response => {
            debugLog('info', `Delete response status: ${response.status}`);
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            debugLog('info', `Memory delete response: ${data.action || 'no action'}`);
            
            // Remove loading indicator
            removeLoadingIndicator();
            
            // Add assistant response to UI
            appendAssistantMessage(data.message, new Date().toISOString(), data);
            
            // Store in conversation history
            const assistantMsg = {
                role: 'assistant',
                content: data.message,
                data: data,
                timestamp: new Date().toISOString(),
                memoryMode: true
            };
            
            // Add to chat in database
            if (currentChatId && currentColumn) {
                fetch(`${API_URL}/api/chats/${currentChatId}/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ 
                        message: assistantMsg,
                        column: currentColumn
                    })
                });
                
                // Update chat in local list
                const chatIndex = chats.findIndex(chat => 
                    chat.rowId == currentChatId && chat.column === currentColumn);
                
                if (chatIndex !== -1) {
                    if (!chats[chatIndex].messages) {
                        chats[chatIndex].messages = [];
                    }
                    chats[chatIndex].messages.push(assistantMsg);
                }
                
                // Update storage status
                updateStorageStatus();
            }
            
            // Show success toast
            showToast("Memory deleted successfully", "success");
        })
        .catch(error => {
            debugLog('error', `Memory delete error: ${error.message}`);
            removeLoadingIndicator();
            appendAssistantMessage('Sorry, I encountered an error while deleting the memory. Please try again.', new Date().toISOString());
            showToast("Error deleting memory", "error");
        });
    }

    /**
     * Generate data display based on result type
     * @param {Object} data - Result data
     * @returns {string} - HTML for data display
     */
    function generateDataDisplay(data) {
        if (!data.results || data.results.length === 0) return '';
        
        let html = '';
        const resultType = data.resultType;
        const results = data.results;
        
        if (resultType === 'memo') {
            html += `
                <div class="data-summary">
                    Found ${results.length} memo(s)
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Memo #</th>
                            <th>Customer</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Items</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            results.forEach(memo => {
                const items = Array.isArray(memo.items) ? memo.items : [];
                const formattedDate = new Date(memo.date).toLocaleDateString();
                
                html += `
                    <tr>
                        <td>${memo.memo_number}</td>
                        <td>${escapeHtml(memo.customer_name)}</td>
                        <td><span class="status-badge status-${memo.status.toLowerCase()}">${memo.status}</span></td>
                        <td>${formattedDate}</td>
                        <td>
                            <div class="items-accordion">
                                <button class="items-toggle">
                                    ${items.length} item(s)
                                    <i class="fas fa-chevron-down"></i>
                                </button>
                                <div class="items-content">
                                    <table class="data-table" style="margin: 0;">
                                        <thead>
                                            <tr>
                                                <th>SKU</th>
                                                <th>Description</th>
                                                <th>Quantity</th>
                                                <th>Carat Weight</th>
                                                <th>Price</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                `;
                
                items.forEach(item => {
                    html += `
                        <tr>
                            <td>${escapeHtml(item.sku || '')}</td>
                            <td>${escapeHtml(item.description || '')}</td>
                            <td>${item.quantity || 1}</td>
                            <td>${item.caratWeight || 0}</td>
                            <td>$${parseFloat(item.price || 0).toFixed(2)}</td>
                        </tr>
                    `;
                });
                
                html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        } else if (resultType === 'invoice') {
            html += `
                <div class="data-summary">
                    Found ${results.length} invoice(s)
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Memo #</th>
                            <th>Customer</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Total</th>
                            <th>Items</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            results.forEach(invoice => {
                const items = Array.isArray(invoice.items) ? invoice.items : [];
                const formattedDate = new Date(invoice.date).toLocaleDateString();
                
                html += `
                    <tr>
                        <td>${invoice.invoice_number}</td>
                        <td>${invoice.memo_number}</td>
                        <td>${escapeHtml(invoice.customer_name || '')}</td>
                        <td><span class="status-badge status-${invoice.status.toLowerCase()}">${invoice.status}</span></td>
                        <td>${formattedDate}</td>
                        <td>$${parseFloat(invoice.total_amount || 0).toFixed(2)}</td>
                        <td>
                            <div class="items-accordion">
                                <button class="items-toggle">
                                    ${items.length} item(s)
                                    <i class="fas fa-chevron-down"></i>
                                </button>
                                <div class="items-content">
                                    <table class="data-table" style="margin: 0;">
                                        <thead>
                                            <tr>
                                                <th>SKU</th>
                                                <th>Description</th>
                                                <th>Quantity</th>
                                                <th>Carat Weight</th>
                                                <th>Price</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                `;
                
                items.forEach(item => {
                    html += `
                        <tr>
                            <td>${escapeHtml(item.sku || '')}</td>
                            <td>${escapeHtml(item.description || '')}</td>
                            <td>${item.quantity || 1}</td>
                            <td>${item.caratWeight || 0}</td>
                            <td>$${parseFloat(item.price || 0).toFixed(2)}</td>
                        </tr>
                    `;
                });
                
                html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        } else if (resultType === 'customer') {
            html += `
                <div class="data-summary">
                    Found ${results.length} customer(s)
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Customer Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Address</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            results.forEach(customer => {
                html += `
                    <tr>
                        <td>${escapeHtml(customer.name)}</td>
                        <td>${escapeHtml(customer.email || '')}</td>
                        <td>${escapeHtml(customer.phone || '')}</td>
                        <td>${escapeHtml(customer.address || '')}</td>
                    </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
            `;
        }
        
        return html;
    }

    /**
     * Initialize accordions for items
     */
    function initAccordions() {
        document.querySelectorAll('.items-toggle').forEach(toggle => {
            toggle.addEventListener('click', function() {
                const content = this.nextElementSibling;
                content.classList.toggle('active');
                
                // Change icon
                const icon = this.querySelector('i');
                if (content.classList.contains('active')) {
                    icon.classList.remove('fa-chevron-down');
                    icon.classList.add('fa-chevron-up');
                } else {
                    icon.classList.remove('fa-chevron-up');
                    icon.classList.add('fa-chevron-down');
                }
            });
        });
    }

    /**
     * Format message with Markdown-like styling
     * @param {string} message - Message to format
     * @returns {string} - Formatted HTML
     */
    function formatMessage(message) {
        // Handle code blocks
        message = message.replace(/```([\s\S]*?)```/g, function(match, code) {
            return `<div class="code-block">${escapeHtml(code)}</div>`;
        });
        
        // Handle inline code
        message = message.replace(/`(.*?)`/g, '<code>$1</code>');
        
        // Handle bold
        message = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Handle italics
        message = message.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Handle lists
        message = message.replace(/^\s*-\s+(.*?)$/gm, '<li>$1</li>');
        message = message.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
        
        // Handle links
        message = message.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        
        // Handle paragraphs
        message = message.split('\n\n').map(p => `<p>${p}</p>`).join('');
        
        return message;
    }

    /**
     * Format timestamp for display
     * @param {string} timestamp - ISO timestamp
     * @returns {string} - Formatted time string
     */
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} unsafe - String to escape
     * @returns {string} - Escaped HTML string
     */
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * Scroll to bottom of messages container
     */
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type ('success' or 'error')
     */
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
            </div>
            <div class="toast-message">${escapeHtml(message)}</div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Force reflow to trigger animation
        void toast.offsetWidth;
        toast.classList.add('show');
        
        // Auto remove after 4 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toastContainer.removeChild(toast);
            }, 300);
        }, 4000);
    }
    
    /**
     * Form validation helpers
     */
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    function showError(element, message) {
        element.textContent = message;
        element.style.display = 'block';
    }
    
    function clearErrors() {
        const errorElements = document.querySelectorAll('.error-message');
        errorElements.forEach(el => {
            el.textContent = '';
            el.style.display = 'none';
        });
    }
    
    function setButtonLoading(button, isLoading) {
        const buttonText = button.querySelector('span');
        
        if (isLoading) {
            button.disabled = true;
            buttonText.innerHTML = '<div class="loading"></div>';
        } else {
            button.disabled = false;
            buttonText.textContent = button === loginButton ? 'Log In' : 'Register';
        }
    }
    
    /**
     * Get current user information
     * @returns {Object} - User information
     */
    function getUser() {
        try {
            return JSON.parse(localStorage.getItem('user') || '{"email":"user@example.com", "id": null}');
        } catch (err) {
            debugLog('error', "Error parsing user data: " + err.message);
            return { email: "user@example.com", id: null };
        }
    }
    
    /**
     * Get current user ID
     * @returns {number|null} - User ID
     */
    function getCurrentUserId() {
        const user = getUser();
        return user.id;
    }
    
    /**
     * Check if in development mode
     * @returns {boolean} - True if in development
     */
    function isDevelopment() {
        return window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1';
    }
    
    /**
     * Login form submission
     */
    loginButton.addEventListener('click', async function(e) {
        e.preventDefault();
        
        // Reset errors
        clearErrors();
        
        // Validate inputs
        let isValid = true;
        const email = loginEmail.value.trim();
        const password = loginPassword.value;
        
        if (!email) {
            showError(loginEmailError, "Email is required");
            isValid = false;
        } else if (!isValidEmail(email)) {
            showError(loginEmailError, "Please enter a valid email address");
            isValid = false;
        }
        
        if (!password) {
            showError(loginPasswordError, "Password is required");
            isValid = false;
        }
        
        if (!isValid) return;
        
        // Show loading state
        setButtonLoading(loginButton, true);
        
        try {
            // Make API request
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (!response.ok || data.error) {
                showError(loginError, data.error || "Login failed. Please check your credentials.");
                return;
            }
            
            if (data.token) {
                // Success - store token and user data
                localStorage.setItem('jwt', data.token);
                
                // Store user info
                if (data.user) {
                    localStorage.setItem('user', JSON.stringify(data.user));
                } else {
                    localStorage.setItem('user', JSON.stringify({ email, id: data.userId || null }));
                }
                
                // Show success toast
                showToast("Login successful", "success");
                
                // Initialize main app
                initializeApp();
            } else {
                showError(loginError, "Login failed. Please try again.");
            }
        } catch (error) {
            console.error("Login error:", error);
            showError(loginError, "An error occurred. Please try again.");
        } finally {
            setButtonLoading(loginButton, false);
        }
    });
    
    /**
     * Register form submission
     */
    registerButton.addEventListener('click', async function(e) {
        e.preventDefault();
        
        // Reset errors
        clearErrors();
        
        // Validate inputs
        let isValid = true;
        const email = registerEmail.value.trim();
        const password = registerPassword.value;
        const confirmPwd = confirmPassword.value;
        
        if (!email) {
            showError(registerEmailError, "Email is required");
            isValid = false;
        } else if (!isValidEmail(email)) {
            showError(registerEmailError, "Please enter a valid email address");
            isValid = false;
        }
        
        if (!password) {
            showError(registerPasswordError, "Password is required");
            isValid = false;
        } else if (password.length < 6) {
            showError(registerPasswordError, "Password must be at least 6 characters");
            isValid = false;
        }
        
        if (!confirmPwd) {
            showError(confirmPasswordError, "Please confirm your password");
            isValid = false;
        } else if (confirmPwd !== password) {
            showError(confirmPasswordError, "Passwords do not match");
            isValid = false;
        }
        
        if (!isValid) return;
        
        // Show loading state
        setButtonLoading(registerButton, true);
        
        try {
            // Make API request
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (!response.ok || data.error) {
                showError(registerError, data.error || "Registration failed. Please try again.");
                return;
            }
            
            if (data.success) {
                // Registration successful - show login form with success message
                registerForm.style.display = 'none';
                loginForm.style.display = 'block';
                
                // Pre-fill email
                loginEmail.value = email;
                
                // Show success toast
                showToast("Registration successful! Please log in.", "success");
            } else {
                showError(registerError, "Registration failed. Please try again.");
            }
        } catch (error) {
            console.error("Registration error:", error);
            showError(registerError, "An error occurred. Please try again.");
        } finally {
            setButtonLoading(registerButton, false);
        }
    });
    
    /**
     * Debug panel functions
     */
    function initializeDebugPanel() {
        debugToggle.addEventListener('click', function() {
            debugPanel.classList.toggle('visible');
        });
    }
    
    function debugLog(level, message) {
        const now = new Date();
        const timestamp = now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');
        
        const entry = document.createElement('div');
        entry.className = 'debug-entry';
        entry.innerHTML = `
            <span class="timestamp">${timestamp}</span>
            <span class="tag ${level}">${level.toUpperCase()}</span>
            <span class="message">${escapeHtml(message)}</span>
        `;
        
        debugPanel.appendChild(entry);
        debugPanel.scrollTop = debugPanel.scrollHeight;
        
        // Keep debug panel size manageable
        while (debugPanel.children.length > 100) {
            debugPanel.removeChild(debugPanel.firstChild);
        }
        
        // Log to console as well
        console.log(`[${level.toUpperCase()}] ${message}`);
    }
});
