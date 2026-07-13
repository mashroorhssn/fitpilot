/**
 * Optional: seeds Supabase with the default profile.
 * Run AFTER creating tables with supabase/schema.sql:  npm run seed:supabase
 */
import { getProfile, saveProfile, storageMode } from "../services/store";

(async () => {
  if (storageMode !== "supabase") {
    console.log("SUPABASE_URL not set — nothing to seed (local JSON mode needs no seeding).");
    return;
  }
  const p = await getProfile();
  await saveProfile(p);
  console.log("Seeded profile:", p);
})();
