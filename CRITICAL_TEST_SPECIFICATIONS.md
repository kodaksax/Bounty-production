# Critical Test Specifications - BOUNTYExpo

This document provides detailed test specifications for the most critical missing tests identified in the Test Coverage Analysis.

---

## 1. Completion Service Tests (`lib/services/completion-service.ts`)

### Priority: ⚠️ CRITICAL
### Estimated Effort: 24 hours
### Dependencies: Supabase, Storage Service, Notification Service

### Test File Location:
```
__tests__/unit/services/completion-service.test.ts
__tests__/integration/completion-flow.test.ts
```

### Unit Tests Required:

#### 1.1 `submitCompletion()`
```typescript
describe('submitCompletion', () => {
  it('should create new completion submission with proof items', async () => {
    const submission = {
      bounty_id: 'bounty-123',
      hunter_id: 'hunter-456',
      message: 'Work completed as requested',
      proof_items: [
        { id: '1', type: 'image', name: 'screenshot.png', url: 'https://...' }
      ]
    };
    
    const result = await completionService.submitCompletion(submission);
    
    expect(result).toBeDefined();
    expect(result.status).toBe('pending');
    expect(result.bounty_id).toBe('bounty-123');
  });

  it('should prevent duplicate pending submissions', async () => {
    // Submit once
    await completionService.submitCompletion({ ... });
    
    // Try to submit again (should return existing)
    const result = await completionService.submitCompletion({ ... });
    
    expect(result.id).toBe(existingSubmission.id);
    expect(supabase.from).not.toHaveBeenCalledWith('insert');
  });

  it('should validate proof items before submission', async () => {
    const invalidSubmission = {
      proof_items: [] // Empty proof items
    };
    
    await expect(
      completionService.submitCompletion(invalidSubmission)
    ).rejects.toThrow('At least one proof item required');
  });

  it('should handle Supabase errors gracefully', async () => {
    mockSupabase.from().insert.mockRejectedValue(new Error('Database error'));
    
    const result = await completionService.submitCompletion({ ... });
    
    expect(result).toBeNull();
    // Verify error logged
  });
});
```

#### 1.2 `approveCompletion()`
```typescript
describe('approveCompletion', () => {
  it('should approve completion and trigger payment release', async () => {
    const submissionId = 'sub-123';
    const posterId = 'poster-456';
    
    const result = await completionService.approveCompletion(
      submissionId,
      posterId,
      'Great work!'
    );
    
    expect(result.status).toBe('approved');
    expect(mockPaymentService.releaseEscrow).toHaveBeenCalledWith('bounty-123');
  });

  it('should update bounty status to completed', async () => {
    await completionService.approveCompletion('sub-123', 'poster-456');
    
    expect(mockBountyService.update).toHaveBeenCalledWith('bounty-123', {
      status: 'completed'
    });
  });

  it('should send notification to hunter', async () => {
    await completionService.approveCompletion('sub-123', 'poster-456');
    
    expect(mockNotificationService.send).toHaveBeenCalledWith({
      user_id: 'hunter-789',
      type: 'completion_approved',
      title: 'Your work was approved!',
      body: expect.any(String)
    });
  });

  it('should prevent non-poster from approving', async () => {
    await expect(
      completionService.approveCompletion('sub-123', 'not-poster')
    ).rejects.toThrow('Only the bounty poster can approve');
  });
});
```

#### 1.3 `rejectCompletion()`
```typescript
describe('rejectCompletion', () => {
  it('should reject completion with reason', async () => {
    const result = await completionService.rejectCompletion(
      'sub-123',
      'poster-456',
      'Does not meet requirements'
    );
    
    expect(result.status).toBe('rejected');
    expect(result.poster_feedback).toBe('Does not meet requirements');
  });

  it('should refund escrow on rejection', async () => {
    await completionService.rejectCompletion('sub-123', 'poster-456', 'reason');
    
    expect(mockPaymentService.refundEscrow).toHaveBeenCalledWith('bounty-123');
  });

  it('should update bounty to allow new applications', async () => {
    await completionService.rejectCompletion('sub-123', 'poster-456', 'reason');
    
    expect(mockBountyService.update).toHaveBeenCalledWith('bounty-123', {
      status: 'open'
    });
  });
});
```

#### 1.4 `requestRevision()`
```typescript
describe('requestRevision', () => {
  it('should request revision with specific feedback', async () => {
    const result = await completionService.requestRevision(
      'sub-123',
      'poster-456',
      'Please add more detail to section 3'
    );
    
    expect(result.status).toBe('revision_requested');
    expect(result.revision_count).toBe(1);
  });

  it('should limit number of revision requests', async () => {
    // Mock 3 previous revisions
    mockSupabase.from().select.mockResolvedValue({
      data: { revision_count: 3 }
    });
    
    await expect(
      completionService.requestRevision('sub-123', 'poster-456', 'reason')
    ).rejects.toThrow('Maximum revisions exceeded');
  });

  it('should notify hunter of revision request', async () => {
    await completionService.requestRevision('sub-123', 'poster-456', 'feedback');
    
    expect(mockNotificationService.send).toHaveBeenCalledWith({
      type: 'revision_requested',
      user_id: 'hunter-789'
    });
  });
});
```

### Integration Tests Required:

#### 1.5 Complete Revision Workflow
```typescript
describe('Completion Revision Workflow', () => {
  it('should handle complete revision cycle', async () => {
    // 1. Hunter submits completion
    const submission = await completionService.submitCompletion({
      bounty_id: testBounty.id,
      hunter_id: testHunter.id,
      message: 'Initial submission',
      proof_items: [mockProof1]
    });

    // 2. Poster requests revision
    const revised = await completionService.requestRevision(
      submission.id,
      testPoster.id,
      'Please add proof of testing'
    );

    expect(revised.status).toBe('revision_requested');

    // 3. Hunter resubmits with changes
    const resubmission = await completionService.submitCompletion({
      bounty_id: testBounty.id,
      hunter_id: testHunter.id,
      message: 'Added testing proof',
      proof_items: [mockProof1, mockProof2]
    });

    // 4. Poster approves
    const approved = await completionService.approveCompletion(
      resubmission.id,
      testPoster.id,
      'Looks great!'
    );

    expect(approved.status).toBe('approved');

    // 5. Verify payment released
    const wallet = await mockWalletService.getBalance(testHunter.id);
    expect(wallet.balance).toBeGreaterThan(initialBalance);
  });
});
```

---

## 2. Supabase Messaging Tests (`lib/services/supabase-messaging.ts`)

### Priority: ⚠️ CRITICAL
### Estimated Effort: 48 hours
### Dependencies: Supabase Realtime, AsyncStorage, Notification Service

### Test File Location:
```
__tests__/unit/services/supabase-messaging.test.ts
__tests__/integration/realtime-messaging.test.ts
__tests__/e2e/messaging-flow.test.ts
```

### Unit Tests Required:

#### 2.1 Message Caching
```typescript
describe('Message Caching', () => {
  beforeEach(() => {
    AsyncStorage.clear();
  });

  it('should cache conversations locally', async () => {
    const conversations = [
      { id: 'conv-1', last_message: 'Hello' },
      { id: 'conv-2', last_message: 'Hi there' }
    ];

    await messagingService.cacheConversations(conversations);

    const cached = await AsyncStorage.getItem('@bountyexpo:conversations_cache');
    expect(JSON.parse(cached)).toEqual(conversations);
  });

  it('should load cached conversations on boot', async () => {
    // Pre-populate cache
    await AsyncStorage.setItem(
      '@bountyexpo:conversations_cache',
      JSON.stringify([{ id: 'conv-1' }])
    );

    const loaded = await messagingService.loadCachedConversations();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('conv-1');
  });

  it('should cache messages per conversation', async () => {
    const messages = [
      { id: 'msg-1', content: 'Hello', conversation_id: 'conv-1' },
      { id: 'msg-2', content: 'Hi', conversation_id: 'conv-1' }
    ];

    await messagingService.cacheMessages('conv-1', messages);

    const cached = await messagingService.loadCachedMessages('conv-1');
    expect(cached).toEqual(messages);
  });

  it('should handle cache corruption gracefully', async () => {
    await AsyncStorage.setItem(
      '@bountyexpo:conversations_cache',
      'invalid json'
    );

    const loaded = await messagingService.loadCachedConversations();

    expect(loaded).toEqual([]);
  });
});
```

#### 2.2 Real-time Subscriptions
```typescript
describe('Real-time Subscriptions', () => {
  it('should subscribe to conversation updates', async () => {
    const conversationId = 'conv-123';
    const callback = jest.fn();

    await messagingService.subscribeToConversation(conversationId, callback);

    expect(mockSupabase.channel).toHaveBeenCalledWith(`conversation:${conversationId}`);
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'messages' }),
      expect.any(Function)
    );
  });

  it('should emit events on new messages', async () => {
    const listener = jest.fn();
    messagingService.on('new_message', listener);

    await messagingService.subscribeToConversation('conv-123', jest.fn());

    // Simulate Supabase real-time event
    const mockMessage = { id: 'msg-1', content: 'Test' };
    mockChannel.on.mock.calls[0][2]({ new: mockMessage });

    expect(listener).toHaveBeenCalledWith(mockMessage);
  });

  it('should handle subscription errors', async () => {
    mockChannel.subscribe.mockRejectedValue(new Error('Connection failed'));

    await expect(
      messagingService.subscribeToConversation('conv-123', jest.fn())
    ).rejects.toThrow('Connection failed');
  });

  it('should cleanup subscriptions on unsubscribe', async () => {
    await messagingService.subscribeToConversation('conv-123', jest.fn());
    await messagingService.unsubscribeFromConversation('conv-123');

    expect(mockChannel.unsubscribe).toHaveBeenCalled();
    expect(subscriptions.has('conv-123')).toBe(false);
  });

  it('should prevent duplicate subscriptions', async () => {
    await messagingService.subscribeToConversation('conv-123', jest.fn());
    await messagingService.subscribeToConversation('conv-123', jest.fn());

    expect(mockSupabase.channel).toHaveBeenCalledTimes(1);
  });
});
```

#### 2.3 Message Operations
```typescript
describe('sendMessage', () => {
  it('should send message and update cache', async () => {
    const message = {
      conversation_id: 'conv-123',
      content: 'Hello world',
      sender_id: 'user-456'
    };

    const result = await messagingService.sendMessage(message);

    expect(result).toBeDefined();
    expect(result.content).toBe('Hello world');
    expect(mockSupabase.from).toHaveBeenCalledWith('messages');
  });

  it('should handle offline queueing', async () => {
    mockNetInfo.fetch.mockResolvedValue({ isConnected: false });

    const message = { conversation_id: 'conv-123', content: 'Offline message' };
    await messagingService.sendMessage(message);

    // Should queue message locally
    const queue = await messagingService.getMessageQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].content).toBe('Offline message');
  });

  it('should include sender profile info', async () => {
    mockSupabase.from().select.mockResolvedValue({
      data: { username: 'testuser', avatar: 'avatar.jpg' }
    });

    const result = await messagingService.sendMessage({
      conversation_id: 'conv-123',
      content: 'Test',
      sender_id: 'user-456'
    });

    expect(result.sender_username).toBe('testuser');
    expect(result.sender_avatar).toBe('avatar.jpg');
  });
});

describe('getMessages', () => {
  it('should return messages with pagination', async () => {
    const messages = await messagingService.getMessages('conv-123', {
      limit: 50,
      before: 'msg-100'
    });

    expect(messages).toHaveLength(50);
    expect(mockSupabase.from).toHaveBeenCalledWith('messages');
    expect(mockQuery.lt).toHaveBeenCalledWith('created_at', expect.any(String));
  });

  it('should load from cache if offline', async () => {
    mockNetInfo.fetch.mockResolvedValue({ isConnected: false });
    await messagingService.cacheMessages('conv-123', [
      { id: 'msg-1', content: 'Cached' }
    ]);

    const messages = await messagingService.getMessages('conv-123');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Cached');
  });

  it('should merge cached and fetched messages', async () => {
    // Cache has older messages
    await messagingService.cacheMessages('conv-123', [
      { id: 'msg-1', created_at: '2024-01-01', content: 'Old' }
    ]);

    // Server has newer messages
    mockSupabase.from().select.mockResolvedValue({
      data: [{ id: 'msg-2', created_at: '2024-01-02', content: 'New' }]
    });

    const messages = await messagingService.getMessages('conv-123');

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg-2'); // Newest first
  });
});
```

#### 2.4 Conversation Management
```typescript
describe('createConversation', () => {
  it('should create 1:1 conversation', async () => {
    const result = await messagingService.createConversation({
      participant_ids: ['user-1', 'user-2'],
      context: { bounty_id: 'bounty-123' }
    });

    expect(result).toBeDefined();
    expect(result.participants).toHaveLength(2);
  });

  it('should prevent duplicate conversations', async () => {
    // Mock existing conversation
    mockSupabase.from().select.mockResolvedValue({
      data: [{ id: 'existing-conv' }]
    });

    const result = await messagingService.createConversation({
      participant_ids: ['user-1', 'user-2']
    });

    expect(result.id).toBe('existing-conv');
    expect(mockSupabase.from().insert).not.toHaveBeenCalled();
  });

  it('should support group conversations', async () => {
    const result = await messagingService.createConversation({
      participant_ids: ['user-1', 'user-2', 'user-3'],
      name: 'Project Discussion'
    });

    expect(result.participants).toHaveLength(3);
    expect(result.name).toBe('Project Discussion');
  });
});

describe('deleteConversation', () => {
  it('should soft delete conversation for user', async () => {
    await messagingService.deleteConversation('conv-123', 'user-456');

    expect(mockSupabase.from).toHaveBeenCalledWith('conversation_participants');
    expect(mockQuery.update).toHaveBeenCalledWith({
      deleted_at: expect.any(String)
    });
  });

  it('should only delete for requesting user', async () => {
    await messagingService.deleteConversation('conv-123', 'user-456');

    // Other participant should still see conversation
    const conversations = await messagingService.getConversations('other-user');
    expect(conversations.find(c => c.id === 'conv-123')).toBeDefined();
  });
});
```

#### 2.5 Read Receipts & Typing Indicators
```typescript
describe('markAsRead', () => {
  it('should mark messages as read', async () => {
    await messagingService.markAsRead('conv-123', 'user-456');

    expect(mockSupabase.from).toHaveBeenCalledWith('messages');
    expect(mockQuery.update).toHaveBeenCalledWith({ read_at: expect.any(String) });
  });

  it('should emit read receipt event', async () => {
    const listener = jest.fn();
    messagingService.on('messages_read', listener);

    await messagingService.markAsRead('conv-123', 'user-456');

    expect(listener).toHaveBeenCalledWith({
      conversation_id: 'conv-123',
      user_id: 'user-456'
    });
  });

  it('should update unread count', async () => {
    await messagingService.markAsRead('conv-123', 'user-456');

    const unreadCount = await messagingService.getUnreadCount('user-456');
    expect(unreadCount).toBe(0);
  });
});

describe('setTyping', () => {
  it('should broadcast typing status', async () => {
    await messagingService.setTyping('conv-123', 'user-456', true);

    expect(mockChannel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: 'user-456', is_typing: true }
    });
  });

  it('should debounce typing status', async () => {
    await messagingService.setTyping('conv-123', 'user-456', true);
    await messagingService.setTyping('conv-123', 'user-456', true);
    await messagingService.setTyping('conv-123', 'user-456', true);

    // Should only send once due to debounce
    expect(mockChannel.send).toHaveBeenCalledTimes(1);
  });
});
```

### Integration Tests Required:

#### 2.6 Complete Messaging Flow
```typescript
describe('Complete Messaging Flow', () => {
  it('should handle full conversation lifecycle', async () => {
    // 1. Create conversation
    const conversation = await messagingService.createConversation({
      participant_ids: [poster.id, hunter.id],
      context: { bounty_id: testBounty.id }
    });

    // 2. Subscribe to real-time updates
    const messageListener = jest.fn();
    await messagingService.subscribeToConversation(
      conversation.id,
      messageListener
    );

    // 3. Send first message
    const msg1 = await messagingService.sendMessage({
      conversation_id: conversation.id,
      sender_id: poster.id,
      content: 'Hi, I have a question about the bounty'
    });

    // 4. Verify recipient receives notification
    expect(mockNotificationService.send).toHaveBeenCalledWith({
      user_id: hunter.id,
      type: 'new_message'
    });

    // 5. Reply
    const msg2 = await messagingService.sendMessage({
      conversation_id: conversation.id,
      sender_id: hunter.id,
      content: 'Sure, how can I help?'
    });

    // 6. Mark as read
    await messagingService.markAsRead(conversation.id, poster.id);

    // 7. Verify messages cached
    const cached = await messagingService.loadCachedMessages(conversation.id);
    expect(cached).toHaveLength(2);

    // 8. Soft delete for one user
    await messagingService.deleteConversation(conversation.id, poster.id);

    // 9. Verify other user still sees it
    const hunterConvs = await messagingService.getConversations(hunter.id);
    expect(hunterConvs.find(c => c.id === conversation.id)).toBeDefined();
  });
});
```

#### 2.7 Offline → Online Sync
```typescript
describe('Offline Message Synchronization', () => {
  it('should queue messages offline and sync when online', async () => {
    // 1. Go offline
    mockNetInfo.fetch.mockResolvedValue({ isConnected: false });

    // 2. Send 3 messages (should queue)
    await messagingService.sendMessage({ content: 'Message 1', ... });
    await messagingService.sendMessage({ content: 'Message 2', ... });
    await messagingService.sendMessage({ content: 'Message 3', ... });

    // Verify queued locally
    const queue = await messagingService.getMessageQueue();
    expect(queue).toHaveLength(3);

    // 3. Come back online
    mockNetInfo.fetch.mockResolvedValue({ isConnected: true });
    await messagingService.syncOfflineMessages();

    // 4. Verify all messages sent
    expect(mockSupabase.from).toHaveBeenCalledTimes(3);

    // 5. Verify queue cleared
    const finalQueue = await messagingService.getMessageQueue();
    expect(finalQueue).toHaveLength(0);
  });

  it('should handle partial sync failures', async () => {
    // Queue 3 messages
    await queueMessages(['msg1', 'msg2', 'msg3']);

    // Mock: first 2 succeed, third fails
    mockSupabase.from().insert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new Error('Network error'));

    await messagingService.syncOfflineMessages();

    // Verify only failed message remains in queue
    const queue = await messagingService.getMessageQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].content).toBe('msg3');
  });
});
```

---

## 3. Payment Escrow Integration Tests

### Priority: ⚠️ CRITICAL
### Estimated Effort: 40 hours

### Test File Location:
```
__tests__/integration/payment-escrow-flow.test.ts
__tests__/e2e/complete-payment-lifecycle.test.ts
```

### Integration Tests Required:

#### 3.1 Escrow Creation Flow
```typescript
describe('Payment Escrow Creation', () => {
  it('should create escrow on bounty acceptance', async () => {
    // 1. Create bounty with $100 reward
    const bounty = await bountyService.create({
      title: 'Test Bounty',
      amount: 100,
      poster_id: poster.id
    });

    // 2. Hunter applies
    const application = await requestService.create({
      bounty_id: bounty.id,
      hunter_id: hunter.id,
      message: 'I can do this'
    });

    // 3. Poster accepts (should trigger escrow)
    const accepted = await requestService.accept(
      application.id,
      poster.id
    );

    // 4. Verify escrow created in Stripe
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
      amount: 10000, // $100 in cents
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        bounty_id: bounty.id,
        hunter_id: hunter.id,
        type: 'escrow'
      }
    });

    // 5. Verify escrow record in database
    const escrow = await db.query(
      'SELECT * FROM escrow WHERE bounty_id = $1',
      [bounty.id]
    );
    expect(escrow.rows[0].status).toBe('held');
    expect(escrow.rows[0].amount).toBe(10000);
  });

  it('should handle payment method failure during escrow', async () => {
    mockStripe.paymentIntents.create.mockRejectedValue({
      type: 'card_error',
      code: 'card_declined'
    });

    await expect(
      requestService.accept(application.id, poster.id)
    ).rejects.toThrow('Payment failed');

    // Verify bounty remains in 'open' status
    const bounty = await bountyService.getById(bounty.id);
    expect(bounty.status).toBe('open');
  });
});
```

#### 3.2 Escrow Release Flow
```typescript
describe('Payment Escrow Release', () => {
  it('should release escrow on bounty completion approval', async () => {
    // 1. Setup: bounty accepted, escrow created
    const bounty = await setupAcceptedBounty();
    const escrow = await setupEscrow(bounty.id, 10000);

    // 2. Hunter submits completion
    const completion = await completionService.submitCompletion({
      bounty_id: bounty.id,
      hunter_id: hunter.id,
      message: 'Work done',
      proof_items: [{ ... }]
    });

    // 3. Poster approves
    await completionService.approveCompletion(
      completion.id,
      poster.id
    );

    // 4. Verify Stripe payment intent captured
    expect(mockStripe.paymentIntents.capture).toHaveBeenCalledWith(
      escrow.payment_intent_id
    );

    // 5. Verify transfer to hunter's Stripe Connect account
    expect(mockStripe.transfers.create).toHaveBeenCalledWith({
      amount: 9500, // $95 after 5% platform fee
      currency: 'usd',
      destination: hunter.stripe_account_id,
      transfer_group: bounty.id
    });

    // 6. Verify escrow status updated
    const updatedEscrow = await getEscrow(escrow.id);
    expect(updatedEscrow.status).toBe('released');
    expect(updatedEscrow.released_at).toBeDefined();

    // 7. Verify transaction recorded
    const transaction = await getTransaction(hunter.id, bounty.id);
    expect(transaction.amount).toBe(9500);
    expect(transaction.type).toBe('bounty_payment');
    expect(transaction.fee).toBe(500);
  });

  it('should handle release failure and retry', async () => {
    // First attempt fails
    mockStripe.paymentIntents.capture.mockRejectedValueOnce(
      new Error('Network timeout')
    );

    // Second attempt succeeds
    mockStripe.paymentIntents.capture.mockResolvedValueOnce({
      status: 'succeeded'
    });

    await completionService.approveCompletion(completion.id, poster.id);

    // Should retry automatically
    expect(mockStripe.paymentIntents.capture).toHaveBeenCalledTimes(2);

    // Verify final status
    const escrow = await getEscrow(escrow.id);
    expect(escrow.status).toBe('released');
  });
});
```

#### 3.3 Escrow Refund Flow
```typescript
describe('Payment Escrow Refund', () => {
  it('should refund escrow on bounty cancellation', async () => {
    // 1. Setup: bounty accepted with escrow
    const bounty = await setupAcceptedBounty();
    const escrow = await setupEscrow(bounty.id, 10000);

    // 2. Poster cancels bounty
    await bountyService.cancel(bounty.id, poster.id, 'Changed my mind');

    // 3. Verify Stripe payment intent canceled
    expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(
      escrow.payment_intent_id
    );

    // 4. Verify escrow refunded
    const updatedEscrow = await getEscrow(escrow.id);
    expect(updatedEscrow.status).toBe('refunded');

    // 5. Verify poster notified
    expect(mockNotificationService.send).toHaveBeenCalledWith({
      user_id: poster.id,
      type: 'escrow_refunded',
      body: expect.stringContaining('$100')
    });
  });

  it('should refund escrow on completion rejection', async () => {
    const completion = await setupCompletionSubmission();

    await completionService.rejectCompletion(
      completion.id,
      poster.id,
      'Does not meet requirements'
    );

    expect(mockStripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: escrow.payment_intent_id,
      reason: 'requested_by_customer'
    });
  });
});
```

---

## 4. Transaction Service Tests

### Priority: 🔴 HIGH
### Estimated Effort: 36 hours

### Test File Location:
```
__tests__/unit/services/transaction-service.test.ts
__tests__/integration/wallet-transactions.test.ts
```

### Unit Tests Required:

#### 4.1 Transaction Creation
```typescript
describe('createTransaction', () => {
  it('should create deposit transaction', async () => {
    const transaction = await transactionService.create({
      user_id: user.id,
      type: 'deposit',
      amount: 5000, // $50
      currency: 'usd',
      source: 'stripe',
      metadata: { payment_intent_id: 'pi_123' }
    });

    expect(transaction).toBeDefined();
    expect(transaction.type).toBe('deposit');
    expect(transaction.amount).toBe(5000);
    expect(transaction.status).toBe('completed');
  });

  it('should create bounty payment transaction with fee', async () => {
    const transaction = await transactionService.create({
      user_id: hunter.id,
      type: 'bounty_payment',
      amount: 10000,
      fee: 500, // 5% platform fee
      metadata: { bounty_id: 'bounty-123' }
    });

    expect(transaction.amount).toBe(10000);
    expect(transaction.fee).toBe(500);
    expect(transaction.net_amount).toBe(9500);
  });

  it('should validate transaction amount', async () => {
    await expect(
      transactionService.create({
        user_id: user.id,
        type: 'deposit',
        amount: -100 // Negative amount
      })
    ).rejects.toThrow('Amount must be positive');
  });

  it('should prevent duplicate transactions with idempotency key', async () => {
    const key = 'txn-unique-key';

    await transactionService.create({
      user_id: user.id,
      type: 'deposit',
      amount: 5000,
      idempotency_key: key
    });

    // Try again with same key
    const duplicate = await transactionService.create({
      user_id: user.id,
      type: 'deposit',
      amount: 5000,
      idempotency_key: key
    });

    expect(duplicate.id).toBe(originalTransaction.id);
  });
});
```

#### 4.2 Balance Calculations
```typescript
describe('getBalance', () => {
  it('should calculate correct balance from transactions', async () => {
    // Create test transactions
    await createTransaction({ type: 'deposit', amount: 10000 });
    await createTransaction({ type: 'bounty_payment', amount: -3000 });
    await createTransaction({ type: 'deposit', amount: 5000 });
    await createTransaction({ type: 'withdrawal', amount: -2000 });

    const balance = await transactionService.getBalance(user.id);

    expect(balance).toBe(10000); // 10000 - 3000 + 5000 - 2000
  });

  it('should include pending transactions in pending balance', async () => {
    await createTransaction({ type: 'deposit', amount: 5000, status: 'completed' });
    await createTransaction({ type: 'deposit', amount: 3000, status: 'pending' });

    const balances = await transactionService.getBalances(user.id);

    expect(balances.available).toBe(5000);
    expect(balances.pending).toBe(3000);
    expect(balances.total).toBe(8000);
  });

  it('should handle multiple currencies', async () => {
    await createTransaction({ amount: 10000, currency: 'usd' });
    await createTransaction({ amount: 8000, currency: 'eur' });

    const balances = await transactionService.getBalances(user.id);

    expect(balances.usd).toBe(10000);
    expect(balances.eur).toBe(8000);
  });
});
```

#### 4.3 Transaction History
```typescript
describe('getTransactions', () => {
  it('should return paginated transaction history', async () => {
    // Create 50 transactions
    for (let i = 0; i < 50; i++) {
      await createTransaction({ amount: 1000 * i });
    }

    const page1 = await transactionService.getTransactions(user.id, {
      limit: 20,
      offset: 0
    });

    expect(page1.transactions).toHaveLength(20);
    expect(page1.total).toBe(50);
    expect(page1.has_more).toBe(true);
  });

  it('should filter by transaction type', async () => {
    await createTransaction({ type: 'deposit' });
    await createTransaction({ type: 'withdrawal' });
    await createTransaction({ type: 'bounty_payment' });

    const deposits = await transactionService.getTransactions(user.id, {
      type: 'deposit'
    });

    expect(deposits.transactions).toHaveLength(1);
    expect(deposits.transactions[0].type).toBe('deposit');
  });

  it('should filter by date range', async () => {
    await createTransaction({ 
      amount: 1000,
      created_at: '2024-01-01'
    });
    await createTransaction({ 
      amount: 2000,
      created_at: '2024-02-01'
    });

    const january = await transactionService.getTransactions(user.id, {
      start_date: '2024-01-01',
      end_date: '2024-01-31'
    });

    expect(january.transactions).toHaveLength(1);
    expect(january.transactions[0].amount).toBe(1000);
  });
});
```

---

## 5. Account Deletion Service Tests (GDPR Compliance)

### Priority: ⚠️ CRITICAL
### Estimated Effort: 12 hours

### Test File Location:
```
__tests__/unit/services/account-deletion-service.test.ts
__tests__/integration/account-deletion-flow.test.ts
```

### Tests Required:

```typescript
describe('Account Deletion Service', () => {
  describe('deleteAccount', () => {
    it('should delete user account and all associated data', async () => {
      const userId = 'user-123';

      // Setup test data
      await createUserWithData(userId, {
        bounties: 3,
        applications: 5,
        messages: 20,
        transactions: 10
      });

      // Delete account
      const result = await accountDeletionService.deleteAccount(userId);

      expect(result.success).toBe(true);

      // Verify all data deleted
      const profile = await getProfile(userId);
      expect(profile).toBeNull();

      const bounties = await getBounties(userId);
      expect(bounties).toHaveLength(0);

      const messages = await getMessages(userId);
      expect(messages).toHaveLength(0);
    });

    it('should export user data before deletion', async () => {
      const userId = 'user-123';

      const result = await accountDeletionService.deleteAccount(userId, {
        exportData: true
      });

      expect(result.exportUrl).toBeDefined();
      expect(result.exportUrl).toContain('.json');

      // Verify export contains all data
      const exportData = await fetch(result.exportUrl).then(r => r.json());
      expect(exportData.profile).toBeDefined();
      expect(exportData.bounties).toBeDefined();
      expect(exportData.transactions).toBeDefined();
    });

    it('should handle active bounties gracefully', async () => {
      const userId = 'user-123';
      await createBounty({ poster_id: userId, status: 'in_progress' });

      await expect(
        accountDeletionService.deleteAccount(userId)
      ).rejects.toThrow('Cannot delete account with active bounties');
    });

    it('should cascade delete correctly', async () => {
      const userId = 'user-123';
      await createFullUserData(userId);

      await accountDeletionService.deleteAccount(userId);

      // Verify cascade
      const conversations = await getConversationsByUser(userId);
      expect(conversations).toHaveLength(0);

      const notifications = await getNotificationsByUser(userId);
      expect(notifications).toHaveLength(0);

      const ratings = await getRatingsByUser(userId);
      expect(ratings).toHaveLength(0);
    });
  });
});
```

---

## Test Execution Guidelines

### Running Tests:

```bash
# Run all critical tests
npm run test:critical

# Run specific service tests
npm run test -- completion-service.test.ts
npm run test -- supabase-messaging.test.ts

# Run with coverage
npm run test:coverage -- --collectCoverageFrom="lib/services/completion-service.ts"

# Run integration tests only
npm run test:integration

# Run E2E tests
npm run test:e2e
```

### CI/CD Integration:

```yaml
# .github/workflows/test.yml
name: Run Critical Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run test:critical
      - run: npm run test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

### Success Criteria:

✅ All critical service tests pass
✅ Coverage > 95% for critical services
✅ Integration tests cover complete flows
✅ E2E tests verify user journeys
✅ Tests run in < 5 minutes
✅ Zero flaky tests

---

## Next Steps

1. **Week 1:** Implement completion-service tests
2. **Week 2:** Implement supabase-messaging tests
3. **Week 3:** Implement payment escrow integration tests
4. **Week 4:** Implement transaction-service tests
5. **Week 4:** Implement account-deletion tests

Each week should include:
- Unit tests (TDD)
- Integration tests
- Documentation updates
- Code review with team

---

**Document Version:** 1.0  
**Last Updated:** 2024-01-23  
**Author:** Test Automation Agent
