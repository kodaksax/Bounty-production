import { config } from './config';

const API_BASE_URL = `http://localhost:${config.service.port}`;

async function login() {
    const response = await fetch(`${API_BASE_URL}/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'test@example.com',
            password: 'TestPassword123!'
        })
    });

    const data = await response.json() as any;
    if (!data.success) {
        // If sign-in fails, try to register
        const regRes = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'TestPassword123!'
            })
        });
        await regRes.json();

        // Sign in again
        const retryRes = await fetch(`${API_BASE_URL}/auth/sign-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'TestPassword123!'
            })
        });
        const retryData = await retryRes.json() as any;
        return retryData.session.access_token;
    }

    return data.session.access_token;
}

async function testUpload(token: string, name: string, content: string | Buffer, type: string) {
    console.log(`\n--- Testing: ${name} ---`);

    const formData = new FormData();
    const blob = new Blob([content as any], { type });
    formData.append('file', blob, name);

    try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await response.json() as any;
        console.log(`Status: ${response.status}`);
        console.log('Response:', JSON.stringify(data, null, 2));

        return { status: response.status, data };
    } catch (error) {
        console.error('Request failed:', error);
        return { status: 500, data: { error: 'Request failed' } };
    }
}

async function runTests() {
    console.log('🚀 Starting File Upload Validation Tests');

    try {
        const token = await login();
        console.log('✅ Logged in successfully');

        // Test 1: Valid Image
        await testUpload(token, 'test.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'), 'image/png');

        // Test 2: Invalid Type (.exe renamed to .png)
        // We'll just use random bytes that don't match PNG header
        await testUpload(token, 'malicious.png', Buffer.from('MZ@ThisIsAnExecutableButNamedPng'), 'image/png');

        // Test 3: Large File (11MB)
        const largeContent = Buffer.alloc(11 * 1024 * 1024, 'a');
        await testUpload(token, 'large.png', largeContent, 'image/png');

        // Test 4: Malware (EICAR)
        const eicarString = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
        await testUpload(token, 'eicar.txt', eicarString, 'text/plain');

    } catch (error) {
        console.error('Test suite failed:', error);
    }
}

runTests();
