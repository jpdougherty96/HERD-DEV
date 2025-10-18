// Fix all remaining authentication issues in the server
const fs = require('fs');

try {
  // Read the server file
  let content = fs.readFileSync('/supabase/functions/server/index.tsx', 'utf8');
  
  // Count the occurrences to fix
  const matches = content.match(/await supabase\.auth\.getUser\(accessToken\);/g) || [];
  console.log(`Found ${matches.length} occurrences to fix`);
  
  // Replace all instances of the problematic auth call
  content = content.replace(/await supabase\.auth\.getUser\(accessToken\);/g, 'await supabaseAuth.auth.getUser(accessToken);');
  
  // Verify the fix
  const remainingMatches = content.match(/await supabase\.auth\.getUser\(accessToken\);/g) || [];
  console.log(`Remaining occurrences after fix: ${remainingMatches.length}`);
  
  // Write the fixed content back
  fs.writeFileSync('/supabase/functions/server/index.tsx', content);
  
  console.log('✅ Successfully fixed all authentication issues in server');
  
} catch (error) {
  console.error('❌ Error fixing auth issues:', error.message);
  process.exit(1);
}