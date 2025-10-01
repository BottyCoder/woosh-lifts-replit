/**
 * Example: Tracking WhatsApp Button Clicks to Specific Messages
 * 
 * This example demonstrates how to:
 * 1. Send interactive button messages
 * 2. Store the message IDs
 * 3. Match button clicks back to original messages
 * 
 * Use case: Multiple emergency alerts with same buttons
 */

const fetch = require('node-fetch');

// Configuration
const BRIDGE_URL = 'https://wa.woosh.ai';
const API_KEY = process.env.BRIDGE_API_KEY || 'your-api-key-here';

// In-memory store (use a real database in production)
const messageStore = new Map();

/**
 * Send an emergency alert with buttons
 * Returns the message ID that can be used for tracking
 */
async function sendEmergencyAlert(ticketId, liftId, contactPhone, emergencyDetails) {
  console.log(`\n📤 Sending alert for Ticket ${ticketId}, Lift ${liftId}`);
  
  const payload = {
    to: contactPhone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { 
        text: `🚨 Emergency Alert\n\nLift: ${liftId}\nTicket: ${ticketId}\n${emergencyDetails}\n\nPlease indicate emergency type:` 
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `${ticketId}_test`, title: 'Test' } },
          { type: 'reply', reply: { id: `${ticketId}_maint`, title: 'Maintenance' } },
          { type: 'reply', reply: { id: `${ticketId}_entrap`, title: 'Entrapment' } }
        ]
      }
    }
  };

  try {
    const response = await fetch(`${BRIDGE_URL}/api/messages/send`, {
      method: 'POST',
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result.ok && result.wa_id) {
      // Store the mapping
      const record = {
        messageId: result.wa_id,
        ticketId,
        liftId,
        contactPhone,
        emergencyDetails,
        sentAt: new Date().toISOString(),
        status: 'sent'
      };
      
      messageStore.set(result.wa_id, record);
      
      console.log(`✅ Message sent successfully`);
      console.log(`   Message ID: ${result.wa_id}`);
      console.log(`   Stored in tracking database`);
      
      return result.wa_id;
    } else {
      console.error('❌ Failed to send message:', result);
      return null;
    }
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
    return null;
  }
}

/**
 * Process incoming webhook when user clicks a button
 * This is what your webhook endpoint would do
 */
function handleButtonClickWebhook(webhookPayload) {
  console.log('\n📥 Received webhook - Button clicked');
  
  // Extract the message data
  const message = webhookPayload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  
  if (!message) {
    console.log('❌ Invalid webhook payload');
    return;
  }

  // Check if it's an interactive button reply
  if (message.type !== 'interactive' || message.interactive?.type !== 'button_reply') {
    console.log('⏭️  Not a button reply, skipping');
    return;
  }

  // Extract key information
  const userPhone = message.from;
  const buttonId = message.interactive.button_reply.id;
  const buttonTitle = message.interactive.button_reply.title;
  const originalMessageId = message.context?.id;
  const clickedAt = new Date(parseInt(message.timestamp) * 1000);

  console.log(`   User: ${userPhone}`);
  console.log(`   Button: ${buttonTitle} (ID: ${buttonId})`);
  console.log(`   Original Message ID: ${originalMessageId}`);
  console.log(`   Clicked At: ${clickedAt.toISOString()}`);

  if (!originalMessageId) {
    console.log('⚠️  Warning: No context.id in webhook - cannot track to original message');
    return;
  }

  // Look up the original message in our store
  const originalRecord = messageStore.get(originalMessageId);
  
  if (!originalRecord) {
    console.log(`❌ Could not find original message in store: ${originalMessageId}`);
    console.log('   This might be from an old message or a different session');
    return;
  }

  // Update the record
  originalRecord.respondedAt = clickedAt.toISOString();
  originalRecord.responseButton = buttonTitle;
  originalRecord.responseButtonId = buttonId;
  originalRecord.status = 'responded';
  
  messageStore.set(originalMessageId, originalRecord);

  // Process the response
  console.log('\n✅ Successfully matched button click to original message:');
  console.log(`   Ticket ID: ${originalRecord.ticketId}`);
  console.log(`   Lift ID: ${originalRecord.liftId}`);
  console.log(`   Emergency Type: ${buttonTitle}`);
  console.log(`   Response Time: ${((clickedAt - new Date(originalRecord.sentAt)) / 1000).toFixed(0)}s`);

  // Here you would:
  // 1. Update your ticketing system
  // 2. Trigger appropriate workflows
  // 3. Send notifications to relevant teams
  // 4. Log to audit trail
  
  return {
    ticketId: originalRecord.ticketId,
    liftId: originalRecord.liftId,
    emergencyType: buttonTitle,
    userPhone
  };
}

/**
 * Example simulation: Multiple emergency alerts
 */
async function simulateMultipleEmergencies() {
  console.log('='.repeat(60));
  console.log('SCENARIO: Multiple simultaneous emergency alerts');
  console.log('='.repeat(60));

  const contactPhone = '27824537125'; // Test number

  // Send 3 different emergency alerts to the same person
  const msg1 = await sendEmergencyAlert(
    'EMG-2024-001', 
    'LIFT-A', 
    contactPhone,
    'Floor 3 - Alarm triggered'
  );

  await sleep(1000);

  const msg2 = await sendEmergencyAlert(
    'EMG-2024-002', 
    'LIFT-B', 
    contactPhone,
    'Floor 7 - Door stuck'
  );

  await sleep(1000);

  const msg3 = await sendEmergencyAlert(
    'EMG-2024-003', 
    'LIFT-C', 
    contactPhone,
    'Floor 2 - Unusual noise'
  );

  console.log('\n' + '='.repeat(60));
  console.log('MESSAGE TRACKING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total messages sent: ${messageStore.size}`);
  console.log('\nStored Messages:');
  messageStore.forEach((record, msgId) => {
    console.log(`  • ${record.ticketId} (${record.liftId})`);
    console.log(`    Message ID: ${msgId}`);
    console.log(`    Status: ${record.status}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('WAITING FOR USER RESPONSES...');
  console.log('='.repeat(60));
  console.log('\nWhen user clicks any button, the webhook will contain:');
  console.log('  - context.id: The original message ID');
  console.log('  - This allows matching to the specific emergency/ticket');
  console.log('\nSimulating webhook responses...\n');

  // Simulate user clicking button on LIFT-B alert (msg2)
  await sleep(2000);
  console.log('\n📱 User clicks "Entrapment" button on LIFT-B alert...');
  simulateWebhookReceived(msg2, contactPhone, 'EMG-2024-002_entrap', 'Entrapment');

  // Simulate user clicking button on LIFT-A alert (msg1)
  await sleep(2000);
  console.log('\n📱 User clicks "Test" button on LIFT-A alert...');
  simulateWebhookReceived(msg1, contactPhone, 'EMG-2024-001_test', 'Test');

  // Show final summary
  console.log('\n' + '='.repeat(60));
  console.log('FINAL STATUS');
  console.log('='.repeat(60));
  messageStore.forEach((record, msgId) => {
    console.log(`\n${record.ticketId} - ${record.liftId}:`);
    console.log(`  Sent: ${record.sentAt}`);
    console.log(`  Status: ${record.status}`);
    if (record.respondedAt) {
      console.log(`  Responded: ${record.respondedAt}`);
      console.log(`  Response: ${record.responseButton}`);
    }
  });
}

/**
 * Simulate a webhook payload (for testing without real WhatsApp)
 */
function simulateWebhookReceived(originalMessageId, userPhone, buttonId, buttonTitle) {
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'BUSINESS_ACCOUNT_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '27123456789',
            phone_number_id: '753321277868753'
          },
          contacts: [{
            profile: { name: 'Test User' },
            wa_id: userPhone
          }],
          messages: [{
            from: userPhone,
            id: 'wamid.NEW' + Date.now(),
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: {
                id: buttonId,
                title: buttonTitle
              }
            },
            context: {
              from: '27123456789',
              id: originalMessageId  // This links back to original message!
            }
          }]
        },
        field: 'messages'
      }]
    }]
  };

  handleButtonClickWebhook(webhookPayload);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Show current message store (for debugging)
 */
function showMessageStore() {
  console.log('\n' + '='.repeat(60));
  console.log('MESSAGE STORE CONTENTS');
  console.log('='.repeat(60));
  
  if (messageStore.size === 0) {
    console.log('(empty)');
  } else {
    messageStore.forEach((record, msgId) => {
      console.log(`\nMessage ID: ${msgId}`);
      console.log(`  Ticket: ${record.ticketId}`);
      console.log(`  Lift: ${record.liftId}`);
      console.log(`  Contact: ${record.contactPhone}`);
      console.log(`  Status: ${record.status}`);
      console.log(`  Sent: ${record.sentAt}`);
      if (record.respondedAt) {
        console.log(`  Responded: ${record.respondedAt}`);
        console.log(`  Response: ${record.responseButton}`);
      }
    });
  }
}

// Run the simulation if this script is executed directly
if (require.main === module) {
  console.log('WhatsApp Button Click Tracking - Test Example\n');
  
  if (process.env.BRIDGE_API_KEY) {
    console.log('✅ API Key found in environment');
    console.log('🚀 This will send REAL messages to WhatsApp\n');
    
    simulateMultipleEmergencies().catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
  } else {
    console.log('⚠️  BRIDGE_API_KEY not set - running in simulation mode');
    console.log('   Set BRIDGE_API_KEY environment variable to send real messages\n');
    
    // Run simulation without actually sending messages
    console.log('='.repeat(60));
    console.log('SIMULATION MODE');
    console.log('='.repeat(60));
    console.log('\nShowing how the tracking works with mock data...\n');
    
    // Create mock message IDs
    messageStore.set('wamid.MOCK_MSG_001', {
      messageId: 'wamid.MOCK_MSG_001',
      ticketId: 'EMG-2024-001',
      liftId: 'LIFT-A',
      contactPhone: '27824537125',
      emergencyDetails: 'Floor 3 - Alarm triggered',
      sentAt: new Date(Date.now() - 60000).toISOString(),
      status: 'sent'
    });

    messageStore.set('wamid.MOCK_MSG_002', {
      messageId: 'wamid.MOCK_MSG_002',
      ticketId: 'EMG-2024-002',
      liftId: 'LIFT-B',
      contactPhone: '27824537125',
      emergencyDetails: 'Floor 7 - Door stuck',
      sentAt: new Date(Date.now() - 45000).toISOString(),
      status: 'sent'
    });

    showMessageStore();

    console.log('\n📱 Simulating user clicking "Entrapment" on LIFT-B alert...');
    simulateWebhookReceived('wamid.MOCK_MSG_002', '27824537125', 'EMG-2024-002_entrap', 'Entrapment');

    console.log('\n📱 Simulating user clicking "Test" on LIFT-A alert...');
    simulateWebhookReceived('wamid.MOCK_MSG_001', '27824537125', 'EMG-2024-001_test', 'Test');

    showMessageStore();

    console.log('\n✅ Simulation complete!');
    console.log('\nTo send real messages, set environment variable:');
    console.log('   export BRIDGE_API_KEY="your-actual-api-key"');
    console.log('   node track-button-clicks.js\n');
  }
}

// Export functions for use as a module
module.exports = {
  sendEmergencyAlert,
  handleButtonClickWebhook,
  messageStore
};

