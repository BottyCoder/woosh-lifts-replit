#!/usr/bin/env node

/**
 * Live Chat Debug Script
 * This script tests the live chat system endpoints to identify issues
 */

const https = require('https');
const http = require('http');

// Configuration
const BASE_URL = 'https://gplifts.woosh.ai';
const AI_TOKEN = process.env.AI_ASSISTANT_TOKEN || process.env.ADMIN_TOKEN;

if (!AI_TOKEN) {
    console.error('❌ Error: No AI_ASSISTANT_TOKEN or ADMIN_TOKEN found in environment');
    console.log('Please set one of these environment variables:');
    console.log('  export AI_ASSISTANT_TOKEN="your_token_here"');
    console.log('  or');
    console.log('  export ADMIN_TOKEN="your_token_here"');
    process.exit(1);
}

console.log('🔍 Live Chat Debug Script');
console.log('========================');
console.log(`🌐 Testing: ${BASE_URL}`);
console.log(`🔑 Using token: ${AI_TOKEN.substring(0, 10)}...`);
console.log('');

// Helper function to make HTTP requests
function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + path);
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: {
                'X-AI-Token': AI_TOKEN,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: jsonData
                    });
                } catch (error) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.end();
    });
}

// Test functions
async function testAuthentication() {
    console.log('🔐 Testing Authentication...');
    try {
        const response = await makeRequest('/api/ai-test/test');
        if (response.status === 200) {
            console.log('✅ Authentication successful');
            console.log(`   Auth type: ${response.data.authType}`);
            console.log(`   Read-only: ${response.data.isReadOnly}`);
        } else {
            console.log('❌ Authentication failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Authentication error:', error.message);
    }
    console.log('');
}

async function testChatConversations() {
    console.log('💬 Testing Chat Conversations Endpoint...');
    try {
        const response = await makeRequest('/api/chat/conversations');
        if (response.status === 200) {
            console.log('✅ Chat conversations endpoint working');
            console.log(`   Found ${response.data.conversations?.length || 0} conversations`);
            if (response.data.conversations?.length > 0) {
                console.log('   Sample conversation:', {
                    id: response.data.conversations[0].id,
                    status: response.data.conversations[0].status,
                    contact: response.data.conversations[0].contact_name,
                    messages: response.data.conversations[0].message_count
                });
            }
        } else {
            console.log('❌ Chat conversations endpoint failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Chat conversations error:', error.message);
    }
    console.log('');
}

async function testChatDebugConversations() {
    console.log('🐛 Testing Chat Debug Conversations...');
    try {
        const response = await makeRequest('/api/chat-debug/conversations-debug');
        if (response.status === 200) {
            console.log('✅ Chat debug conversations working');
            console.log(`   Found ${response.data.conversations?.length || 0} conversations`);
            console.log(`   Debug info:`, response.data.debug);
        } else {
            console.log('❌ Chat debug conversations failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Chat debug conversations error:', error.message);
    }
    console.log('');
}

async function testDatabaseSchema() {
    console.log('🗄️ Testing Database Schema...');
    try {
        const response = await makeRequest('/api/chat-debug/schema-check');
        if (response.status === 200) {
            console.log('✅ Database schema check completed');
            console.log('   Tables exist:', response.data.debug.tablesExist);
        } else {
            console.log('❌ Database schema check failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Database schema error:', error.message);
    }
    console.log('');
}

async function testDataIntegrity() {
    console.log('🔍 Testing Data Integrity...');
    try {
        const response = await makeRequest('/api/chat-debug/data-integrity');
        if (response.status === 200) {
            console.log('✅ Data integrity check completed');
            console.log('   Orphaned records:', response.data.debug.orphanedRecords);
            console.log('   Data counts:', response.data.debug.dataCounts);
        } else {
            console.log('❌ Data integrity check failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Data integrity error:', error.message);
    }
    console.log('');
}

async function testChatApiSimulation() {
    console.log('🎭 Testing Chat API Simulation...');
    try {
        const response = await makeRequest('/api/chat-debug/simulate-chat-api');
        if (response.status === 200) {
            console.log('✅ Chat API simulation completed');
            console.log(`   Execution time: ${response.data.debug.executionTimeMs}ms`);
            console.log(`   Result count: ${response.data.debug.resultCount}`);
            console.log(`   Query successful: ${response.data.debug.querySuccessful}`);
        } else {
            console.log('❌ Chat API simulation failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Chat API simulation error:', error.message);
    }
    console.log('');
}

async function testEnvironmentVariables() {
    console.log('⚙️ Testing Environment Variables...');
    try {
        const response = await makeRequest('/api/ai-test/env-check');
        if (response.status === 200) {
            console.log('✅ Environment variables check completed');
            console.log('   Variables:', response.data.environment);
        } else {
            console.log('❌ Environment variables check failed');
            console.log(`   Status: ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
        }
    } catch (error) {
        console.log('❌ Environment variables error:', error.message);
    }
    console.log('');
}

// Main execution
async function runAllTests() {
    console.log('🚀 Starting Live Chat Debug Tests...');
    console.log('');
    
    await testAuthentication();
    await testEnvironmentVariables();
    await testDatabaseSchema();
    await testDataIntegrity();
    await testChatApiSimulation();
    await testChatDebugConversations();
    await testChatConversations();
    
    console.log('🏁 All tests completed!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- Check the results above to identify any issues');
    console.log('- If chat conversations endpoint fails, check the debug results');
    console.log('- Verify all environment variables are set correctly');
    console.log('- Ensure database schema is intact');
}

// Run the tests
runAllTests().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
