// Simple script to replace all supabase.auth.getUser with supabaseAuth.auth.getUser

const fs = require('fs');
const path = '/supabase/functions/server/index.tsx';

let content = fs.readFileSync(path, 'utf8');

// Replace all instances
content = content.replace(/await supabase\.auth\.getUser\(accessToken\);/g, 'await supabaseAuth.auth.getUser(accessToken);');

fs.writeFileSync(path, content);

console.log('Fixed all auth references');