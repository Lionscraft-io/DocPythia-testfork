// Load environment variables as early as possible
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error(`📝 Make sure your .env file exists and contains:`);
    console.error(`   ${envVar}=your_value_here`);
    process.exit(1);
  }
}

// Fix DATABASE_URL if it contains unencoded special characters in the password
if (process.env.DATABASE_URL) {
  try {
    // Try to parse the URL - if it fails, we need to fix the encoding
    new URL(process.env.DATABASE_URL);
  } catch {
    // URL parsing failed, likely due to special characters in password
    console.log('⚠️  DATABASE_URL contains special characters, fixing encoding...');

    // Parse the connection string manually
    const match = process.env.DATABASE_URL.match(/^(postgresql?):\/\/([^:]+):([^@]+)@(.+)$/);
    if (match) {
      const [, protocol, username, password, hostAndDb] = match;
      // Encode the password part only
      const encodedPassword = encodeURIComponent(password);
      process.env.DATABASE_URL = `${protocol}://${username}:${encodedPassword}@${hostAndDb}`;
      console.log('✅ DATABASE_URL encoding fixed');
    }
  }
}

console.log(`✅ Environment variables loaded successfully`);
