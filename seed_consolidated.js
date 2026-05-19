import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = "https://kcinqpwkwpzbosxtkwyl.supabase.co";

// Retrieve the service_role key from environment variables or command-line arguments
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[2];

if (!serviceRoleKey) {
  console.error("❌ Error: Missing SUPABASE_SERVICE_ROLE_KEY!");
  console.log("\nTo seed the database securely without disabling RLS, please run the script with your service_role key:");
  console.log("👉  node seed_consolidated.js <your_service_role_key>");
  console.log("\nYou can find your service_role key in Supabase ➜ Project Settings ➜ API ➜ service_role (secret).");
  process.exit(1);
}

const csvPath = path.resolve(__dirname, 'Consolidated_Staff_Data.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`❌ CSV file not found at: ${csvPath}`);
  process.exit(1);
}

const rows = [];

console.log("Parsing Consolidated_Staff_Data.csv...");

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    const cleanRow = {};
    for (const [key, value] of Object.entries(row)) {
      const trimmed = value ? value.trim() : '';
      if (trimmed === '') {
        cleanRow[key] = null;
      } else if (trimmed.toLowerCase() === 'true') {
        cleanRow[key] = true;
      } else if (trimmed.toLowerCase() === 'false') {
        cleanRow[key] = false;
      } else {
        cleanRow[key] = trimmed;
      }
    }

    // --- Proactively handle NOT NULL constraints in your Supabase schema ---

    // 1. Resolve missing first_name & surname (common in Supabase-only records)
    if (cleanRow.first_name === null) {
      if (cleanRow.name) {
        cleanRow.first_name = cleanRow.name.split(' ')[0] || "Staff";
      } else {
        cleanRow.first_name = "Staff";
      }
    }
    if (cleanRow.surname === null) {
      if (cleanRow.name) {
        cleanRow.surname = cleanRow.name.split(' ').slice(1).join(' ') || "Member";
      } else {
        cleanRow.surname = "Member";
      }
    }

    // 2. Resolve missing start_date
    if (cleanRow.start_date === null) {
      cleanRow.start_date = "2026-01-01"; // Fallback safe start date
    }

    // 3. Resolve other constrained columns
    if (cleanRow.branch === null) {
      cleanRow.branch = "Unassigned";
    }
    if (cleanRow.contract === null) {
      cleanRow.contract = "NO CONTRACT";
    }
    if (cleanRow.employee_code) {
      const code = cleanRow.employee_code.toUpperCase();
      if (code.endsWith("-M")) {
        cleanRow.role_type = "manager";
      } else if (code.endsWith("-W")) {
        cleanRow.role_type = "warehouse";
      } else if (code.endsWith("-F")) {
        cleanRow.role_type = "maintenance";
      } else if (code.endsWith("-CC")) {
        cleanRow.role_type = "call_centre";
      } else if (code.endsWith("-C")) {
        cleanRow.role_type = "cleaner";
      } else if (cleanRow.role_type === null) {
        cleanRow.role_type = "tech";
      }
    } else if (cleanRow.role_type === null) {
      cleanRow.role_type = "tech";
    }
    if (cleanRow.role === null) {
      cleanRow.role = "Nail Tech";
    }
    if (cleanRow.permit === null) {
      cleanRow.permit = "sa_citizen";
    }
    if (cleanRow.active === null) {
      cleanRow.active = cleanRow.left_date ? false : true;
    }
    if (cleanRow.is_shadow === null) {
      cleanRow.is_shadow = false;
    }

    rows.push(cleanRow);
  })
  .on('end', async () => {
    console.log(`Parsed ${rows.length} rows successfully. Seeding via Admin/Service role...`);
    
    // Upload in chunks of 50 to avoid PostgreSQL timeouts and payload limits
    const chunkSize = 50;
    let successfulCount = 0;
    let failedChunks = 0;
    
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/Consolodated%20Staff%20List`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(chunk)
        });
        
        if (!response.ok) {
          const errMsg = await response.text();
          console.error(`\n❌ Error uploading chunk starting at index ${i}:`, errMsg);
          failedChunks++;
        } else {
          successfulCount += chunk.length;
          process.stdout.write(`\r🚀 Seeding progress: ${successfulCount} / ${rows.length} rows inserted...`);
        }
      } catch (err) {
        console.error(`\n❌ Network error uploading chunk at index ${i}:`, err.message);
        failedChunks++;
      }
    }
    
    console.log(`\n\n🎉 Seeding finished!`);
    console.log(`✅ Successfully loaded: ${successfulCount} / ${rows.length} profiles.`);
    if (failedChunks > 0) {
      console.log(`⚠️  Warning: ${failedChunks} chunk(s) failed. See logs above for exact database constraints violated.`);
    } else {
      console.log(`😎 Clean sweep! All records successfully imported.`);
    }
  });
