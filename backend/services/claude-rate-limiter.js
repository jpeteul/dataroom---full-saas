
class ClaudeRateLimiter {
  constructor(maxTokensPerMinute = 20000) {
    this.maxTokensPerMinute = maxTokensPerMinute;
    this.tokenUsageWindow = []; // Array to track token usage with timestamps
    this.requestQueue = []; // Queue for pending requests
    this.isProcessingQueue = false;
    
    console.log(`🤖 Claude Rate Limiter initialized with ${maxTokensPerMinute} tokens/minute limit`);
  }

  // Estimate tokens in a text (rough approximation: ~4 characters = 1 token)
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  // Calculate current token usage in the last minute
  getCurrentUsage() {
    const oneMinuteAgo = Date.now() - 60000;
    
    // Remove entries older than 1 minute
    this.tokenUsageWindow = this.tokenUsageWindow.filter(
      entry => entry.timestamp > oneMinuteAgo
    );
    
    // Sum up tokens used in the last minute
    return this.tokenUsageWindow.reduce((sum, entry) => sum + entry.tokens, 0);
  }

  // Add token usage to the tracking window
  addUsage(tokens) {
    this.tokenUsageWindow.push({
      timestamp: Date.now(),
      tokens: tokens
    });
  }

  // Check if we can make a request with estimated tokens
  canMakeRequest(estimatedTokens) {
    const currentUsage = this.getCurrentUsage();
    return (currentUsage + estimatedTokens) <= this.maxTokensPerMinute;
  }

  // Calculate how long to wait before the next request
  getWaitTime(estimatedTokens) {
    const currentUsage = this.getCurrentUsage();
    
    if ((currentUsage + estimatedTokens) <= this.maxTokensPerMinute) {
      return 0; // No wait needed
    }

    // Find the oldest entry that, when removed, would allow the request
    const targetUsage = this.maxTokensPerMinute - estimatedTokens;
    let tokensToRemove = currentUsage - targetUsage;
    
    if (tokensToRemove <= 0) {
      return 0; // Should be able to proceed
    }
    
    // Sort by timestamp to find when enough tokens will "expire"
    const sortedEntries = [...this.tokenUsageWindow].sort((a, b) => a.timestamp - b.timestamp);
    
    let removedTokens = 0;
    let waitUntil = Date.now() + 5000; // Default 5 second wait as fallback
    
    for (const entry of sortedEntries) {
      removedTokens += entry.tokens;
      waitUntil = entry.timestamp + 60000; // 1 minute after this entry
      
      if (removedTokens >= tokensToRemove) {
        break;
      }
    }
    
    const waitTime = Math.max(1000, waitUntil - Date.now()); // Minimum 1 second wait
    return waitTime;
  }

  // Process the request queue
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0) {
        const request = this.requestQueue[0];
        const estimatedTokens = request.estimatedTokens;

        if (this.canMakeRequest(estimatedTokens)) {
          // Remove from queue and process
          this.requestQueue.shift();
          
          try {
            console.log(`🤖 Processing Claude API request (estimated: ${estimatedTokens} tokens, queue: ${this.requestQueue.length} remaining)`);
            const startTime = Date.now();
            const result = await request.apiCall();
            const duration = Date.now() - startTime;
            
            // Track actual usage (estimate response tokens too)
            const responseTokens = this.estimateTokens(result);
            const totalTokens = estimatedTokens + responseTokens;
            this.addUsage(totalTokens);
            
            console.log(`✅ Claude API request completed in ${duration}ms (used ~${totalTokens} tokens, current usage: ${this.getCurrentUsage()}/${this.maxTokensPerMinute})`);
            
            request.resolve(result);
          } catch (error) {
            console.error(`❌ Claude API request failed:`, error);
            request.reject(error);
          }
        } else {
          // Wait before processing more requests
          const waitTime = this.getWaitTime(estimatedTokens);
          console.log(`⏱️ Rate limit reached. Waiting ${Math.round(waitTime/1000)}s before next Claude API call (usage: ${this.getCurrentUsage()}/${this.maxTokensPerMinute})`);
          
          // CRITICAL FIX: Always wait at least 1 second to prevent infinite loops
          const actualWaitTime = Math.max(1000, waitTime);
          await new Promise(resolve => setTimeout(resolve, actualWaitTime));
          
          // After waiting, continue the loop to check again
          continue;
        }
      }
    } catch (error) {
      console.error('❌ Error in processQueue:', error);
    } finally {
      this.isProcessingQueue = false;
      
      // If there are still items in the queue, restart processing after a delay
      if (this.requestQueue.length > 0) {
        setTimeout(() => this.processQueue(), 2000);
      }
    }
  }

  // Queue a Claude API request
  async queueRequest(apiCall, prompt, documentContent = null) {
    return new Promise((resolve, reject) => {
      // Estimate tokens for the request
      let estimatedTokens = this.estimateTokens(prompt);
      
      if (documentContent) {
        // Add estimated tokens for document content (base64 is larger, so factor that in)
        const contentTokens = this.estimateTokens(documentContent);
        estimatedTokens += Math.ceil(contentTokens * 0.75); // base64 is ~33% larger than original
      }
      
      // Add buffer for system messages and response (Claude tends to give detailed responses)
      estimatedTokens = Math.ceil(estimatedTokens * 1.3);
      
      // Cap the estimation to prevent issues with very large documents
      estimatedTokens = Math.min(estimatedTokens, 15000); // Max ~15k tokens per request

      const request = {
        apiCall,
        estimatedTokens,
        resolve,
        reject,
        queuedAt: Date.now()
      };

      this.requestQueue.push(request);
      console.log(`📋 Queued Claude API request (${estimatedTokens} tokens estimated). Queue length: ${this.requestQueue.length}`);
      
      // Start processing the queue if not already processing
      if (!this.isProcessingQueue) {
        // Small delay to allow multiple requests to queue up
        setTimeout(() => this.processQueue(), 100);
      }
    });
  }

  // Get current status
  getStatus() {
    const current = this.getCurrentUsage();
    return {
      currentUsage: current,
      maxTokens: this.maxTokensPerMinute,
      queueLength: this.requestQueue.length,
      utilizationPercent: Math.round((current / this.maxTokensPerMinute) * 100),
      remainingTokens: this.maxTokensPerMinute - current,
      windowEntries: this.tokenUsageWindow.length,
      isProcessing: this.isProcessingQueue
    };
  }

  // Reset the rate limiter (useful for testing)
  reset() {
    this.tokenUsageWindow = [];
    this.requestQueue = [];
    this.isProcessingQueue = false;
    console.log('🔄 Claude Rate Limiter reset');
  }
}

// Enhanced Claude API functions with rate limiting
const createClaudeApiWithRateLimit = (rateLimiter, apiKey) => {
  const callClaudeWithDocument = async (prompt, base64Content, mimeType) => {
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY environment variable not set');
    }

    // Create the API call function
    const apiCall = async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [{
              type: 'text',
              text: prompt
            }, {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Content
              }
            }]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Check for rate limit errors specifically
        if (response.status === 429) {
          throw new Error(`Claude API rate limit exceeded: ${errorText}`);
        }
        
        throw new Error(`Claude API error: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.content[0].text;
    };

    // Queue the request with rate limiting
    return rateLimiter.queueRequest(apiCall, prompt, base64Content);
  };

  const callClaude = async (prompt) => {
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY environment variable not set');
    }

    // Create the API call function
    const apiCall = async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Check for rate limit errors specifically
        if (response.status === 429) {
          throw new Error(`Claude API rate limit exceeded: ${errorText}`);
        }
        
        throw new Error(`Claude API error: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      return data.content[0].text;
    };

    // Queue the request with rate limiting
    return rateLimiter.queueRequest(apiCall, prompt);
  };

  return {
    callClaude,
    callClaudeWithDocument
  };
};

module.exports = {
  ClaudeRateLimiter,
  createClaudeApiWithRateLimit
};
