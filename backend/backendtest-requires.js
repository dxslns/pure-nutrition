console.log('=== TEST 1: Checking Node.js version ===');
console.log('Node version:', process.version);

console.log('\n=== TEST 2: Checking environment ===');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('PORT:', process.env.PORT || 'not set');
console.log('PWD:', process.env.PWD || 'not set');

console.log('\n=== TEST 3: Testing requires ===');
try {
    console.log('1. Loading express...');
    require('express');
    console.log('✅ express OK');
} catch (e) { console.log('❌ express ERROR:', e.message); }

try {
    console.log('2. Loading cors...');
    require('cors');
    console.log('✅ cors OK');
} catch (e) { console.log('❌ cors ERROR:', e.message); }

try {
    console.log('3. Loading bcryptjs...');
    require('bcryptjs');
    console.log('✅ bcryptjs OK');
} catch (e) { console.log('❌ bcryptjs ERROR:', e.message); }

try {
    console.log('4. Loading jsonwebtoken...');
    require('jsonwebtoken');
    console.log('✅ jsonwebtoken OK');
} catch (e) { console.log('❌ jsonwebtoken ERROR:', e.message); }

try {
    console.log('5. Loading pg...');
    require('pg');
    console.log('✅ pg OK');
} catch (e) { console.log('❌ pg ERROR:', e.message); }

try {
    console.log('6. Loading dotenv...');
    require('dotenv').config();
    console.log('✅ dotenv OK');
} catch (e) { console.log('❌ dotenv ERROR:', e.message); }

console.log('\n=== TEST COMPLETE ===');