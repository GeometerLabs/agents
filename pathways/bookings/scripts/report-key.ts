// Makes the key pair that signs reports and certificates, in a folder you name, outside any git repository.
//   node pathways/bookings/scripts/report-key.ts ~/geometer-keys
// It refuses a folder inside a repository, and never overwrites a key. Keep report-key.pem secret and backed up: it is
// the only thing that proves a document came from you. Share report-key.pub.pem (or the key id) so people can check it.
import { UsageError, main } from "../report/cli.ts";
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE, generateKeyFiles } from "../../../modules/report/keys.ts";

await main(async () => {
  const folder = process.argv[2];
  if (!folder || folder.startsWith("-")) throw new UsageError("Say which folder to make the key in (outside any repository), for example:\n  node pathways/bookings/scripts/report-key.ts ~/geometer-keys");
  const key = generateKeyFiles(folder);
  console.log(`Made a signing key in ${folder}.`);
  console.log(`  Private key  ${key.privateKeyPath}   (secret: only you can read it. Give this path to --key.)`);
  console.log(`  Public key   ${key.publicKeyPath}   (share it, so others can check your documents with --trust-key)`);
  console.log(`  Key id       ${key.keyId}`);
  console.log(`Back up ${PRIVATE_KEY_FILE}. If it is lost, nothing signed with it can be re-issued; if someone else gets it, they can sign as you. ${PUBLIC_KEY_FILE} is safe to share.`);
});
