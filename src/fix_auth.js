// Script to fix auth issues in server code
import { readFileSync, writeFileSync } from 'fs';

const filePath = '/supabase/functions/server/index.tsx';
let content = readFileSync(filePath, 'utf8');

// Replace all remaining occurrences of supabase.auth.getUser with supabaseAuth.auth.getUser
const oldPattern = 'await supabase.auth.getUser(accessToken);';
const newPattern = 'await supabaseAuth.auth.getUser(accessToken);';

const count = (content.match(/await supabase\.auth\.getUser\(accessToken\);/g) || []).length;
console.log(`Found ${count} remaining occurrences to fix`);

content = content.replace(/await supabase\.auth\.getUser\(accessToken\);/g, newPattern);

writeFileSync(filePath, content, 'utf8');
console.log('Fixed all auth occurrences');