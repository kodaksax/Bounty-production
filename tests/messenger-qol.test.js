/**
 * Test suite for Messenger Quality-of-Life features
 * Tests typing indicators, message status, pinning, and actions
 */

const { messageService } = require('../lib/services/message-service');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMessageService() {
  console.log('🔍 Testing Message Service...\n');

  // Test 1: Get messages
  console.log('1️⃣ Testing: Get messages for conversation');
  const messages = await messageService.getMessages('c1');
  console.assert(Array.isArray(messages), '❌ Messages should be an array');
  console.assert(messages.length > 0, '❌ Should have seed messages');
  console.log(`✅ Got ${messages.length} messages\n`);

  // Test 2: Send message
  console.log('2️⃣ Testing: Send message');
  const { message: newMessage } = await messageService.sendMessage('c1', 'Test message');
  console.assert(newMessage.id, '❌ New message should have an ID');
  console.assert(newMessage.text === 'Test message', '❌ Message text mismatch');
  console.assert(newMessage.status === 'sending', '❌ Initial status should be sending');
  console.log(`✅ Message sent with ID: ${newMessage.id}\n`);

  // Test 3: Update message status
  console.log('3️⃣ Testing: Update message status to delivered');
  await messageService.updateMessageStatus(newMessage.id, 'delivered');
  const updatedMessages = await messageService.getMessages('c1');
  const updatedMsg = updatedMessages.find(m => m.id === newMessage.id);
  console.assert(updatedMsg.status === 'delivered', '❌ Status should be delivered');
  console.log(`✅ Message status updated to: ${updatedMsg.status}\n`);

  // Test 4: Pin message
  console.log('4️⃣ Testing: Pin message');
  const { success: pinSuccess } = await messageService.pinMessage(newMessage.id);
  console.assert(pinSuccess, '❌ Pin should succeed');
  const pinnedMsg = await messageService.getPinnedMessage('c1');
  console.assert(pinnedMsg && pinnedMsg.id === newMessage.id, '❌ Pinned message mismatch');
  console.log(`✅ Message pinned: "${pinnedMsg.text}"\n`);

  // Test 5: Pin another message (should replace)
  console.log('5️⃣ Testing: Pin replacement');
  const firstMsg = messages[0];
  await messageService.pinMessage(firstMsg.id);
  const newPinnedMsg = await messageService.getPinnedMessage('c1');
  console.assert(newPinnedMsg.id === firstMsg.id, '❌ Should have replaced pinned message');
  console.log(`✅ Pinned message replaced: "${newPinnedMsg.text}"\n`);

  // Test 6: Unpin message
  console.log('6️⃣ Testing: Unpin message');
  await messageService.unpinMessage(firstMsg.id);
  const noPinnedMsg = await messageService.getPinnedMessage('c1');
  console.assert(!noPinnedMsg, '❌ Should have no pinned message');
  console.log(`✅ Message unpinned\n`);

  // Test 7: Report message
  console.log('7️⃣ Testing: Report message');
  const { success: reportSuccess } = await messageService.reportMessage(newMessage.id, 'Spam');
  console.assert(reportSuccess, '❌ Report should succeed');
  console.log(`✅ Message reported\n`);

  console.log('✅ All Message Service tests passed!\n');
}

async function testSocketStub() {
  console.log('🔍 Testing Socket Stub...\n');

  const { socketStub } = require('../hooks/useSocketStub');

  // Test 1: Typing event
  console.log('1️⃣ Testing: Typing event');
  let typingEventReceived = false;
  const unsubTyping = socketStub.onTyping((event) => {
    if (event.conversationId === 'c1' && event.userId === 'user-1') {
      typingEventReceived = true;
    }
  });
  socketStub.emitTyping('user-1', 'c1');
  await sleep(50);
  console.assert(typingEventReceived, '❌ Should receive typing event');
  console.log(`✅ Typing event received\n`);
  unsubTyping();

  // Test 2: Message status event
  console.log('2️⃣ Testing: Message status events');
  let deliveredEventReceived = false;
  let readEventReceived = false;

  const unsubStatus = socketStub.onMessageStatus((event) => {
    if (event.messageId === 'test-msg-1' && event.status === 'delivered') {
      deliveredEventReceived = true;
    }
    if (event.messageId === 'test-msg-1' && event.status === 'read') {
      readEventReceived = true;
    }
  });

  socketStub.emitMessageDelivered('test-msg-1');
  await sleep(50);
  console.assert(deliveredEventReceived, '❌ Should receive delivered event');
  console.log(`✅ Delivered event received`);

  socketStub.emitMessageRead('test-msg-1');
  await sleep(50);
  console.assert(readEventReceived, '❌ Should receive read event');
  console.log(`✅ Read event received\n`);
  unsubStatus();

  // Test 3: Automatic status transitions
  console.log('3️⃣ Testing: Automatic status transitions');
  let autoDelivered = false;
  let autoRead = false;

  const unsubAuto = socketStub.onMessageStatus((event) => {
    if (event.messageId === 'auto-msg' && event.status === 'delivered') {
      autoDelivered = true;
    }
    if (event.messageId === 'auto-msg' && event.status === 'read') {
      autoRead = true;
    }
  });

  socketStub.simulateMessageStatusTransition('auto-msg');
  await sleep(400); // Wait for delivered (300ms)
  console.assert(autoDelivered, '❌ Should auto-deliver after 300ms');
  console.log(`✅ Auto-delivered after 300ms`);

  await sleep(3000); // Wait for read (3s total)
  console.assert(autoRead, '❌ Should auto-read after 3s');
  console.log(`✅ Auto-read after 3s\n`);
  unsubAuto();

  console.log('✅ All Socket Stub tests passed!\n');
}

async function runAllTests() {
  console.log('🚀 Starting Messenger QoL Tests\n');
  console.log('='.repeat(50) + '\n');

  try {
    await testMessageService();
    await testSocketStub();

    console.log('='.repeat(50));
    console.log('✅ ALL TESTS PASSED! 🎉\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
