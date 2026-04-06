// Quick test script for login flow
const BASE = 'http://127.0.0.1:3000';

async function test() {
    try {
        // Test 1: Homepage loads
        console.log('=== Test 1: Homepage ===');
        let r = await fetch(`${BASE}/`);
        console.log('Status:', r.status, '| OK:', r.status === 200);

        // Test 2: Login page loads
        console.log('\n=== Test 2: GET /login ===');
        r = await fetch(`${BASE}/login`);
        console.log('Status:', r.status, '| OK:', r.status === 200);
        let html = await r.text();
        console.log('Has login form:', html.includes('loginForm'));

        // Test 3: Dashboard redirects to login when not authenticated
        console.log('\n=== Test 3: GET /dashboard (no auth) ===');
        r = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
        console.log('Status:', r.status, '| Location:', r.headers.get('location'));
        console.log('Redirects to login:', r.status === 302 && r.headers.get('location') === '/login');

        // Test 4: Login with valid credentials
        console.log('\n=== Test 4: POST /login ===');
        r = await fetch(`${BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@skincare.com', password: 'admin123' }),
            redirect: 'manual'
        });
        console.log('Status:', r.status);
        const loginResult = await r.json();
        console.log('Success:', loginResult.success, '| Role:', loginResult.role);
        const setCookie = r.headers.get('set-cookie');
        console.log('Has cookie:', !!setCookie);

        if (!setCookie) {
            console.log('\nFAILED: No session cookie returned');
            return;
        }

        const cookie = setCookie.split(';')[0];

        // Test 5: Dashboard accessible with session
        console.log('\n=== Test 5: GET /dashboard (with auth) ===');
        r = await fetch(`${BASE}/dashboard`, {
            headers: { 'Cookie': cookie },
            redirect: 'manual'
        });
        console.log('Status:', r.status, '| OK:', r.status === 200);
        if (r.status === 200) {
            html = await r.text();
            console.log('Has dashboard content:', html.includes('heroName'));
        }

        // Test 6: API works with session
        console.log('\n=== Test 6: GET /api/user (with auth) ===');
        r = await fetch(`${BASE}/api/user`, {
            headers: { 'Cookie': cookie }
        });
        console.log('Status:', r.status);
        const userData = await r.json();
        console.log('Success:', userData.success, '| Name:', userData.user?.name);

        // Test 7: Login page redirects to dashboard when already logged in
        console.log('\n=== Test 7: GET /login (already logged in) ===');
        r = await fetch(`${BASE}/login`, {
            headers: { 'Cookie': cookie },
            redirect: 'manual'
        });
        console.log('Status:', r.status, '| Location:', r.headers.get('location'));
        console.log('Redirects to dashboard:', r.status === 302 && r.headers.get('location') === '/dashboard');

        // Test 8: Products page loads (public)
        console.log('\n=== Test 8: GET /products ===');
        r = await fetch(`${BASE}/products`);
        console.log('Status:', r.status, '| OK:', r.status === 200);

        // Test 9: Analyze page requires auth
        console.log('\n=== Test 9: GET /analyze (no auth) ===');
        r = await fetch(`${BASE}/analyze`, { redirect: 'manual' });
        console.log('Status:', r.status, '| Redirects:', r.status === 302);

        // Test 10: Admin page with admin session
        console.log('\n=== Test 10: GET /admin (admin session) ===');
        r = await fetch(`${BASE}/admin`, {
            headers: { 'Cookie': cookie },
            redirect: 'manual'
        });
        console.log('Status:', r.status, '| OK:', r.status === 200);

        console.log('\n✅ All tests completed!');

    } catch (err) {
        console.error('Error:', err.message);
    }
}

test();
