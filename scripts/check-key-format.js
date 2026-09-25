require('dotenv').config();

function report(label, key) {
  if (!key) {
    console.log(`${label}: not set`);
    return;
  }
  const hasBegin = key.includes('-----BEGIN PRIVATE KEY-----');
  const hasEnd = key.includes('-----END PRIVATE KEY-----');
  const hasLiteralBackslashN = key.includes('\\n');
  const hasRealNewline = key.includes('\n');
  const hasCarriageReturn = key.includes('\r');
  console.log(`${label}:`);
  console.log(`  length: ${key.length}`);
  console.log(`  has BEGIN marker: ${hasBegin}`);
  console.log(`  has END marker: ${hasEnd}`);
  console.log(`  contains literal "\\n" (backslash-n text): ${hasLiteralBackslashN}`);
  console.log(`  contains real newline characters: ${hasRealNewline}`);
  console.log(`  contains carriage return (\\r) - BAD if present: ${hasCarriageReturn}`);
}

const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (json) {
  console.log('GOOGLE_SERVICE_ACCOUNT_JSON is set. Attempting to parse...');
  try {
    const parsed = JSON.parse(json);
    report('  -> private_key inside JSON', parsed.private_key);
  } catch (err) {
    console.log('  FAILED to parse as JSON:', err.message);
  }
} else {
  console.log('GOOGLE_SERVICE_ACCOUNT_JSON: not set');
}

console.log('');
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
report('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (raw, before \\n replace)', rawKey);
if (rawKey) {
  const afterReplace = rawKey.replace(/\\n/g, '\n');
  report('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (after \\n replace, what the app actually uses)', afterReplace);
}
