const WebSocket = require('ws');

// Test WebSocket connection to our realtime events endpoint
const ws = new WebSocket('ws://localhost:3001/events/subscribe');

ws.on('open', function() {
    console.log('📡 Connected to WebSocket');
});

ws.on('message', function(data) {
    try {
        const message = JSON.parse(data);
        console.log('📨 Received message:', message);
    } catch (error) {
        console.log('📨 Received raw message:', data.toString());
    }
});

ws.on('error', function(error) {
    console.error('❌ WebSocket error:', error);
});

ws.on('close', function() {
    console.log('📡 WebSocket connection closed');
});

// Keep the connection alive for 30 seconds
setTimeout(() => {
    console.log('🏁 Closing WebSocket connection');
    ws.close();
}, 30000);